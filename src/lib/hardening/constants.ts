/** Warmbly-inspired safety defaults for RVM Drop. */

/**
 * @deprecated Pool-wide hard cap removed — per-line dailyCap is the limit.
 * Kept only so older settings rows / counters don't break.
 */
export const HARD_CAP_DAILY_SENDS = Number.MAX_SAFE_INTEGER;

/** Max simultaneously ACTIVE campaigns. */
export const HARD_CAP_ACTIVE_CAMPAIGNS = 50;

/** Max RVM attempts to the same phone per UTC day. */
export const MAX_ATTEMPTS_PER_CONTACT_PER_DAY = 2;

/** Soft jitter fallback when pacing can't be derived (seconds). */
export const SEND_JITTER_MAX_SEC = 90;

/** Min seconds between sends on the same line (mailbox spacing). */
export const DEFAULT_LINE_MIN_GAP_SEC = 600;

/** Per-campaign advisory lease TTL. */
export const CAMPAIGN_LEASE_MS = 4 * 60 * 1000;

/** Stale SENDING reclaim window. */
export const STALE_SENDING_MS = 15 * 60 * 1000;

/** Default campaign ramp (only lowers volume vs line caps). */
export const DEFAULT_CAMPAIGN_RAMP = {
  enabled: true,
  startPerDay: 15,
  incrementPerDay: 10,
  ceilingPerDay: 100,
};

/** When true, only lines with registeredFcr may be picked. */
export const DEFAULT_REQUIRE_FCR = false;

/** API rate limit (requests / window). */
export const API_RATE_LIMIT = { windowMs: 60_000, max: 120 };
