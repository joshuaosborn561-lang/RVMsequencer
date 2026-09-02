/**
 * Allo → RVM suppression sync (rules A / B / C).
 */

import { toE164 } from "@/lib/phone";
import { getSuppression, suppressLeadByPhone } from "@/lib/store/db";
import {
  assertAlloSyncReady,
  getConversationItemWithTranscript,
  isAlloSyncEnabled,
  iterateCallsForLine,
  listAlloNumbers,
  maskPhone,
  type AlloConversationItem,
  type AlloTranscriptEntry,
} from "./client";
import {
  isRuleCCandidate,
  matchRuleA,
  matchRuleB,
  type AlloSuppressRule,
} from "./rules";
import { phoneInScope } from "./scope";
import { attachAlloSuppressionMeta } from "./suppress-meta";
import {
  getAlloSyncState,
  saveAlloSyncState,
  suppressionScope,
  type AlloSyncRunStats,
  type AlloSyncState,
  type AlloUndeterminedRow,
} from "./sync-state";
import {
  classifyVoicemailCheap,
  classifyVoicemailFromTranscript,
  type VoicemailVerdict,
} from "./voicemail";

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Spec: 10-digit US normalize then E.164. */
export function normalizeContactPhone(raw: string | undefined): string | null {
  if (!raw) return null;
  const ten = raw.replace(/\D/g, "").match(/(\d{10})$/)?.[1];
  if (!ten) return null;
  return toE164(ten);
}

function contactRaw(item: AlloConversationItem): string | undefined {
  if (item.contact_number) return item.contact_number;
  const dir = (item.direction ?? "").toUpperCase();
  if (dir === "INBOUND") return item.from_number ?? item.contact_number;
  return item.to_number ?? item.contact_number;
}

function normalizeTranscript(
  raw: AlloConversationItem["transcript"] | { transcripts?: AlloTranscriptEntry[] } | null | undefined,
): AlloTranscriptEntry[] | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object" && Array.isArray((raw as { transcripts?: AlloTranscriptEntry[] }).transcripts)) {
    return (raw as { transcripts: AlloTranscriptEntry[] }).transcripts;
  }
  return null;
}

/** Fetch transcript once per call id; cache on item + state. */
async function ensureTranscript(
  item: AlloConversationItem,
  state: AlloSyncState,
): Promise<AlloTranscriptEntry[] | null> {
  const existing = normalizeTranscript(item.transcript);
  if (existing && existing.length > 0) return existing;
  try {
    const full = await getConversationItemWithTranscript(item.id);
    const t = normalizeTranscript(full.transcript);
    item.transcript = t;
    return t;
  } catch (err) {
    console.warn("[allo-sync] transcript fetch failed", item.id, err);
    state.voicemailCache[item.id] = state.voicemailCache[item.id] ?? "undetermined";
    return null;
  }
}

async function resolveVoicemail(
  item: AlloConversationItem,
  state: AlloSyncState,
): Promise<VoicemailVerdict> {
  const cached = state.voicemailCache[item.id];
  if (cached === "voicemail") return { kind: "voicemail", rung: 1 };
  if (cached === "conversation") return { kind: "conversation", rung: 3 };
  if (cached === "undetermined") return { kind: "undetermined", rung: 4 };

  const cheap = classifyVoicemailCheap(item);
  if (cheap) {
    state.voicemailCache[item.id] = cheap.kind;
    return cheap;
  }

  const transcript = await ensureTranscript(item, state);
  const verdict = classifyVoicemailFromTranscript(transcript);
  state.voicemailCache[item.id] = verdict.kind;
  return verdict;
}

/**
 * Rule A: tag / summary first. Transcript is checked if already present on the
 * item (e.g. prior fetch). We do not fetch transcripts solely for Rule A —
 * expensive extend=transcript is reserved for Rule C rung 3 (and Done #3 is
 * covered when transcript is already attached). After a Rule C transcript
 * fetch we re-check Rule A before suppressing as conversation.
 */
function matchRuleAB(item: AlloConversationItem): AlloSuppressRule | null {
  return matchRuleA(item) ?? matchRuleB(item);
}

