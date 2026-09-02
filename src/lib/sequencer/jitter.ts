import { SEND_JITTER_MAX_SEC } from "@/lib/hardening/constants";

/**
 * Soft jitter paces **first enqueue** only. Claimed rows are already due
 * (`runAt <= now`); re-applying `humanizeSendAt(now)` every tick defers
 * forever because salt-based jitter is almost always >5s.
 *
 * Seeds and send-now skip jitter entirely.
 */
export function shouldDeferClaimedSendForJitter(input: {
  immediate?: boolean;
  isSeed?: boolean;
  runAt: Date | string | number;
  now: Date;
}): boolean {
  if (input.immediate || input.isSeed) return false;
  const runAtMs = new Date(input.runAt).getTime();
  if (!Number.isFinite(runAtMs)) return false;
  return runAtMs > input.now.getTime();
}

/**
 * Humanize send timing.
 * Prefer pacing-based ±40% of ideal interval (window ÷ dailyCap);
 * fall back to fixed SEND_JITTER_MAX_SEC.
 */
export function humanizeSendAt(
  base: Date,
  opts?: {
    maxJitterSec?: number;
    salt?: string;
    /** Send-window length in hours (exclusive end − start). */
    windowHours?: number;
    /** Effective daily cap used for pacing. */
    dailyCap?: number;
  },
): Date {
  let max = opts?.maxJitterSec;
  if (max == null && opts?.windowHours != null && opts?.dailyCap != null) {
    max = pacingJitterSec({
      windowHours: opts.windowHours,
      dailyCap: opts.dailyCap,
    });
  }
  max = max ?? SEND_JITTER_MAX_SEC;

  const n = opts?.salt ? hashToUnit(opts.salt) : Math.random();
  let ms = Math.floor(n * max * 1000);
  const minute = new Date(base.getTime() + ms).getUTCMinutes();
  if (minute === 0 || minute === 30) {
    ms += 17_000 + Math.floor(n * 40_000);
  }
  return new Date(base.getTime() + ms);
}

/**
 * Ideal gap = windowSec / dailyCap.
 * Max defer jitter = 40% of that ideal (±40% pacing).
 */
export function pacingJitterSec(input: {
  windowHours: number;
  dailyCap: number;
}): number {
  const windowSec = Math.max(1, input.windowHours) * 3600;
  const ideal = windowSec / Math.max(1, input.dailyCap);
  const fortyPct = ideal * 0.4;
  // Keep defer usable on a 5-min cron: at least 30s, at most 45 min
  return Math.round(Math.min(45 * 60, Math.max(30, fortyPct)));
}

function hashToUnit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}
