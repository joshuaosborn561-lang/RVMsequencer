import { SEND_JITTER_MAX_SEC } from "@/lib/hardening/constants";

/**
 * Humanize send timing: avoid always sending on the tick boundary.
 * Returns a Date in the future (or now) with 0..maxSec random delay.
 * Also nudges away from exact :00 / :30 local minutes when possible.
 */
export function humanizeSendAt(
  base: Date,
  opts?: { maxJitterSec?: number; salt?: string },
): Date {
  const max = opts?.maxJitterSec ?? SEND_JITTER_MAX_SEC;
  const n = opts?.salt
    ? hashToUnit(opts.salt)
    : Math.random();
  let ms = Math.floor(n * max * 1000);
  const minute = new Date(base.getTime() + ms).getUTCMinutes();
  if (minute === 0 || minute === 30) {
    ms += 17_000 + Math.floor(n * 40_000);
  }
  return new Date(base.getTime() + ms);
}

function hashToUnit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}