async function applySuppress(
  phoneE164: string,
  match: AlloSuppressRule,
  item: AlloConversationItem,
): Promise<"created" | "exists" | "skipped_scope"> {
  if (!(await phoneInScope(phoneE164))) return "skipped_scope";

  const alloMeta = {
    alloCallId: item.id,
    alloLine: item.allo_number,
    alloRep: item.user?.name ?? item.user?.id ?? null,
    durationSec: item.duration ?? null,
    direction: item.direction ?? null,
    tags: item.tags ?? [],
    callDate: item.date ?? null,
    rule: match.rule,
    ...(match.rule === "allo_tag" ? { tagKey: match.tagKey } : {}),
  };

  const existing = await getSuppression(phoneE164);
  if (existing) {
    await attachAlloSuppressionMeta(phoneE164, alloMeta);
    if (match.rule === "allo_dnc") {
      await suppressLeadByPhone(phoneE164, match.reason, {
        source: "ALLO",
        markDnc: true,
        alloMeta,
      });
    }
    return "exists";
  }

  await suppressLeadByPhone(phoneE164, match.reason, {
    source: "ALLO",
    markDnc: match.rule === "allo_dnc",
    alloMeta,
  });
  return "created";
}

async function evaluateCall(
  item: AlloConversationItem,
  state: AlloSyncState,
  stats: AlloSyncRunStats,
  processed: Set<string>,
): Promise<void> {
  if (processed.has(item.id)) {
    stats.skippedAlready += 1;
    return;
  }

  const phoneE164 = normalizeContactPhone(contactRaw(item));
  if (!phoneE164) {
    processed.add(item.id);
    state.processedCallIds.push(item.id);
    return;
  }

  // Rule A then B — no duration / voicemail gate
  let match = matchRuleAB(item);

  // Inbound DNC often lives only in transcript (Done #3). Rule C never
  // runs for inbound, so fetch transcript once when tag/summary missed A/B.
  if (
    !match &&
    (item.direction ?? "").toUpperCase() === "INBOUND"
  ) {
    await ensureTranscript(item, state);
    match = matchRuleA(item);
  }

  if (match) {
    try {
      const r = await applySuppress(phoneE164, match, item);
      if (r === "created") {
        if (match.rule === "allo_dnc") stats.suppressed.allo_dnc += 1;
        else if (match.rule === "allo_tag") stats.suppressed.allo_tag += 1;
        else stats.suppressed.allo_conversation += 1;
      } else if (r === "exists") {
        stats.skippedAlready += 1;
      }
    } catch (err) {
      stats.errors += 1;
      console.error("[allo-sync] suppress failed", maskPhone(phoneE164), err);
    }
    processed.add(item.id);
    state.processedCallIds.push(item.id);
    return;
  }

  // Rule C — outbound, duration > 15, not voicemail
  if (!isRuleCCandidate(item)) {
    processed.add(item.id);
    state.processedCallIds.push(item.id);
    return;
  }

  const vm = await resolveVoicemail(item, state);

  // Transcript may now be on the item — re-check Rule A (removal language)
  const dncAfterTranscript = matchRuleA(item);
  if (dncAfterTranscript) {
    try {
      const r = await applySuppress(phoneE164, dncAfterTranscript, item);
      if (r === "created") stats.suppressed.allo_dnc += 1;
      else if (r === "exists") stats.skippedAlready += 1;
    } catch (err) {
      stats.errors += 1;
      console.error("[allo-sync] suppress A@C failed", maskPhone(phoneE164), err);
    }
    processed.add(item.id);
    state.processedCallIds.push(item.id);
    return;
  }

  if (vm.kind === "voicemail") {
    processed.add(item.id);
    state.processedCallIds.push(item.id);
    return;
  }
  if (vm.kind === "undetermined") {
    stats.undetermined += 1;
    const row: AlloUndeterminedRow = {
      callId: item.id,
      alloNumberLast4: maskPhone(item.allo_number).slice(-4),
      contactLast4: maskPhone(contactRaw(item)).slice(-4),
      duration: item.duration ?? undefined,
      direction: item.direction,
      date: item.date,
      summarySnippet: (item.summary ?? "").slice(0, 120),
      recordedAt: new Date().toISOString(),
    };
    state.undetermined.push(row);
    processed.add(item.id);
    state.processedCallIds.push(item.id);
    return;
  }

  try {
    const r = await applySuppress(
      phoneE164,
      { rule: "allo_conversation", reason: "allo_conversation" },
      item,
    );
    if (r === "created") stats.suppressed.allo_conversation += 1;
    else if (r === "exists") stats.skippedAlready += 1;
  } catch (err) {
    stats.errors += 1;
    console.error("[allo-sync] suppress C failed", maskPhone(phoneE164), err);
  }
  processed.add(item.id);
  state.processedCallIds.push(item.id);
}

