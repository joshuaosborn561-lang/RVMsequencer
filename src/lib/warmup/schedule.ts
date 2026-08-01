/**
 * Line warmup schedule for Twilio DIDs used as RVM / AMD caller IDs.
 *
 * Based on 2026 outbound DID guidance (LineShield / SIPNEX-style ramps):
 * start ~15–25/day, +20–30% every 2–3 days, full volume in ~10–14 days.
 * Steady-state default capped near 75–100/day/line (carrier analytics scrutiny band).
 */

export type WarmupProfile = {
  /** Day 1 starting cap */
  seedCap: number;
  /** Multiplier applied every `stepDays` */
  growthFactor: number;
  /** Days between growth steps */
  stepDays: number;
  /** Hard ceiling once warm */
  targetCap: number;
  /** Minimum days before allowing targetCap */
  minWarmDays: number;
};

export const DEFAULT_WARMUP_PROFILE: WarmupProfile = {
  seedCap: 20,
  growthFactor: 1.25,
  stepDays: 2,
  targetCap: 80,
  minWarmDays: 12,
};

/** Conservative profile when STIR/SHAKEN is A-level and FCR + Voice Integrity are done. */
export const ATTESTED_WARMUP_PROFILE: WarmupProfile = {
  seedCap: 25,
  growthFactor: 1.3,
  stepDays: 2,
  targetCap: 100,
  minWarmDays: 9,
};

/**
 * Compute today's allowed sends for a line on `warmupDay` (0-indexed from first send day).
 */
export function dailyCapForWarmupDay(
  warmupDay: number,
  profile: WarmupProfile = DEFAULT_WARMUP_PROFILE,
): number {
  if (warmupDay < 0) return 0;
  const steps = Math.floor(warmupDay / profile.stepDays);
  const raw = profile.seedCap * Math.pow(profile.growthFactor, steps);
  const capped = Math.min(profile.targetCap, Math.floor(raw));
  if (warmupDay < profile.minWarmDays) {
    return Math.min(capped, profile.targetCap - 1);
  }
  return Math.min(capped, profile.targetCap);
}

/** Full ramp table for UI / ops. */
export function buildWarmupSchedule(
  profile: WarmupProfile = DEFAULT_WARMUP_PROFILE,
  days = 16,
): Array<{ day: number; dailyCap: number }> {
  return Array.from({ length: days }, (_, day) => ({
    day: day + 1,
    dailyCap: dailyCapForWarmupDay(day, profile),
  }));
}

export function suggestLineStatus(input: {
  warmupDay: number;
  targetCap: number;
  profile?: WarmupProfile;
  reputation: "UNFLAGGED" | "MIXED_LOW" | "MIXED_HIGH" | "FLAGGED" | "UNKNOWN";
  deliveryRate7d?: number | null;
}): "WARMING" | "HEALTHY" | "DEGRADED" | "QUARANTINED" {
  if (input.reputation === "FLAGGED") return "QUARANTINED";
  if (input.reputation === "MIXED_HIGH") return "DEGRADED";
  if (
    input.deliveryRate7d != null &&
    input.deliveryRate7d < 0.5 &&
    input.warmupDay >= 5
  ) {
    return "DEGRADED";
  }
  const profile = input.profile ?? DEFAULT_WARMUP_PROFILE;
  const cap = dailyCapForWarmupDay(input.warmupDay, profile);
  if (cap < input.targetCap * 0.9 || input.warmupDay < profile.minWarmDays) {
    return "WARMING";
  }
  if (input.reputation === "MIXED_LOW") return "DEGRADED";
  return "HEALTHY";
}
