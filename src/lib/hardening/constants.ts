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

/** @deprecated Campaign ramp removed — per-line dailyCap is the only volume limit. Kept for old store rows. */
export const DEFAULT_CAMPAIGN_RAMP = {
  enabled: false,
  startPerDay: 15,
  incrementPerDay: 10,
  ceilingPerDay: 100,
};

/** When true, only lines with registeredFcr may be picked. */
export const DEFAULT_REQUIRE_FCR = false;

/** API rate limit (requests / window). */
export const API_RATE_LIMIT = { windowMs: 60_000, max: 120 };

/** Wait after accept before polling Slybroadcast campaign_result. */
export const RECEIPT_SETTLE_MS = 3 * 60 * 1000;

/** Max campaign_result polls per sequencer tick. */
export const RECEIPT_BATCH_CAP = 40;

/** Only refresh receipts updated within this lookback. */
export const RECEIPT_LOOKBACK_MS = 48 * 60 * 60 * 1000;

/** RECEIPT_HEALTH: min settled samples before failure-rate flag. */
export const RECEIPT_HEALTH_MIN_SAMPLES = 10;

/** RECEIPT_HEALTH: Failure share among settled samples (flag only). */
export const RECEIPT_HEALTH_FAILURE_RATE = 0.3;

/** RECEIPT_HEALTH: Pending older than this counts as stale. */
export const RECEIPT_STALE_PENDING_MS = 30 * 60 * 1000;

/** RECEIPT_HEALTH: stale Pending rows in this tick's batch (flag only). */
export const RECEIPT_STALE_PENDING_MIN = 10;
