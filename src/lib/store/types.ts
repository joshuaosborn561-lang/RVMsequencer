export type ClientRecord = {
  id: string;
  name: string;
  createdAt: string;
  /**
   * When true, inbound callbacks (voice) and inbox CALLBACK tags sync to HubSpot
   * for this client's campaigns. Requires HUBSPOT_ACCESS_TOKEN.
   */
  hubspotOptIn?: boolean;
  /** Optional HubSpot owner id for assigned callbacks. */
  hubspotOwnerId?: string;
};

export type ApiKeyRecord = {
  id: string;
  clientId: string;
  name: string;
  /** SHA-256 hex of secret (never store plaintext after create). */
  keyHash: string;
  /** Prefix shown in UI, e.g. ds_abcd12… */
  keyPrefix: string;
  /** Only present on create response — never persisted. */
  key?: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};

export type SequenceStepRecord = {
  id: string;
  position: number;
  delayDays: number;
  scriptTemplate: string;
  /** @deprecated ElevenLabs removed — kept for old store rows */
  voiceId?: string;
  /** Hosted audio URL for Slybroadcast c_url */
  audioUrl?: string;
};

export type CampaignRecord = {
  id: string;
  clientId?: string;
  name: string;
  status: "DRAFT" | "SCHEDULED" | "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";
  createdAt: string;
  updatedAt: string;
  steps: SequenceStepRecord[];
  lineIds: string[];
  schedule: {
    sendWindowStart: number;
    sendWindowEnd: number;
    sendDays: number[];
        timezoneMode: "RECIPIENT_LOCAL" | "FIXED";
    fixedTimezone?: string;
    /** @deprecated Ignored — per-line dailyCap is the volume limit. */
    newLeadsPerDay: number;
    requireConsent: boolean;
    stopOnCallback: boolean;
    stopOnOptOut: boolean;
  };
  /**
   * @deprecated Ignored — volume is limited only by per-line dailyCap (warmup).
   * Kept so older campaign rows / API clients don't break.
   */
  ramp?: {
    enabled: boolean;
    startPerDay: number;
    incrementPerDay: number;
    ceilingPerDay: number;
    /** Day 0 = first ACTIVE day */
    activeDay?: number;
    activatedAt?: string;
  };
  /** Hosted audio URL for Slybroadcast c_url */
  audioUrl?: string;
  /** @deprecated Drop.co removed as default — old store rows only */
  dropCoCampaignToken?: string;
  /** @deprecated ElevenLabs removed */
  elevenVoiceId?: string;
  lastDrainAt?: string;
  lastDrainStats?: {
    attempted: number;
    sent: number;
    skipped: number;
    failed: number;
  };
  lastError?: string;
  /** Advisory lease for concurrent drain. */
  leaseOwner?: string;
  leaseUntil?: string;
};

export type LeadSendStatus =
  | "PENDING"
  | "SENDING"
  | "SENT"
  | "FAILED"
  | "SUPPRESSED";

export type LeadRecord = {
  id: string;
  campaignId: string;
  phoneE164: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  email?: string;
  timezone?: string;
  custom: Record<string, string>;
  dnc: boolean;
  consentStatus:
    | "UNKNOWN"
    | "EXPRESS_WRITTEN"
    | "EXPRESS_ORAL"
    | "ESTABLISHED_BUSINESS"
    | "OPTED_OUT";
  createdAt: string;
  status?: LeadSendStatus;
  attemptCount?: number;
  nextEligibleAt?: string;
  lastAttemptAt?: string;
  sentAt?: string;
  lastError?: string;
  providerMessageId?: string;
  suppressReason?: string;
  /** Sticky line for follow-ups (Warmbly / cold-cli pattern). */
  stickyLineId?: string;
  /** Current / last completed sequence step position. */
  currentStepPosition?: number;
};

