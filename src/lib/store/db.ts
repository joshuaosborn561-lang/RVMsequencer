import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CAMPAIGN_LEASE_MS,
  DEFAULT_CAMPAIGN_RAMP,
  DEFAULT_LINE_MIN_GAP_SEC,
  HARD_CAP_DAILY_SENDS,
} from "@/lib/hardening/constants";
import { createAuditEvent } from "@/lib/audit/log";
import { demoLines } from "@/lib/demo/data";
import { dailyCapForWarmupDay, suggestLineStatus } from "@/lib/warmup/schedule";
import { withStoreLock } from "./lock";
import type {
  ApiKeyRecord,
  AttemptRecord,
  AuditEventRecord,
  AudioAsset,
  CampaignRecord,
  ClaudePreferences,
  ClientExclusion,
  ClientRecord,
  InboxMessage,
  LeadRecord,
  LineRecord,
  SeedNumberRecord,
  StoreShape,
  SuppressionRecord,
  WorkspaceSettings,
} from "./types";
import { STALE_SENDING_MS } from "./types";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const AUDIO_DIR = path.join(DATA_DIR, "audio");

function hashKey(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function utcDateKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function seedLines(): LineRecord[] {
  return demoLines.map((l) => ({
    id: l.id,
    e164: l.e164,
    areaCode: l.areaCode,
    status: l.status,
    warmupDay: l.warmupDay,
    dailyCap: l.dailyCap,
    sentToday: 0,
    sentTodayDate: utcDateKey(),
    reputationLabel: l.reputationLabel,
    reputationScore: l.reputationScore ?? null,
    reputationSource: l.reputationSource,
    reputationReportCount: l.reputationReportCount ?? null,
    lastReputationCheckAt: l.lastReputationCheckAt,
    callbackRate7d: l.callbackRate7d ?? null,
    minGapSec: DEFAULT_LINE_MIN_GAP_SEC,
    registeredFcr: l.registeredFcr ?? false,
  }));
}

const defaultStore = (): StoreShape => ({
  clients: [
    {
      id: "client_demo",
      name: "Demo Client",
      createdAt: new Date().toISOString(),
    },
  ],
  apiKeys: [],
  campaigns: [],
  leads: [],
  inbox: [],
  settings: {
    callForwardTimeoutSec: 90,
    maxAttemptsPerContactPerDay: 2,
  },
  preferences: {},
  audioAssets: [],
  suppressions: [],
  attempts: [],
  lines: seedLines(),
  dailySendCounts: {},
  contactDailyCounts: {},
  auditEvents: [],
  seedNumbers: [],
  clientExclusions: [],
});

function normalizeLead(lead: LeadRecord): LeadRecord {
  return {
    ...lead,
    status: lead.status ?? "PENDING",
    attemptCount: lead.attemptCount ?? 0,
    custom: lead.custom ?? {},
  };
}

async function readStoreUnlocked(): Promise<StoreShape> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    const base = defaultStore();
    // Migrate legacy plaintext api keys
    const apiKeys = (parsed.apiKeys ?? []).map((k) => {
      const legacy = k as ApiKeyRecord & { key?: string };
      if (legacy.keyHash) return legacy;
      if (legacy.key) {
        return {
          ...legacy,
          keyHash: hashKey(legacy.key),
          keyPrefix: legacy.key.slice(0, 10),
          key: undefined,
        };
      }
      return legacy;
    });
    return {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...parsed.settings },
      preferences: { ...base.preferences, ...(parsed.preferences ?? {}) },
      audioAssets: parsed.audioAssets ?? base.audioAssets,
      clients: parsed.clients ?? base.clients,
      apiKeys,
      campaigns: parsed.campaigns ?? base.campaigns,
      leads: (parsed.leads ?? base.leads).map(normalizeLead),
      inbox: parsed.inbox ?? base.inbox,
      suppressions: parsed.suppressions ?? base.suppressions,
      attempts: parsed.attempts ?? base.attempts,
      lines: parsed.lines?.length ? parsed.lines : base.lines,
      dailySendCounts: parsed.dailySendCounts ?? {},
      contactDailyCounts: parsed.contactDailyCounts ?? {},
      auditEvents: parsed.auditEvents ?? [],
      seedNumbers: parsed.seedNumbers ?? [],
      clientExclusions: parsed.clientExclusions ?? [],
    };
  } catch {
    const fresh = defaultStore();
    await writeStoreUnlocked(fresh);
    return fresh;
  }
}

async function writeStoreUnlocked(store: StoreShape): Promise<void> {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2));
}

async function mutateStore<T>(fn: (store: StoreShape) => T | Promise<T>): Promise<T> {
  return withStoreLock(async () => {
    const store = await readStoreUnlocked();
    const result = await fn(store);
    await writeStoreUnlocked(store);
    return result;
  });
}

