/**
 * Daily spam / blacklist / health pass over Twilio "from" DIDs.
 * Updates in-app line pool + mirrors results to Supabase.
 *
 * Labels come from CallTracer (free) and optional Hiya only.
 * Callback rates are recorded for ops insight and never merge into spamLabel.
 */

import {
  checkCallTracerReputation,
  checkHiyaReputation,
  lineReputationView,
  mergeReputationResults,
  type ReputationResult,
  type ReputationSource,
} from "@/lib/reputation/check";
import { evaluateLineHealth } from "@/lib/reputation/evaluate";
import {
  getSettings,
  listAttemptsSince,
  listInbox,
  listLines,
  updateLine,
  updateSettings,
} from "@/lib/store/db";
import type { LineRecord } from "@/lib/store/types";
import {
  insertReputationCheck,
  upsertCallerIdNumber,
} from "@/lib/supabase/rvm-sync";

const DAY_MS = 24 * 60 * 60 * 1000;
const RECHECK_AFTER_MS = 20 * 60 * 60 * 1000; // ~once per day with cron slack

export type LineReputationStatus = ReturnType<typeof lineReputationView> & {
  e164: string;
  status: LineRecord["status"];
  callbackRate7d: number | null;
};

export type DailyReputationSummary = {
  ran: boolean;
  skippedReason?: string;
  checkedAt: string;
  calltracerEnabled: boolean;
  hiyaEnabled: boolean;
  lines: Array<{
    e164: string;
    label: string;
    score: number | null;
    reportCount: number | null;
    flagged: boolean;
    status: string;
    action: string;
    reason?: string;
    source?: string;
    riskHint: string;
  }>;
  supabaseSynced: number;
};

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

/** Callback rate per DID from inbox (toE164) vs attempts (lineId) over 7d. Display-only. */
async function callbackRates7d(
  lines: Awaited<ReturnType<typeof listLines>>,
): Promise<Map<string, { rate: number; attempts: number; callbacks: number }>> {
  const since = daysAgoIso(7);
  const attempts = await listAttemptsSince(since);
  const inbox = await listInbox();
  const byLineId = new Map<string, { attempts: number; callbacks: number }>();
  for (const line of lines) {
    byLineId.set(line.id, { attempts: 0, callbacks: 0 });
  }

  for (const a of attempts) {
    if (!a.lineId || a.status !== "SENT") continue;
    const row = byLineId.get(a.lineId);
    if (row) row.attempts += 1;
  }

  const e164ToId = new Map(lines.map((l) => [l.e164, l.id]));
  for (const msg of inbox) {
    if (msg.createdAt < since) continue;
    if (msg.channel !== "VOICE_CALLBACK" && msg.category !== "CALLBACK") continue;
    const lineId = e164ToId.get(msg.toE164);
    if (!lineId) continue;
    const row = byLineId.get(lineId);
    if (row) row.callbacks += 1;
  }

  const out = new Map<
    string,
    { rate: number; attempts: number; callbacks: number }
  >();
  for (const line of lines) {
    const row = byLineId.get(line.id) ?? { attempts: 0, callbacks: 0 };
    out.set(line.e164, {
      ...row,
      rate: row.attempts > 0 ? row.callbacks / row.attempts : 0,
    });
  }
  return out;
}

export async function shouldRunDailyReputation(
  force = false,
): Promise<{ run: boolean; reason?: string }> {
  if (force) return { run: true };
  const settings = await getSettings();
  const last = settings.lastReputationCheckAt;
  if (!last) return { run: true };
  const age = Date.now() - new Date(last).getTime();
  if (Number.isNaN(age) || age >= RECHECK_AFTER_MS) return { run: true };
  return {
    run: false,
    reason: `last_check_${Math.round(age / 3_600_000)}h_ago`,
  };
}