export type AlloSyncResult = AlloSyncRunStats & {
  ran: boolean;
  skippedReason?: string;
};

/**
 * Hourly (or backfill) sync. Cursor advances only after a fully successful run.
 */
export async function runAlloSuppressionSync(opts?: {
  backfill?: boolean;
  force?: boolean;
}): Promise<AlloSyncResult> {
  if (!isAlloSyncEnabled() && !opts?.force) {
    return {
      ran: false,
      skippedReason: "disabled",
      at: new Date().toISOString(),
      mode: opts?.backfill ? "backfill" : "hourly",
      callsScanned: 0,
      suppressed: { allo_dnc: 0, allo_tag: 0, allo_conversation: 0 },
      undetermined: 0,
      skippedAlready: 0,
      errors: 0,
    };
  }

  assertAlloSyncReady();

  const state = await getAlloSyncState();
  // One-shot full history at first enable, then hourly cursor takes over
  const doBackfill = Boolean(opts?.backfill) || !state.backfillCompletedAt;
  const now = new Date();
  const stats: AlloSyncRunStats = {
    at: now.toISOString(),
    mode: doBackfill ? "backfill" : "hourly",
    callsScanned: 0,
    suppressed: { allo_dnc: 0, allo_tag: 0, allo_conversation: 0 },
    undetermined: 0,
    skippedAlready: 0,
    errors: 0,
  };

  // Hourly gate (~55 min) unless force/backfill
  if (!doBackfill && !opts?.force && state.lastRun?.at) {
    const elapsed = now.getTime() - Date.parse(state.lastRun.at);
    if (elapsed < 55 * 60 * 1000) {
      return {
        ran: false,
        skippedReason: "hourly_gate",
        ...stats,
        at: state.lastRun.at,
      };
    }
  }

  let dateFrom: string;
  const dateTo = ymd(now);
  if (doBackfill) {
    dateFrom = "2020-01-01";
  } else if (state.cursorIso) {
    const cursor = new Date(state.cursorIso);
    const overlap = new Date(cursor.getTime() - 60 * 60 * 1000);
    dateFrom = ymd(overlap);
  } else {
    dateFrom = ymd(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
  }

  const numbers = await listAlloNumbers();
  const processed = new Set(state.processedCallIds);
  let failed = false;

  try {
    for (const num of numbers) {
      if (!num.number) continue;
      for await (const item of iterateCallsForLine({
        alloNumber: num.number,
        dateFrom,
        dateTo,
      })) {
        stats.callsScanned += 1;
        await evaluateCall(item, state, stats, processed);
      }
    }
  } catch (err) {
    failed = true;
    stats.errors += 1;
    console.error("[allo-sync] run failed — cursor not advanced", err);
  }

  stats.cursorThrough = dateTo;
  state.lastRun = stats;

  if (!failed) {
    state.cursorIso = now.toISOString();
    if (doBackfill) {
      state.backfillCompletedAt = now.toISOString();
    }
  }

  await saveAlloSyncState(state);

  return { ran: !failed, skippedReason: failed ? "error" : undefined, ...stats };
}

/** Status payload for MCP — no phone numbers. */
export async function getAlloSuppressionSyncStatus() {
  const state = await getAlloSyncState();
  const lr = state.lastRun;
  return {
    enabled: isAlloSyncEnabled(),
    configured: Boolean(process.env.ALLO_API_KEY?.trim()),
    scope: suppressionScope(),
    cursorIso: state.cursorIso,
    backfillCompletedAt: state.backfillCompletedAt ?? null,
    lastRunAt: lr?.at ?? null,
    lastRunMode: lr?.mode ?? null,
    callsScanned: lr?.callsScanned ?? 0,
    suppressed: lr?.suppressed ?? {
      allo_dnc: 0,
      allo_tag: 0,
      allo_conversation: 0,
    },
    undetermined: lr?.undetermined ?? 0,
    undeterminedQueued: state.undetermined.length,
    skippedAlready: lr?.skippedAlready ?? 0,
    errors: lr?.errors ?? 0,
    processedCallCount: state.processedCallIds.length,
  };
}
