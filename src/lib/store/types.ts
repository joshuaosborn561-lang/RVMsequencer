export type ClientRecord = {
  id: string;
  name: string;
  createdAt: string;
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
  voiceId?: string;
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
    newLeadsPerDay: number;
    requireConsent: boolean;
    stopOnCallback: boolean;
    stopOnOptOut: boolean;
  };
  /** Campaign ramp — can only LOWER volume vs line pool. */
  ramp?: {
    enabled: boolean;
    startPerDay: number;
    incrementPerDay: number;
    ceilingPerDay: number;
    /** Day 0 = first ACTIVE day */
    activeDay?: number;
    activatedAt?: string;
  };
  dropCoCampaignToken?: string;
  elevenVoiceId?: string;
  audioUrl?: string;
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

export type SuppressionRecord = {
  id: string;
  phoneE164: string;
  reason: string;
  source: "IMPORT" | "SCRUB" | "SMS_STOP" | "INBOX" | "CALLBACK" | "MANUAL" | "BOUNCE";
  createdAt: string;
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
  minGapSec?: number;
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
  hardCapDailySends?: number;
  lineMinGapSec?: number;
};

export type StoreShape = {
  clients: ClientRecord[];
  apiKeys: ApiKeyRecord[];
  campaigns: CampaignRecord[];
  leads: LeadRecord[];
  inbox: InboxMessage[];
  settings: WorkspaceSettings;
  suppressions: SuppressionRecord[];
  attempts: AttemptRecord[];
  lines: LineRecord[];
  /** UTC date YYYY-MM-DD → org send count */
  dailySendCounts: Record<string, number>;
};

export const MAX_SEND_ATTEMPTS = 8;
export const STALE_SENDING_MS = 15 * 60 * 1000;
