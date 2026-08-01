export type ClientRecord = {
  id: string;
  name: string;
  createdAt: string;
};

export type ApiKeyRecord = {
  id: string;
  clientId: string;
  name: string;
  /** Shown once at creation; stored hashed in production — plaintext only in local store */
  key: string;
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
  dropCoCampaignToken?: string;
  elevenVoiceId?: string;
  audioUrl?: string;
  /** Last sequencer drain summary (for Launch UI) */
  lastDrainAt?: string;
  lastDrainStats?: {
    attempted: number;
    sent: number;
    skipped: number;
    failed: number;
  };
};

/** Enrollment / send state — required so cron does not re-deposit forever. */
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
  /** Defaults to PENDING for legacy rows */
  status?: LeadSendStatus;
  attemptCount?: number;
  nextEligibleAt?: string;
  lastAttemptAt?: string;
  sentAt?: string;
  lastError?: string;
  providerMessageId?: string;
  suppressReason?: string;
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
  /** Twilio CallSid / MessageSid for webhook idempotency */
  providerEventId?: string;
};

export type WorkspaceSettings = {
  /** E.164 direct line — Twilio inbound voice dials this (callbacks). */
  callForwardToE164?: string;
  /** Seconds to ring the direct line before giving up */
  callForwardTimeoutSec?: number;
};

export type StoreShape = {
  clients: ClientRecord[];
  apiKeys: ApiKeyRecord[];
  campaigns: CampaignRecord[];
  leads: LeadRecord[];
  inbox: InboxMessage[];
  settings: WorkspaceSettings;
};

export const MAX_SEND_ATTEMPTS = 8;
export const STALE_SENDING_MS = 15 * 60 * 1000;