export async function appendAudit(
  event: Omit<AuditEventRecord, "id" | "at"> &
    Partial<Pick<AuditEventRecord, "id" | "at">>,
): Promise<AuditEventRecord> {
  const row = await mutateStore((store) => {
    const created = createAuditEvent(
      event as Parameters<typeof createAuditEvent>[0],
    ) as AuditEventRecord;
    const events = (store.auditEvents ??= []);
    events.push(created);
    while (events.length > 5_000) events.shift();
    return created;
  });
  void import("@/lib/supabase/rvm-sync")
    .then(({ insertAuditLog }) =>
      insertAuditLog({
        id: row.id,
        at: row.at,
        action: row.action,
        actor: row.actor,
        entity_type: row.entityType,
        entity_id: row.entityId,
        campaign_id: row.campaignId,
        client_id: row.clientId,
        detail: row.detail,
      }),
    )
    .catch(() => undefined);
  return row;
}

export async function listAuditEvents(opts?: {
  limit?: number;
  campaignId?: string;
}): Promise<AuditEventRecord[]> {
  const events = [...((await readStoreUnlocked()).auditEvents ?? [])]
    .filter((event) => !opts?.campaignId || event.campaignId === opts.campaignId)
    .sort((a, b) => b.at.localeCompare(a.at));
  return opts?.limit == null ? events : events.slice(0, Math.max(0, opts.limit));
}

function rollLineDay(line: LineRecord, now: Date) {
  const key = utcDateKey(now);
  if (line.sentTodayDate !== key) {
    line.sentToday = 0;
    line.sentTodayDate = key;
  }
}