/** Persisted last-check snapshot for ops UI / GET status — no paid API. */
export async function listPersistedReputation(
  e164?: string,
): Promise<{
  lastReputationCheckAt: string | null;
  lines: LineReputationStatus[];
}> {
  const settings = await getSettings();
  const lines = (await listLines()).filter((l) =>
    e164 ? l.e164 === e164 : true,
  );
  return {
    lastReputationCheckAt: settings.lastReputationCheckAt ?? null,
    lines: lines.map((line) => ({
      e164: line.e164,
      status: line.status,
      callbackRate7d: line.callbackRate7d ?? null,
      ...lineReputationView(line),
    })),
  };
}

async function persistLineReputation(input: {
  line: LineRecord;
  merged: ReputationResult;
  rateRow: { rate: number; attempts: number; callbacks: number };
  poolAvg: number;
  checkedAt: string;
}): Promise<{
  nextStatus: LineRecord["status"];
  action: string;
  reason?: string;
  supabaseOk: boolean;
}> {
  const { line, merged, rateRow, poolAvg, checkedAt } = input;
  const verdict = evaluateLineHealth({
    spamLabel: merged.label,
    attempts7d: rateRow.attempts,
    callbackRate7d: rateRow.rate,
    deliveryRate7d: null,
    optOutRate7d: null,
  });

  let nextStatus = line.status;
  if (verdict.action === "quarantine" && line.status !== "QUARANTINED") {
    nextStatus = "QUARANTINED";
  } else if (
    verdict.action === "degrade" &&
    (line.status === "HEALTHY" || line.status === "WARMING")
  ) {
    nextStatus = "DEGRADED";
  } else if (
    verdict.action === "keep" &&
    (line.status === "DEGRADED" || line.status === "QUARANTINED") &&
    merged.label === "UNFLAGGED"
  ) {
    // Lift only when the external check is clean
    nextStatus = line.warmupDay < 14 ? "WARMING" : "HEALTHY";
  }

  const source: ReputationSource =
    merged.source === "hiya" || merged.source === "calltracer" || merged.source === "manual"
      ? merged.source
      : "calltracer";

  await updateLine(line.id, {
    reputationLabel: merged.label,
    reputationScore: merged.score ?? null,
    reputationSource: source,
    reputationReportCount: merged.reportCount ?? null,
    lastReputationCheckAt: checkedAt,
    callbackRate7d: rateRow.rate,
    status: nextStatus,
  });

  const sbCaller = await upsertCallerIdNumber({
    e164: line.e164,
    provider: "twilio",
    purpose: "rvm",
    status: nextStatus.toLowerCase(),
    warmup_day: line.warmupDay,
    daily_cap_current: line.dailyCap,
    fcr_registered: false,
    reputation_label: merged.label,
    reputation_score: merged.score ?? null,
    reputation_source: source,
    last_reputation_check_at: checkedAt,
    callback_rate_7d: rateRow.rate,
    pool_avg_callback_rate_7d: poolAvg,
    retired_reason:
      verdict.action === "quarantine" ? verdict.reason : undefined,
    raw: {
      lineId: line.id,
      action: verdict.action,
      details: merged.details,
      attempts7d: rateRow.attempts,
      callbacks7d: rateRow.callbacks,
      reportCount: merged.reportCount ?? null,
    },
  });

  const callerId =
    sbCaller.ok &&
    Array.isArray(sbCaller.body) &&
    sbCaller.body[0] &&
    typeof sbCaller.body[0] === "object"
      ? String((sbCaller.body[0] as { id?: string }).id ?? "")
      : undefined;

  await insertReputationCheck({
    caller_id_number_id: callerId || undefined,
    e164: line.e164,
    checked_at: checkedAt,
    source,
    label: merged.label,
    score: merged.score ?? null,
    flagged: merged.flagged,
    details: {
      ...(merged.details ?? {}),
      action: verdict.action,
      statusHint: verdict.statusHint,
      reason: "reason" in verdict ? verdict.reason : undefined,
      callbackRate7d: rateRow.rate,
      poolAvgCallbackRate7d: poolAvg,
      attempts7d: rateRow.attempts,
      reportCount: merged.reportCount ?? null,
    },
  });

  return {
    nextStatus,
    action: verdict.action,
    reason: "reason" in verdict ? verdict.reason : undefined,
    supabaseOk: Boolean(sbCaller.ok),
  };
}

