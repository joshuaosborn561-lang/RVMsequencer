import { MAX_SEND_ATTEMPTS } from "@/lib/store/types";

/** Exponential backoff capped at 6h. attemptCount is 1-based after the failure. */
export function failureBackoffMs(attemptCount: number): number {
  const exp = Math.min(Math.max(attemptCount, 1), 12);
  const ms = Math.min(6 * 60 * 60 * 1000, 5 * 60 * 1000 * 2 ** (exp - 1));
  return ms;
}

export function nextFailureEligibleAt(
  attemptCount: number,
  now = new Date(),
): Date {
  return new Date(now.getTime() + failureBackoffMs(attemptCount));
}

export function shouldGiveUp(attemptCount: number): boolean {
  return attemptCount >= MAX_SEND_ATTEMPTS;
}
