import { getRvmProviderId } from "@/lib/config";
import {
  RECEIPT_BATCH_CAP,
  RECEIPT_HEALTH_FAILURE_RATE,
  RECEIPT_HEALTH_MIN_SAMPLES,
  RECEIPT_LOOKBACK_MS,
  RECEIPT_SETTLE_MS,
  RECEIPT_STALE_PENDING_MIN,
  RECEIPT_STALE_PENDING_MS,
} from "@/lib/hardening/constants";
import { reconcileProviderDelivery } from "@/lib/sequencer/reconcile-delivery";
import type { ProviderDeliveryEvent } from "@/lib/sequencer/reconcile-delivery";
import { appendAudit } from "@/lib/store/db";
import { listPendingReceiptCandidates } from "@/lib/store/scheduled";
import {
  listPendingRvmDrops,
  refreshSlybroadcastOutcome,
} from "@/lib/supabase/rvm-sync";

export type ReceiptDelivery =
  | "delivered"
  | "sent"
  | "failed"
  | "queued";

export type ReceiptOutcome = {
  ok: boolean;
  dialStatus?: string;
  failReason?: string;
  error?: string;
};

export type ReceiptRefreshSummary = {
  refreshed: number;
  ok: number;
  failed: number;
  stillPending: number;
  flag?: "RECEIPT_HEALTH";
  health?: {
    reason?: string;
    failureRate?: number;
    stalePending?: number;
  };
};

export type FetchReceiptOutcome = (
  sessionId: string,
) => Promise<ReceiptOutcome>;

/** Map Slybroadcast dial_status onto scheduled-send deliveryStatus. */
export function mapDialStatusToDelivery(
  dialStatus: string | null | undefined,
): ReceiptDelivery {
  const s = String(dialStatus ?? "")
    .trim()
    .toLowerCase();
  if (s === "ok" || s === "success" || s === "delivered") return "delivered";
  if (s === "sent") return "sent";
  if (s === "failure" || s === "failed" || s === "error") return "failed";
  return "queued";
}

export function receiptHealthFlag(input: {
  ok: number;
  failed: number;
  stalePending: number;
  minSamples?: number;
  failureRateThreshold?: number;
  stalePendingMin?: number;
}): {
  flag?: "RECEIPT_HEALTH";
  reason?: string;
  failureRate?: number;
} {
  const minSamples = input.minSamples ?? RECEIPT_HEALTH_MIN_SAMPLES;
  const failThresh = input.failureRateThreshold ?? RECEIPT_HEALTH_FAILURE_RATE;
  const staleMin = input.stalePendingMin ?? RECEIPT_STALE_PENDING_MIN;
  const settled = input.ok + input.failed;
  const failureRate = settled > 0 ? input.failed / settled : 0;
  const highFail = settled >= minSamples && failureRate >= failThresh;
  const stale = input.stalePending >= staleMin;
  if (!highFail && !stale) return { failureRate };
  return {
    flag: "RECEIPT_HEALTH",
    reason:
      highFail && stale
        ? "high_failure_rate_and_stale_pending"
        : highFail
          ? "high_failure_rate"
          : "stale_pending",
    failureRate,
  };
}

function defaultFetchOutcome(sessionId: string): Promise<ReceiptOutcome> {
  return refreshSlybroadcastOutcome(sessionId);
}

/**
 * Poll Slybroadcast campaign_result for accepted sends still Pending/queued.
 * Updates rvm_drops (via refreshSlybroadcastOutcome) and scheduled-send
 * deliveryStatus via reconcileProviderDelivery. Never pauses campaigns.
 */