export async function listCampaigns() {
  const store = await readStoreUnlocked();
  return store.campaigns.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getCampaign(id: string) {
  return (await readStoreUnlocked()).campaigns.find((c) => c.id === id) ?? null;
}

export async function createCampaign(input: {
  name: string;
  clientId?: string;
}): Promise<CampaignRecord> {
  return mutateStore((store) => {
    const now = new Date().toISOString();
    const campaign: CampaignRecord = {
      id: `cmp_${randomUUID().slice(0, 8)}`,
      clientId: input.clientId,
      name: input.name,
      status: "DRAFT",
      createdAt: now,
      updatedAt: now,
      steps: [
        {
          id: `step_${randomUUID().slice(0, 8)}`,
          position: 1,
          delayDays: 0,
          scriptTemplate:
            "Hey {{first_name}}, this is Sam reaching out about {{company}}. Give me a call back when you get a sec.",
        },
      ],
      lineIds: [],
      schedule: {
        sendWindowStart: 9,
        sendWindowEnd: 20,
        sendDays: [1, 2, 3, 4, 5],
        timezoneMode: "RECIPIENT_LOCAL",
        newLeadsPerDay: 200,
        requireConsent: false,
        stopOnCallback: true,
        stopOnOptOut: true,
      },
      ramp: { ...DEFAULT_CAMPAIGN_RAMP },
    };
    store.campaigns.push(campaign);
    return campaign;
  });
}

export async function updateCampaign(
  id: string,
  patch: Partial<CampaignRecord>,
): Promise<CampaignRecord | null> {
  return mutateStore((store) => {
    const idx = store.campaigns.findIndex((c) => c.id === id);
    if (idx < 0) return null;
    const prev = store.campaigns[idx]!;
    let ramp = patch.ramp ? { ...prev.ramp, ...patch.ramp } : prev.ramp;
    if (patch.status === "ACTIVE" && prev.status !== "ACTIVE") {
      ramp = {
        ...(ramp ?? DEFAULT_CAMPAIGN_RAMP),
        activatedAt: new Date().toISOString(),
        activeDay: 0,
      };
    }
    store.campaigns[idx] = {
      ...prev,
      ...patch,
      id,
      schedule: patch.schedule
        ? { ...prev.schedule, ...patch.schedule }
        : prev.schedule,
      steps: patch.steps ?? prev.steps,
      lineIds: patch.lineIds ?? prev.lineIds,
      ramp,
      updatedAt: new Date().toISOString(),
    };
    return store.campaigns[idx]!;
  });
}

/** Acquire per-campaign lease. Returns false if another owner holds it. */
export async function acquireCampaignLease(
  campaignId: string,
  owner: string,
  now = new Date(),
): Promise<boolean> {
  return mutateStore((store) => {
    const c = store.campaigns.find((x) => x.id === campaignId);
    if (!c) return false;
    if (
      c.leaseOwner &&
      c.leaseOwner !== owner &&
      c.leaseUntil &&
      Date.parse(c.leaseUntil) > now.getTime()
    ) {
      return false;
    }
    c.leaseOwner = owner;
    c.leaseUntil = new Date(now.getTime() + CAMPAIGN_LEASE_MS).toISOString();
    c.updatedAt = now.toISOString();
    return true;
  });
}

export async function releaseCampaignLease(
  campaignId: string,
  owner: string,
): Promise<void> {
  await mutateStore((store) => {
    const c = store.campaigns.find((x) => x.id === campaignId);
    if (c && c.leaseOwner === owner) {
      c.leaseOwner = undefined;
      c.leaseUntil = undefined;
    }
  });
}

export async function listLeads(campaignId: string) {
  return (await readStoreUnlocked()).leads.filter((l) => l.campaignId === campaignId);
}

export async function importLeads(
  campaignId: string,
  leads: Omit<
    LeadRecord,
    | "id"
    | "campaignId"
    | "createdAt"
    | "status"
    | "attemptCount"
    | "nextEligibleAt"
    | "lastAttemptAt"
    | "sentAt"
    | "lastError"
    | "providerMessageId"
    | "suppressReason"
    | "stickyLineId"
  >[],
  opts?: { mode?: "append" | "replace" },
): Promise<{ imported: number; duplicates: number; replaced: number }> {
  return mutateStore((store) => {
    const mode = opts?.mode ?? "append";
    let replaced = 0;
    if (mode === "replace") {
      const before = store.leads.length;
      store.leads = store.leads.filter((l) => l.campaignId !== campaignId);
      replaced = before - store.leads.length;
    }
    const existingPhones = new Set(
      store.leads
        .filter((l) => l.campaignId === campaignId)
        .map((l) => l.phoneE164),
    );
    const suppressed = new Set(store.suppressions.map((s) => s.phoneE164));
    const now = new Date().toISOString();
    let imported = 0;
    let duplicates = 0;
    for (const lead of leads) {
      if (existingPhones.has(lead.phoneE164)) {
        duplicates += 1;
        continue;
      }
      existingPhones.add(lead.phoneE164);
      const blocked = lead.dnc || suppressed.has(lead.phoneE164);
      store.leads.push({
        ...lead,
        id: `lead_${randomUUID().slice(0, 8)}`,
        campaignId,
        createdAt: now,
        status: blocked ? "SUPPRESSED" : "PENDING",
        attemptCount: 0,
        suppressReason: blocked
          ? lead.dnc
            ? "DNC_IMPORT"
            : "GLOBAL_SUPPRESSION"
          : undefined,
        dnc: blocked,
      });
      imported += 1;
    }
    return { imported, duplicates, replaced };
  });
}

function leadIsDue(lead: LeadRecord, now: Date): boolean {
  const status = lead.status ?? "PENDING";
  if (status === "SENT" || status === "SUPPRESSED") return false;
  if (lead.dnc || lead.consentStatus === "OPTED_OUT") return false;
  if (status === "SENDING") {
    const last = lead.lastAttemptAt ? Date.parse(lead.lastAttemptAt) : 0;
    if (now.getTime() - last < STALE_SENDING_MS) return false;
  }
  if (lead.nextEligibleAt && Date.parse(lead.nextEligibleAt) > now.getTime()) {
    return false;
  }
  return status === "PENDING" || status === "FAILED" || status === "SENDING";
}

export async function countDueLeads(campaignId: string, now = new Date()) {
  return (await listLeads(campaignId)).filter((l) =>
    leadIsDue(normalizeLead(l), now),
  ).length;
}

export async function claimLeadsForDrain(
  campaignId: string,
  limit: number,
  now = new Date(),
): Promise<LeadRecord[]> {
  if (limit <= 0) return [];
  return mutateStore((store) => {
    const claimed: LeadRecord[] = [];
    const iso = now.toISOString();
    for (const lead of store.leads) {
      if (claimed.length >= limit) break;
      if (lead.campaignId !== campaignId) continue;
      const normalized = normalizeLead(lead);
      if (!leadIsDue(normalized, now)) continue;
      if (isPhoneSuppressed(store, lead.phoneE164)) {
        lead.status = "SUPPRESSED";
        lead.suppressReason = "GLOBAL_SUPPRESSION";
        lead.dnc = true;
        continue;
      }
      lead.status = "SENDING";
      lead.lastAttemptAt = iso;
      lead.attemptCount = (lead.attemptCount ?? 0) + 1;
      claimed.push(normalizeLead(lead));
    }
    return claimed;
  });
}

export async function updateLead(
  id: string,
  patch: Partial<LeadRecord>,
): Promise<LeadRecord | null> {
  return mutateStore((store) => {
    const idx = store.leads.findIndex((l) => l.id === id);
    if (idx < 0) return null;
    store.leads[idx] = normalizeLead({ ...store.leads[idx]!, ...patch, id });
    return store.leads[idx]!;
  });
}

function isPhoneSuppressed(store: StoreShape, phoneE164: string): boolean {
  return store.suppressions.some((s) => s.phoneE164 === phoneE164);
}

export async function getSuppression(
  phoneE164: string,
): Promise<SuppressionRecord | null> {
  return (
    (await readStoreUnlocked()).suppressions.find(
      (suppression) => suppression.phoneE164 === phoneE164,
    ) ?? null
  );
}

export async function isSuppressed(phoneE164: string): Promise<boolean> {
  return isPhoneSuppressed(await readStoreUnlocked(), phoneE164);
}

export async function addSuppression(input: {
  phoneE164: string;
  reason: string;
  source: SuppressionRecord["source"];
  markDnc?: boolean;
  alloMeta?: SuppressionRecord["alloMeta"];
}): Promise<SuppressionRecord> {
  return mutateStore((store) => {
    const existing = store.suppressions.find(
      (s) => s.phoneE164 === input.phoneE164,
    );
    if (existing) {
      if (input.alloMeta) {
        existing.alloMeta = { ...existing.alloMeta, ...input.alloMeta };
      }
      if (input.markDnc) {
        for (const lead of store.leads) {
          if (lead.phoneE164 === input.phoneE164) lead.dnc = true;
        }
      }
      return existing;
    }
    const row: SuppressionRecord = {
      id: `sup_${randomUUID().slice(0, 8)}`,
      phoneE164: input.phoneE164,
      reason: input.reason,
      source: input.source,
      createdAt: new Date().toISOString(),
      ...(input.alloMeta ? { alloMeta: input.alloMeta } : {}),
    };
    store.suppressions.push(row);
    for (const lead of store.leads) {
      if (lead.phoneE164 === input.phoneE164) {
        lead.status = "SUPPRESSED";
        lead.suppressReason = input.reason;
        if (input.markDnc) lead.dnc = true;
      }
    }
    return row;
  });
}

export async function attachAlloSuppressionMeta(
  phoneE164: string,
  meta: NonNullable<SuppressionRecord["alloMeta"]>,
): Promise<void> {
  await mutateStore((store) => {
    const row = store.suppressions.find((s) => s.phoneE164 === phoneE164);
    if (!row) return;
    row.source = "ALLO";
    row.alloMeta = {
      ...row.alloMeta,
      ...meta,
      updatedAt: new Date().toISOString(),
    };
  });
}

export async function suppressLeadByPhone(
  phoneE164: string,
  reason: string,
  opts?: {
    optOut?: boolean;
    markDnc?: boolean;
    source?: SuppressionRecord["source"];
    alloMeta?: SuppressionRecord["alloMeta"];
  },
): Promise<number> {
  const markDnc = Boolean(opts?.markDnc || opts?.optOut);
  await addSuppression({
    phoneE164,
    reason,
    source: opts?.source ?? (opts?.optOut ? "SMS_STOP" : "MANUAL"),
    markDnc,
    alloMeta: opts?.alloMeta,
  });
  const n = await mutateStore((store) => {
    let count = 0;
    for (const lead of store.leads) {
      if (lead.phoneE164 !== phoneE164) continue;
      lead.status = "SUPPRESSED";
      lead.suppressReason = reason;
      if (markDnc) lead.dnc = true;
      if (opts?.optOut) lead.consentStatus = "OPTED_OUT";
      count += 1;
    }
    return count;
  });
  const { cancelScheduledForPhone } = await import("@/lib/store/scheduled");
  await cancelScheduledForPhone(phoneE164, reason);
  return n;
}

export async function createAttempt(input: {
  campaignId: string;
  leadId: string;
  idempotencyKey: string;
  lineId?: string;
}): Promise<AttemptRecord> {
  return mutateStore((store) => {
    const existing = store.attempts.find(
      (a) =>
        a.idempotencyKey === input.idempotencyKey &&
        (a.status === "SENT" || a.status === "SENDING"),
    );
    if (existing) return existing;
    const now = new Date().toISOString();
    const row: AttemptRecord = {
      id: `att_${randomUUID().slice(0, 8)}`,
      campaignId: input.campaignId,
      leadId: input.leadId,
      lineId: input.lineId,
      status: "QUEUED",
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
      updatedAt: now,
    };
    store.attempts.push(row);
    return row;
  });
}

export async function updateAttempt(
  id: string,
  patch: Partial<AttemptRecord>,
): Promise<AttemptRecord | null> {
  return mutateStore((store) => {
    const idx = store.attempts.findIndex((a) => a.id === id);
    if (idx < 0) return null;
    store.attempts[idx] = {
      ...store.attempts[idx]!,
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    };
    return store.attempts[idx]!;
  });
}

export async function findSentAttempt(
  campaignId: string,
  leadId: string,
): Promise<AttemptRecord | null> {
  const store = await readStoreUnlocked();
  return (
    store.attempts.find(
      (a) =>
        a.campaignId === campaignId &&
        a.leadId === leadId &&
        a.status === "SENT",
    ) ?? null
  );
}

export async function findAttemptByKey(
  idempotencyKey: string,
): Promise<AttemptRecord | null> {
  const store = await readStoreUnlocked();
  return store.attempts.find((a) => a.idempotencyKey === idempotencyKey) ?? null;
}

export async function findSentAttemptForStep(
  campaignId: string,
  leadId: string,
  stepPosition: number,
): Promise<AttemptRecord | null> {
  const key = `${campaignId}_${leadId}_step${stepPosition}`;
  const store = await readStoreUnlocked();
  return (
    store.attempts.find((a) => a.idempotencyKey === key && a.status === "SENT") ??
    null
  );
}

/** Attempts created at/after `sinceIso` (inclusive). Used by reputation daily job. */
export async function listAttemptsSince(
  sinceIso: string,
): Promise<AttemptRecord[]> {
  const store = await readStoreUnlocked();
  return store.attempts.filter((a) => a.createdAt >= sinceIso);
}

export async function listLines(): Promise<LineRecord[]> {
  const store = await readStoreUnlocked();
  const now = new Date();
  return store.lines.map((l) => {
    const copy = { ...l };
    rollLineDay(copy, now);
    return copy;
  });
}

export async function bumpLineSent(lineId: string, now = new Date()) {
  return mutateStore((store) => {
    const line = store.lines.find((l) => l.id === lineId);
    if (!line) return null;
    rollLineDay(line, now);
    line.sentToday += 1;
    line.lastSentAt = now.toISOString();
    return line;
  });
}

export async function ensureLine(e164: string): Promise<LineRecord> {
  return mutateStore((store) => {
    const existing = store.lines.find((l) => l.e164 === e164 || l.id === e164);
    if (existing) return existing;
    const row: LineRecord = {
      id: `ln_${randomUUID().slice(0, 8)}`,
      e164,
      areaCode: e164.replace(/\D/g, "").slice(1, 4),
      status: "WARMING",
      warmupDay: 0,
      dailyCap: dailyCapForWarmupDay(0),
      sentToday: 0,
      sentTodayDate: utcDateKey(),
      reputationLabel: "UNKNOWN",
      reputationScore: null,
      reputationSource: undefined,
      reputationReportCount: null,
      lastReputationCheckAt: undefined,
      callbackRate7d: null,
      minGapSec: DEFAULT_LINE_MIN_GAP_SEC,
      registeredFcr: false,
    };
    store.lines.push(row);
    return row;
  });
}

export async function updateLine(
  idOrE164: string,
  patch: Partial<
    Pick<
      LineRecord,
      | "dailyCap"
      | "status"
      | "warmupDay"
      | "minGapSec"
      | "reputationLabel"
      | "reputationScore"
      | "reputationSource"
      | "reputationReportCount"
      | "lastReputationCheckAt"
      | "callbackRate7d"
      | "registeredFcr"
    >
  >,
): Promise<LineRecord | null> {
  return mutateStore((store) => {
    const line = store.lines.find((l) => l.id === idOrE164 || l.e164 === idOrE164);
    if (!line) return null;
    if (patch.dailyCap != null) line.dailyCap = patch.dailyCap;
    if (patch.status != null) line.status = patch.status;
    if (patch.warmupDay != null) line.warmupDay = patch.warmupDay;
    if (patch.minGapSec != null) line.minGapSec = patch.minGapSec;
    if (patch.reputationLabel != null) line.reputationLabel = patch.reputationLabel;
    if (patch.reputationScore !== undefined) line.reputationScore = patch.reputationScore;
    if (patch.reputationSource !== undefined) line.reputationSource = patch.reputationSource;
    if (patch.reputationReportCount !== undefined) {
      line.reputationReportCount = patch.reputationReportCount;
    }
    if (patch.lastReputationCheckAt !== undefined) {
      line.lastReputationCheckAt = patch.lastReputationCheckAt;
    }
    if (patch.callbackRate7d !== undefined) line.callbackRate7d = patch.callbackRate7d;
    if (patch.registeredFcr != null) line.registeredFcr = patch.registeredFcr;
    return { ...line };
  });
}

export async function advanceLineWarmups(
  now = new Date(),
): Promise<{ advanced: number; lines: LineRecord[] }> {
  return mutateStore((store) => {
    const today = utcDateKey(now);
    const lines: LineRecord[] = [];
    for (const line of store.lines) {
      if (line.status === "RETIRED" || line.lastWarmupAdvanceDate === today) {
        continue;
      }
      line.warmupDay += 1;
      line.lastWarmupAdvanceDate = today;
      line.dailyCap = dailyCapForWarmupDay(line.warmupDay);
      if (line.status !== "QUARANTINED") {
        line.status = suggestLineStatus({
          warmupDay: line.warmupDay,
          targetCap: 80,
          reputation: line.reputationLabel,
        });
      }
      lines.push({ ...line });
    }
    return { advanced: lines.length, lines };
  });
}

export async function getPreferences(): Promise<ClaudePreferences> {
  return (await readStoreUnlocked()).preferences ?? {};
}

export async function updatePreferences(
  patch: ClaudePreferences,
): Promise<ClaudePreferences> {
  return mutateStore((store) => {
    store.preferences = { ...store.preferences, ...patch };
    // Allow clearing optional string fields with empty string → delete
    for (const key of Object.keys(patch) as (keyof ClaudePreferences)[]) {
      const v = patch[key];
      if (v === "" || v === null) {
        delete store.preferences[key];
      }
    }
    return store.preferences;
  });
}

function publicAppUrl(): string {
  const u =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : "") ||
    "http://127.0.0.1:3000";
  return u.replace(/\/$/, "");
}