export type AttemptRecord = {
  id: string;
  campaignId: string;
  leadId: string;
  lineId?: string;
  status:
    | "QUEUED"
    | "SENDING"
    | "SENT"
    | "SKIPPED"
    | "FAILED"
    | "SUPPRESSED";
  reason?: string;
  providerMessageId?: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type AlloSuppressionMeta = {
  alloCallId: string;
  alloLine?: string;
  alloRep?: string | null;
  durationSec?: number | null;
  direction?: string | null;
  tags?: string[];
  callDate?: string | null;
  rule: string;
  tagKey?: string;
  updatedAt?: string;
};

export type SuppressionRecord = {
  id: string;
  phoneE164: string;
  reason: string;
  source:
    | "IMPORT"
    | "SCRUB"
    | "SMS_STOP"
    | "INBOX"
    | "CALLBACK"
    | "MANUAL"
    | "BOUNCE"
    | "ALLO";
  createdAt: string;
  /** Audit fields when source is ALLO (call id, line, tags, rule). */
  alloMeta?: AlloSuppressionMeta;
};

export type LineRecord = {
  id: string;
  e164: string;
  areaCode?: string;
  status: "PROVISIONING" | "WARMING" | "HEALTHY" | "DEGRADED" | "QUARANTINED" | "RETIRED";
  warmupDay: number;
  dailyCap: number;
  sentToday: number;
  sentTodayDate?: string;
  lastSentAt?: string;
  reputationLabel: "UNFLAGGED" | "MIXED_LOW" | "MIXED_HIGH" | "FLAGGED" | "UNKNOWN";
  /** CallTracer spam_score (or Hiya score) from last external check. */
  reputationScore?: number | null;
  /** Who produced the stored spam label. */
  reputationSource?: "calltracer" | "hiya" | "manual";
  /** Crowd/carrier report count from last check when the source provides one. */
  reputationReportCount?: number | null;
  /** ISO timestamp of last CallTracer/Hiya check for this DID. */
  lastReputationCheckAt?: string;
  /** 7d callback/attempt rate — display only, never a spam label. */
  callbackRate7d?: number | null;
  minGapSec?: number;
  /** Free Caller Registry / Voice Integrity registration complete. */
  registeredFcr?: boolean;
  /** UTC date YYYY-MM-DD of last warmup day advance. */
  lastWarmupAdvanceDate?: string;
};

export type InboxMessage = {
  id: string;
  clientId?: string;
  campaignId?: string;
  leadId?: string;
  fromE164: string;
  toE164: string;
  channel: "VOICE_CALLBACK" | "SMS" | "NOTE";
  body: string;
  category: "UNREAD" | "INTERESTED" | "NOT_INTERESTED" | "CALLBACK" | "DNC" | "OTHER";
  createdAt: string;
  readAt?: string;
  providerEventId?: string;
};

export type WorkspaceSettings = {
  callForwardToE164?: string;
  callForwardTimeoutSec?: number;
  /**
   * When true, Allo/callee must press 1 before the lead is bridged.
   * Default false — Allo "dropped while ringing" is a Dial timeout issue.
   */
  callForwardRequireAccept?: boolean;
  /** @deprecated Unused — per-line dailyCap is the volume limit. */
  hardCapDailySends?: number;
  lineMinGapSec?: number;
  /** ISO timestamp of last daily spam/blacklist reputation pass. */
  lastReputationCheckAt?: string;
  /** When true, line picker requires registeredFcr. */
  requireFcrRegistration?: boolean;
  /** Max attempts per phone per UTC day (default 2). */
  maxAttemptsPerContactPerDay?: number;
  /** How many seed drops to inject per ACTIVE campaign per day. */
  seedInjectPerCampaignPerDay?: number;
};

/** Saved defaults so Claude / skills can reuse setup across chats. */
export type ClaudePreferences = {
  defaultClientId?: string;
  defaultLineIds?: string[];
  defaultAudioUrl?: string;
  defaultAudioAssetId?: string;
  defaultNewLeadsPerDay?: number;
  defaultHardCapDailySends?: number;
  defaultLineDailyCap?: number;
  defaultSchedule?: {
    sendWindowStart?: number;
    sendWindowEnd?: number;
    sendDays?: number[];
    timezoneMode?: "RECIPIENT_LOCAL" | "FIXED";
    fixedTimezone?: string;
    requireConsent?: boolean;
    stopOnCallback?: boolean;
    stopOnOptOut?: boolean;
  };
  lastCampaignId?: string;
  notes?: string;
};

/** Hosted or uploaded voicemail audio reusable across campaigns. */
export type AudioAsset = {
  id: string;
  name: string;
  /** Public URL Slybroadcast can fetch (external or /api/audio/{id}/file). */
  url: string;
  contentType?: string;
  /** Absolute path under DATA_DIR when uploaded locally (not exposed via API). */
  localPath?: string;
  source: "upload" | "url" | "recording";
  createdAt: string;
};

export type ClientExclusion = {
  id: string;
  clientId: string;
  phoneE164: string;
  reason?: string;
  createdAt: string;
};

export type SeedNumberRecord = {
  id: string;
  e164: string;
  label?: string;
  carrier?: string;
  active: boolean;
  lastDropAt?: string;
  createdAt: string;
};

export type AuditEventRecord = {
  id: string;
  at: string;
  action: string;
  actor: string;
  entityType: string;
  entityId?: string;
  campaignId?: string;
  clientId?: string;
  detail?: Record<string, unknown>;
};

export type StoreShape = {
  clients: ClientRecord[];
  apiKeys: ApiKeyRecord[];
  campaigns: CampaignRecord[];
  leads: LeadRecord[];
  inbox: InboxMessage[];
  settings: WorkspaceSettings;
  preferences: ClaudePreferences;
  audioAssets: AudioAsset[];
  suppressions: SuppressionRecord[];
  attempts: AttemptRecord[];
  lines: LineRecord[];
  /** UTC date YYYY-MM-DD → org send count */
  dailySendCounts: Record<string, number>;
  /** `${utcDate}:${e164}` → attempt count that day */
  contactDailyCounts?: Record<string, number>;
  /** Append-only audit trail */
  auditEvents?: AuditEventRecord[];
  /** Canary / seed numbers for delivery verification */
  seedNumbers?: SeedNumberRecord[];
  /** Per-client phone exclusions */
  clientExclusions?: ClientExclusion[];
};

export const MAX_SEND_ATTEMPTS = 8;
export const STALE_SENDING_MS = 15 * 60 * 1000;
