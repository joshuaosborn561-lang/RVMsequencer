import { DEFAULT_LINE_MIN_GAP_SEC } from "@/lib/hardening/constants";
import type { LineRecord } from "@/lib/store/types";
import { rebalanceCampaignSchedule } from "@/lib/store/scheduled";

/**
 * When the line pool is exhausted (caps / min-gap), push pending work forward
 * instead of spinning the same due rows every tick.
 */
export async function rebalanceOnCapacityExhausted(input: {
  campaignId: string;
  lines: LineRecord[];
  now?: Date;
}): Promise<{ deferred: number; deferMs: number }> {
  const now = input.now ?? new Date();
  const gaps = input.lines
    .map((l) => {
      if (!l.lastSentAt) return 0;
      const minGap = (l.minGapSec ?? DEFAULT_LINE_MIN_GAP_SEC) * 1000;
      const elapsed = now.getTime() - Date.parse(l.lastSentAt);
      return Math.max(0, minGap - elapsed);
    })
    .filter((ms) => ms > 0);

  // Default: defer 15m if every line is at daily cap with no gap info
  const deferMs =
    gaps.length > 0
      ? Math.min(...gaps) + 5_000
      : 15 * 60 * 1000;

  const deferred = await rebalanceCampaignSchedule({
    campaignId: input.campaignId,
    deferMs: Math.max(60_000, deferMs),
    now,
    reason: "CAPACITY_REBALANCE",
  });

  return { deferred, deferMs };
}

/** True when no line can accept another send right now. */
export function poolExhausted(lines: LineRecord[], now = new Date()): boolean {
  return !lines.some((l) => {
    if (!["WARMING", "HEALTHY", "DEGRADED"].includes(l.status)) return false;
    if (l.reputationLabel === "FLAGGED") return false;
    if (l.sentToday >= l.dailyCap) return false;
    if (l.lastSentAt && l.minGapSec) {
      const elapsed = (now.getTime() - Date.parse(l.lastSentAt)) / 1000;
      if (elapsed < l.minGapSec) return false;
    }
    return true;
  });
}