export async function listAudioAssets(): Promise<AudioAsset[]> {
  const assets = (await readStoreUnlocked()).audioAssets ?? [];
  return assets.map(({ localPath: _lp, ...rest }) => rest as AudioAsset);
}

export async function getAudioAsset(id: string): Promise<AudioAsset | null> {
  const assets = (await readStoreUnlocked()).audioAssets ?? [];
  return assets.find((a) => a.id === id) ?? null;
}

export async function registerAudioUrl(input: {
  name: string;
  url: string;
}): Promise<AudioAsset> {
  return mutateStore((store) => {
    const row: AudioAsset = {
      id: `aud_${randomUUID().slice(0, 8)}`,
      name: input.name.trim() || "Voicemail",
      url: input.url.trim(),
      source: "url",
      createdAt: new Date().toISOString(),
    };
    store.audioAssets = [row, ...(store.audioAssets ?? [])].slice(0, 100);
    store.preferences = {
      ...store.preferences,
      defaultAudioUrl: row.url,
      defaultAudioAssetId: row.id,
    };
    return { ...row };
  });
}

export async function uploadAudioAsset(input: {
  name: string;
  bytes: Buffer;
  contentType?: string;
  ext?: string;
  source?: AudioAsset["source"];
}): Promise<AudioAsset> {
  await mkdir(AUDIO_DIR, { recursive: true });
  const id = `aud_${randomUUID().slice(0, 8)}`;
  const ext =
    input.ext ||
    (input.contentType?.includes("mpeg") || input.contentType?.includes("mp3")
      ? "mp3"
      : input.contentType?.includes("m4a") || input.contentType?.includes("mp4")
        ? "m4a"
        : "wav");
  const filename = `${id}.${ext}`;
  const localPath = path.join(AUDIO_DIR, filename);
  await writeFile(localPath, input.bytes);
  const url = `${publicAppUrl()}/api/audio/${id}/file`;
  const contentType =
    input.contentType ||
    (ext === "mp3"
      ? "audio/mpeg"
      : ext === "m4a"
        ? "audio/mp4"
        : "audio/wav");

  return mutateStore((store) => {
    const row: AudioAsset = {
      id,
      name: input.name.trim() || "Uploaded voicemail",
      url,
      contentType,
      localPath,
      source: input.source ?? "upload",
      createdAt: new Date().toISOString(),
    };
    store.audioAssets = [row, ...(store.audioAssets ?? [])].slice(0, 100);
    store.preferences = {
      ...store.preferences,
      defaultAudioUrl: row.url,
      defaultAudioAssetId: row.id,
    };
    const { localPath: _lp, ...publicRow } = row;
    return publicRow as AudioAsset;
  });
}

