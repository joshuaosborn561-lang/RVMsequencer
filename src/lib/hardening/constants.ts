/** Warmbly-inspired safety defaults for RVM Drop. */

/** Min seconds between sends on the same line (mailbox spacing). */
export const DEFAULT_LINE_MIN_GAP_SEC = 600;

/** Soft jitter inside an open send window (seconds). */
export const SEND_JITTER_MAX_SEC = 90;

/** Per-campaign advisory lease TTL. */
export const CAMPAIGN_LEASE_MS = 4 * 60 * 1000;

/** Stale SENDING reclaim window. */
export const STALE_SENDING_MS = 15 * 60 * 1000;

/** Org-wide hard cap on RVM deposits per UTC day. */
export const HARD_CAP_DAILY_SENDS = 1000;

/** Max simultaneously ACTIVE campaigns. */
export const HARD_CAP_ACTIVE_CAMPAIGNS = 50;

/** Default campaign ramp (only lowers volume vs line caps). */
export const DEFAULT_CAMPAIGN_RAMP = {
  enabled: false,
  startPerDay: 25,
  incrementPerDay: 25,
  ceilingPerDay: 200,
};

/** API rate limit (requests / window). */
export const API_RATE_LIMIT = { windowMs: 60_000, max: 120 };
