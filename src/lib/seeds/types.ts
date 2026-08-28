/**
 * Seed / canary numbers — small set of known-good carrier phones that receive
 * periodic RVM deposits so we can detect "provider OK but no VM" failures.
 */

export type SeedNumber = {
  id: string;
  e164: string;
  label?: string;
  carrier?: string;
  active: boolean;
  /** Last time a seed drop was scheduled/sent */
  lastDropAt?: string;
  createdAt: string;
};

export const DEFAULT_SEED_INJECT_PER_CAMPAIGN_PER_DAY = 2;

/**
 * Pick active seeds that haven't been dropped today (UTC), up to `limit`.
 */
export function pickSeedsForInject(
  seeds: SeedNumber[],
  opts?: { limit?: number; now?: Date },
): SeedNumber[] {
  const now = opts?.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const limit = opts?.limit ?? DEFAULT_SEED_INJECT_PER_CAMPAIGN_PER_DAY;
  return seeds
    .filter((s) => s.active)
    .filter((s) => !s.lastDropAt || s.lastDropAt.slice(0, 10) !== day)
    .slice(0, limit);
}