/**
 * Write WAV to volume and attach to campaign + step 1 in one store mutation.
 * Never changes campaign status.
 */
export async function saveRecordingToCampaign(input: {
  campaignId: string;
  bytes: Buffer;
  durationSeconds?: number;
}): Promise<{
  asset: AudioAsset;
  campaign: CampaignRecord;
  durationSeconds?: number;
} | null> {
  await mkdir(AUDIO_DIR, { recursive: true });
  const id = `aud_${randomUUID().slice(0, 8)}`;
  const filename = `${id}.wav`;
  const localPath = path.join(AUDIO_DIR, filename);
  await writeFile(localPath, input.bytes);
  const url = `${publicAppUrl()}/api/audio/${id}/file`;

  return mutateStore((store) => {
    const idx = store.campaigns.findIndex((c) => c.id === input.campaignId);
    if (idx < 0) return null;
    const campaign = store.campaigns[idx]!;
    const row: AudioAsset = {
      id,
      name: `${campaign.name} recording`,
      url,
      contentType: "audio/wav",
      localPath,
      source: "recording",
      createdAt: new Date().toISOString(),
    };
    store.audioAssets = [row, ...(store.audioAssets ?? [])].slice(0, 100);
    store.preferences = {
      ...store.preferences,
      defaultAudioUrl: row.url,
      defaultAudioAssetId: row.id,
    };

    const steps = campaign.steps.map((s) =>
      s.position === 1 ? { ...s, audioUrl: url } : s,
    );
    if (steps.length > 0 && !steps.some((s) => s.position === 1)) {
      steps[0] = { ...steps[0]!, audioUrl: url };
    } else if (steps.length > 0 && !steps.some((s) => s.audioUrl === url)) {
      const i = steps.findIndex((s) => s.position === 1);
      if (i >= 0) steps[i] = { ...steps[i]!, audioUrl: url };
    }

    store.campaigns[idx] = {
      ...campaign,
      audioUrl: url,
      steps,
      updatedAt: new Date().toISOString(),
      // status intentionally unchanged
    };

    const { localPath: _lp, ...publicRow } = row;
    return {
      asset: publicRow as AudioAsset,
      campaign: store.campaigns[idx]!,
      durationSeconds: input.durationSeconds,
    };
  });
}