export async function runDailyReputationChecks(opts?: {
  force?: boolean;
  /** When set, check only this DID and skip the once-per-day gate. */
  e164?: string;
}): Promise<DailyReputationSummary> {
  const checkedAt = new Date().toISOString();
  const single = Boolean(opts?.e164);
  const gate = single
    ? { run: true as const }
    : await shouldRunDailyReputation(opts?.force === true);
  if (!gate.run) {
    return {
      ran: false,
      skippedReason: gate.reason,
      checkedAt,
      calltracerEnabled: true,
      hiyaEnabled: Boolean(process.env.HIYA_API_KEY?.trim()),
      lines: [],
      supabaseSynced: 0,
    };
  }

  const allLines = (await listLines()).filter(
    (l) => l.status !== "RETIRED" && !l.e164.includes("555"),
  );
  const lines = opts?.e164
    ? allLines.filter((l) => l.e164 === opts.e164)
    : allLines;

  if (opts?.e164 && lines.length === 0) {
    return {
      ran: true,
      skippedReason: "line_not_found",
      checkedAt,
      calltracerEnabled: true,
      hiyaEnabled: Boolean(process.env.HIYA_API_KEY?.trim()),
      lines: [],
      supabaseSynced: 0,
    };
  }

  const rates = await callbackRates7d(allLines);
  const poolAvg =
    allLines.length === 0
      ? 0
      : allLines.reduce((s, l) => s + (rates.get(l.e164)?.rate ?? 0), 0) /
        allLines.length;

  const phones = lines.map((l) => l.e164);
  const hiyaEnabled = Boolean(process.env.HIYA_API_KEY?.trim());
  const [calltracerResults, hiyaResults] = await Promise.all([
    checkCallTracerReputation(phones),
    hiyaEnabled ? checkHiyaReputation(phones) : Promise.resolve([]),
  ]);
  const calltracerByPhone = new Map(calltracerResults.map((r) => [r.e164, r]));
  const hiyaByPhone = new Map(hiyaResults.map((r) => [r.e164, r]));

  const summaryLines: DailyReputationSummary["lines"] = [];
  let supabaseSynced = 0;

  for (const line of lines) {
    const rateRow = rates.get(line.e164) ?? {
      rate: 0,
      attempts: 0,
      callbacks: 0,
    };
    // External signals only — callback metrics stay out of the merge.
    const merged: ReputationResult = mergeReputationResults(
      calltracerByPhone.get(line.e164),
      hiyaByPhone.get(line.e164),
    );
    if (!merged.e164) merged.e164 = line.e164;

    const persisted = await persistLineReputation({
      line,
      merged,
      rateRow,
      poolAvg,
      checkedAt,
    });
    if (persisted.supabaseOk) supabaseSynced += 1;

    const view = lineReputationView({
      reputationLabel: merged.label,
      reputationScore: merged.score,
      reputationSource: merged.source,
      reputationReportCount: merged.reportCount,
      lastReputationCheckAt: checkedAt,
    });

    summaryLines.push({
      e164: line.e164,
      label: merged.label,
      score: view.score,
      reportCount: view.reportCount,
      flagged: merged.flagged,
      status: persisted.nextStatus,
      action: persisted.action,
      reason: persisted.reason,
      source: merged.source,
      riskHint: view.riskHint,
    });
  }

  if (!single) {
    await updateSettings({ lastReputationCheckAt: checkedAt });
  }

  return {
    ran: true,
    checkedAt,
    calltracerEnabled: true,
    hiyaEnabled,
    lines: summaryLines,
    supabaseSynced,
  };
}