export async function refreshPendingReceipts(opts?: {
  now?: Date;
  settleMs?: number;
  lookbackMs?: number;
  batchCap?: number;
  stalePendingMs?: number;
  fetchOutcome?: FetchReceiptOutcome;
}): Promise<ReceiptRefreshSummary> {
  const now = opts?.now ?? new Date();
  const settleMs = opts?.settleMs ?? RECEIPT_SETTLE_MS;
  const lookbackMs = opts?.lookbackMs ?? RECEIPT_LOOKBACK_MS;
  const batchCap = opts?.batchCap ?? RECEIPT_BATCH_CAP;
  const stalePendingMs = opts?.stalePendingMs ?? RECEIPT_STALE_PENDING_MS;
  const fetchOutcome = opts?.fetchOutcome;

  if (!fetchOutcome && getRvmProviderId() === "MOCK") {
    return { refreshed: 0, ok: 0, failed: 0, stillPending: 0 };
  }

  const loadOutcome = fetchOutcome ?? defaultFetchOutcome;
  const olderThanIso = new Date(now.getTime() - settleMs).toISOString();
  const newerThanIso = new Date(now.getTime() - lookbackMs).toISOString();

  const scheduled = await listPendingReceiptCandidates({
    now,
    settleMs,
    lookbackMs,
    limit: batchCap,
  });

  const seen = new Set<string>();
  const sessions: Array<{ sessionId: string; updatedAt?: string }> = [];
  for (const row of scheduled) {
    const sessionId = row.providerMsgId?.trim();
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);
    sessions.push({ sessionId, updatedAt: row.updatedAt });
  }

  if (sessions.length < batchCap && getRvmProviderId() !== "MOCK") {
    try {
      const drops = await listPendingRvmDrops({
        olderThanIso,
        newerThanIso,
        limit: batchCap - sessions.length,
      });
      for (const drop of drops) {
        const sessionId = drop.provider_session_id.trim();
        if (!sessionId || seen.has(sessionId)) continue;
        seen.add(sessionId);
        sessions.push({
          sessionId,
          updatedAt: drop.updated_at ?? drop.queued_at,
        });
        if (sessions.length >= batchCap) break;
      }
    } catch (err) {
      console.error("[receipts] listPendingRvmDrops failed", err);
    }
  }

  const summary: ReceiptRefreshSummary = {
    refreshed: 0,
    ok: 0,
    failed: 0,
    stillPending: 0,
  };
  let stalePending = 0;

  for (const item of sessions.slice(0, batchCap)) {
    summary.refreshed += 1;
    let outcome: ReceiptOutcome;
    try {
      outcome = await loadOutcome(item.sessionId);
    } catch (err) {
      summary.stillPending += 1;
      console.error("[receipts] campaign_result failed", item.sessionId, err);
      continue;
    }

    const delivery = mapDialStatusToDelivery(outcome.dialStatus);
    if (delivery === "queued" || !outcome.ok) {
      summary.stillPending += 1;
      const stamp = item.updatedAt ? Date.parse(item.updatedAt) : NaN;
      if (
        Number.isFinite(stamp) &&
        now.getTime() - stamp >= stalePendingMs
      ) {
        stalePending += 1;
      }
      continue;
    }

    const event: ProviderDeliveryEvent = {
      provider: "SLYBROADCAST",
      providerMessageId: item.sessionId,
      status: delivery,
      errorDetail:
        delivery === "failed"
          ? outcome.failReason || "Failure"
          : undefined,
    };
    try {
      await reconcileProviderDelivery(event);
    } catch (err) {
      console.error("[receipts] reconcile failed", item.sessionId, err);
    }

    if (delivery === "failed") summary.failed += 1;
    else summary.ok += 1;
  }

  const health = receiptHealthFlag({
    ok: summary.ok,
    failed: summary.failed,
    stalePending,
  });
  if (health.flag) {
    summary.flag = health.flag;
    summary.health = {
      reason: health.reason,
      failureRate: health.failureRate,
      stalePending,
    };
    try {
      await appendAudit({
        action: "RECEIPT_HEALTH",
        actor: "cron",
        entityType: "sequencer",
        detail: {
          ...summary.health,
          refreshed: summary.refreshed,
          ok: summary.ok,
          failed: summary.failed,
          stillPending: summary.stillPending,
        },
      });
    } catch (err) {
      console.error("[receipts] RECEIPT_HEALTH audit failed", err);
    }
  }

  return summary;
}