export async function countSentToday(campaignId: string, now = new Date()) {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return (await listLeads(campaignId)).filter(
    (l) => l.sentAt && Date.parse(l.sentAt) >= start,
  ).length;
}

export async function getOrgSendsToday(now = new Date()): Promise<number> {
  const store = await readStoreUnlocked();
  return store.dailySendCounts[utcDateKey(now)] ?? 0;
}

export async function incrementOrgSends(now = new Date()): Promise<number> {
  return mutateStore((store) => {
    const key = utcDateKey(now);
    store.dailySendCounts[key] = (store.dailySendCounts[key] ?? 0) + 1;
    return store.dailySendCounts[key]!;
  });
}

export async function getContactAttemptsToday(
  phoneE164: string,
  now = new Date(),
): Promise<number> {
  const counts = (await readStoreUnlocked()).contactDailyCounts ?? {};
  return counts[`${utcDateKey(now)}:${phoneE164}`] ?? 0;
}

export async function bumpContactAttempt(
  phoneE164: string,
  now = new Date(),
): Promise<number> {
  return mutateStore((store) => {
    const counts = (store.contactDailyCounts ??= {});
    const key = `${utcDateKey(now)}:${phoneE164}`;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts[key]!;
  });
}

export async function orgDailyCap(settings?: WorkspaceSettings): Promise<number> {
  return settings?.hardCapDailySends ?? HARD_CAP_DAILY_SENDS;
}

