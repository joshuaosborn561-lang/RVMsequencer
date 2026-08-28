/**
 * Daily spam / blacklist / health pass over Twilio "from" DIDs.
 * Updates in-app line pool + mirrors results to Supabase.
 */

import {
  checkHiyaReputation,
  internalCallbackHealth,
  mergeReputation,
  type ReputationResult,
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
import {
  insertReputationCheck,
  upsertCallerIdNumber,
} from "@/lib/supabase/rvm-sync";

const DAY_MS = 24 * 60 * 60 * 1000;
const RECHECK_AFTER_MS = 20 * 60 * 60 * 1000; // ~once per day with cron slack

export type DailyReputationSummary = {
  ran: boolean;
  skippedReason?: string;
  checkedAt: string;
  hiyaEnabled: boolean;
  lines: Array<{
    e164: string;
    label: string;
    flagged: boolean;
    status: string;
    action: string;
    reason?: string;
  }>;
  supabaseSynced: number;
};

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

/** Callback rate per DID from inbox (toE164) vs attempts (lineId) over 7d. */
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

export async function runDailyReputationChecks(opts?: {
  force?: boolean;
}): Promise<DailyReputationSummary> {
  const checkedAt = new Date().toISOString();
  const gate = await shouldRunDailyReputation(opts?.force === true);
  if (!gate.run) {
    return {
      ran: false,
      skippedReason: gate.reason,
      checkedAt,
      hiyaEnabled: Boolean(process.env.HIYA_API_KEY?.trim()),
      lines: [],
      supabaseSynced: 0,
    };
  }

  const lines = (await listLines()).filter(
    (l) => l.status !== "RETIRED" && !l.e164.includes("555"),
  );
  const rates = await callbackRates7d(lines);
  const poolAvg =
    lines.length === 0
      ? 0
      : lines.reduce((s, l) => s + (rates.get(l.e164)?.rate ?? 0), 0) /
        lines.length;

  const phones = lines.map((l) => l.e164);
  const hiyaEnabled = Boolean(process.env.HIYA_API_KEY?.trim());
  const hiyaResults = hiyaEnabled ? await checkHiyaReputation(phones) : [];
  const hiyaByPhone = new Map(hiyaResults.map((r) => [r.e164, r]));

  const summaryLines: DailyReputationSummary["lines"] = [];
  let supabaseSynced = 0;

  for (const line of lines) {
    const rateRow = rates.get(line.e164) ?? {
      rate: 0,
      attempts: 0,
      callbacks: 0,
    };
    const internal = internalCallbackHealth({
      e164: line.e164,
      callbackRate7d: rateRow.rate,
      poolAvgCallbackRate7d: poolAvg,
    });
    const external = hiyaByPhone.get(line.e164);
    const merged: ReputationResult = mergeReputation(external, internal);

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
      // Only lift quarantine when external/internal both clean
      nextStatus = line.warmupDay < 14 ? "WARMING" : "HEALTHY";
    }

    await updateLine(line.id, {
      reputationLabel: merged.label,
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
      reputation_source: merged.source,
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
      },
    });
    if (sbCaller.ok) supabaseSynced += 1;

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
      source: merged.source,
      label: merged.label,
      score: merged.score ?? null,
      flagged: merged.flagged,
      details: {
        ...(merged.details ?? {}),
        action: verdict.action,
        statusHint: verdict.statusHint,
        reason: "reason" in verdict ? verdict.reason : undefined,
      },
    });

    summaryLines.push({
      e164: line.e164,
      label: merged.label,
      flagged: merged.flagged,
      status: nextStatus,
      action: verdict.action,
      reason: "reason" in verdict ? verdict.reason : undefined,
    });
  }

  await updateSettings({ lastReputationCheckAt: checkedAt });

  return {
    ran: true,
    checkedAt,
    hiyaEnabled,
    lines: summaryLines,
    supabaseSynced,
  };
}