export async function listClients() {
  return (await readStoreUnlocked()).clients;
}

export async function getClient(clientId: string): Promise<ClientRecord | null> {
  const client = (await readStoreUnlocked()).clients.find((c) => c.id === clientId);
  return client ?? null;
}

export async function isClientExcluded(
  clientId: string | null | undefined,
  phoneE164: string,
): Promise<boolean> {
  if (!clientId) return false;
  return ((await readStoreUnlocked()).clientExclusions ?? []).some(
    (exclusion) =>
      exclusion.clientId === clientId && exclusion.phoneE164 === phoneE164,
  );
}

export async function listClientExclusions(
  clientId?: string,
): Promise<ClientExclusion[]> {
  const exclusions = (await readStoreUnlocked()).clientExclusions ?? [];
  return clientId
    ? exclusions.filter((exclusion) => exclusion.clientId === clientId)
    : exclusions;
}

export async function addClientExclusion(input: {
  clientId: string;
  phoneE164: string;
  reason?: string;
}): Promise<ClientExclusion> {
  return mutateStore((store) => {
    const exclusions = (store.clientExclusions ??= []);
    const existing = exclusions.find(
      (exclusion) =>
        exclusion.clientId === input.clientId &&
        exclusion.phoneE164 === input.phoneE164,
    );
    if (existing) return existing;
    const row: ClientExclusion = {
      id: `exc_${randomUUID().slice(0, 8)}`,
      clientId: input.clientId,
      phoneE164: input.phoneE164,
      reason: input.reason,
      createdAt: new Date().toISOString(),
    };
    exclusions.push(row);
    return row;
  });
}

export async function createClient(
  input:
    | string
    | {
        name: string;
        hubspotOptIn?: boolean;
        hubspotOwnerId?: string;
      },
): Promise<ClientRecord> {
  const name = typeof input === "string" ? input : input.name;
  const hubspotOptIn =
    typeof input === "string" ? undefined : input.hubspotOptIn;
  const hubspotOwnerId =
    typeof input === "string" ? undefined : input.hubspotOwnerId;
  return mutateStore((store) => {
    const client: ClientRecord = {
      id: `client_${randomUUID().slice(0, 8)}`,
      name: name.trim(),
      createdAt: new Date().toISOString(),
      hubspotOptIn: Boolean(hubspotOptIn),
      hubspotOwnerId: hubspotOwnerId?.trim() || undefined,
    };
    store.clients.push(client);
    return client;
  });
}

export async function updateClient(
  clientId: string,
  patch: Partial<Pick<ClientRecord, "name" | "hubspotOptIn" | "hubspotOwnerId">>,
): Promise<ClientRecord | null> {
  return mutateStore((store) => {
    const client = store.clients.find((c) => c.id === clientId);
    if (!client) return null;
    if (patch.name !== undefined) client.name = patch.name.trim();
    if (patch.hubspotOptIn !== undefined) {
      client.hubspotOptIn = Boolean(patch.hubspotOptIn);
    }
    if (patch.hubspotOwnerId !== undefined) {
      client.hubspotOwnerId = patch.hubspotOwnerId.trim() || undefined;
    }
    return client;
  });
}

export async function listApiKeys(clientId?: string) {
  const keys = (await readStoreUnlocked()).apiKeys.filter((k) => !k.revokedAt);
  const mapped = keys.map(({ key: _k, ...rest }) => rest);
  return clientId ? mapped.filter((k) => k.clientId === clientId) : mapped;
}

export async function createApiKey(input: {
  clientId: string;
  name: string;
}): Promise<ApiKeyRecord> {
  return mutateStore((store) => {
    const secret = `ds_${randomBytes(24).toString("hex")}`;
    const row: ApiKeyRecord = {
      id: `key_${randomUUID().slice(0, 8)}`,
      clientId: input.clientId,
      name: input.name,
      keyHash: hashKey(secret),
      keyPrefix: secret.slice(0, 10),
      key: secret, // returned once; stripped on write below
      createdAt: new Date().toISOString(),
    };
    const { key: _shown, ...persisted } = row;
    store.apiKeys.push(persisted as ApiKeyRecord);
    return row;
  });
}

export async function revokeApiKey(id: string) {
  return mutateStore((store) => {
    const key = store.apiKeys.find((k) => k.id === id);
    if (!key) return false;
    key.revokedAt = new Date().toISOString();
    return true;
  });
}

export async function listInbox(clientId?: string) {
  const msgs = (await readStoreUnlocked()).inbox.sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  return clientId ? msgs.filter((m) => m.clientId === clientId) : msgs;
}

export async function updateInboxMessage(
  id: string,
  patch: Partial<InboxMessage>,
) {
  return mutateStore((store) => {
    const idx = store.inbox.findIndex((m) => m.id === id);
    if (idx < 0) return null;
    store.inbox[idx] = { ...store.inbox[idx]!, ...patch, id };
    return store.inbox[idx]!;
  });
}

export async function addInboxMessage(
  msg: Omit<InboxMessage, "id" | "createdAt">,
): Promise<{ message: InboxMessage; created: boolean }> {
  return mutateStore((store) => {
    if (msg.providerEventId) {
      const existing = store.inbox.find(
        (m) => m.providerEventId === msg.providerEventId,
      );
      if (existing) return { message: existing, created: false };
    }
    const row: InboxMessage = {
      ...msg,
      id: `inbox_${randomUUID().slice(0, 8)}`,
      createdAt: new Date().toISOString(),
    };
    store.inbox.push(row);
    return { message: row, created: true };
  });
}

export async function listSeedNumbers(): Promise<SeedNumberRecord[]> {
  return (await readStoreUnlocked()).seedNumbers ?? [];
}

export async function upsertSeedNumber(input: {
  e164: string;
  label?: string;
  carrier?: string;
  active?: boolean;
}): Promise<SeedNumberRecord> {
  return mutateStore((store) => {
    const seeds = (store.seedNumbers ??= []);
    const existing = seeds.find(
      (seed) => seed.e164 === input.e164 || seed.id === input.e164,
    );
    if (existing) {
      if (input.label !== undefined) existing.label = input.label;
      if (input.carrier !== undefined) existing.carrier = input.carrier;
      if (input.active !== undefined) existing.active = input.active;
      return existing;
    }
    const row: SeedNumberRecord = {
      id: `seed_${randomUUID().slice(0, 8)}`,
      e164: input.e164,
      label: input.label,
      carrier: input.carrier,
      active: input.active ?? true,
      createdAt: new Date().toISOString(),
    };
    seeds.push(row);
    return row;
  });
}

export async function markSeedDropped(
  idOrE164: string,
  at = new Date(),
): Promise<SeedNumberRecord | null> {
  return mutateStore((store) => {
    const seed = (store.seedNumbers ?? []).find(
      (item) => item.id === idOrE164 || item.e164 === idOrE164,
    );
    if (!seed) return null;
    seed.lastDropAt = at.toISOString();
    return seed;
  });
}

export async function deleteSeedNumber(idOrE164: string): Promise<boolean> {
  return mutateStore((store) => {
    const seeds = (store.seedNumbers ??= []);
    const index = seeds.findIndex(
      (seed) => seed.id === idOrE164 || seed.e164 === idOrE164,
    );
    if (index < 0) return false;
    seeds.splice(index, 1);
    return true;
  });
}

export async function getSettings() {
  return (await readStoreUnlocked()).settings;
}

export async function updateSettings(patch: Partial<WorkspaceSettings>) {
  return mutateStore((store) => {
    const next = { ...store.settings, ...patch };
    if (patch.callForwardToE164 === "" || patch.callForwardToE164 === undefined) {
      if ("callForwardToE164" in patch) delete next.callForwardToE164;
    }
    store.settings = next;
    return store.settings;
  });
}

export async function resolveCallForwardTo(): Promise<{
  e164: string | null;
  timeoutSec: number;
  source: "env" | "settings" | "none";
}> {
  const settings = await getSettings();
  const timeoutSec = settings.callForwardTimeoutSec ?? 90;
  const fromEnv = process.env.CALL_FORWARD_TO_E164?.trim();
  if (fromEnv) return { e164: fromEnv, timeoutSec, source: "env" };
  if (settings.callForwardToE164) {
    return {
      e164: settings.callForwardToE164,
      timeoutSec,
      source: "settings",
    };
  }
  return { e164: null, timeoutSec, source: "none" };
}
