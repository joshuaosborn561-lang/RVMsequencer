import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { withStoreLock } from "./lock";
import type {
  ApiKeyRecord,
  CampaignRecord,
  ClientRecord,
  InboxMessage,
  LeadRecord,
  LeadSendStatus,
  StoreShape,
  WorkspaceSettings,
} from "./types";
import { STALE_SENDING_MS } from "./types";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

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
    callForwardTimeoutSec: 30,
  },
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
    return {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...parsed.settings },
      clients: parsed.clients ?? base.clients,
      apiKeys: parsed.apiKeys ?? base.apiKeys,
      campaigns: parsed.campaigns ?? base.campaigns,
      leads: (parsed.leads ?? base.leads).map(normalizeLead),
      inbox: parsed.inbox ?? base.inbox,
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
    store.campaigns[idx] = {
      ...prev,
      ...patch,
      id,
      schedule: patch.schedule
        ? { ...prev.schedule, ...patch.schedule }
        : prev.schedule,
      steps: patch.steps ?? prev.steps,
      lineIds: patch.lineIds ?? prev.lineIds,
      updatedAt: new Date().toISOString(),
    };
    return store.campaigns[idx]!;
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

    const now = new Date().toISOString();
    let imported = 0;
    let duplicates = 0;
    for (const lead of leads) {
      if (existingPhones.has(lead.phoneE164)) {
        duplicates += 1;
        continue;
      }
      existingPhones.add(lead.phoneE164);
      store.leads.push({
        ...lead,
        id: `lead_${randomUUID().slice(0, 8)}`,
        campaignId,
        createdAt: now,
        status: lead.dnc ? "SUPPRESSED" : "PENDING",
        attemptCount: 0,
        suppressReason: lead.dnc ? "DNC_IMPORT" : undefined,
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

export async function countDueLeads(
  campaignId: string,
  now = new Date(),
): Promise<number> {
  const leads = await listLeads(campaignId);
  return leads.filter((l) => leadIsDue(normalizeLead(l), now)).length;
}

/** Atomically claim up to `limit` due leads for a campaign (status → SENDING). */
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

export async function suppressLeadByPhone(
  phoneE164: string,
  reason: string,
  opts?: { optOut?: boolean; markDnc?: boolean },
): Promise<number> {
  return mutateStore((store) => {
    let n = 0;
    for (const lead of store.leads) {
      if (lead.phoneE164 !== phoneE164) continue;
      lead.status = "SUPPRESSED";
      lead.suppressReason = reason;
      if (opts?.markDnc || opts?.optOut) lead.dnc = true;
      if (opts?.optOut) lead.consentStatus = "OPTED_OUT";
      n += 1;
    }
    return n;
  });
}

export async function countSentToday(campaignId: string, now = new Date()): Promise<number> {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const startMs = start.getTime();
  return (await listLeads(campaignId)).filter(
    (l) => l.sentAt && Date.parse(l.sentAt) >= startMs,
  ).length;
}

export async function listClients() {
  return (await readStoreUnlocked()).clients;
}

export async function createClient(name: string): Promise<ClientRecord> {
  return mutateStore((store) => {
    const client: ClientRecord = {
      id: `client_${randomUUID().slice(0, 8)}`,
      name,
      createdAt: new Date().toISOString(),
    };
    store.clients.push(client);
    return client;
  });
}

export async function listApiKeys(clientId?: string) {
  const keys = (await readStoreUnlocked()).apiKeys.filter((k) => !k.revokedAt);
  return clientId ? keys.filter((k) => k.clientId === clientId) : keys;
}

export async function createApiKey(input: {
  clientId: string;
  name: string;
}): Promise<ApiKeyRecord> {
  return mutateStore((store) => {
    const key: ApiKeyRecord = {
      id: `key_${randomUUID().slice(0, 8)}`,
      clientId: input.clientId,
      name: input.name,
      key: `ds_${randomBytes(24).toString("hex")}`,
      createdAt: new Date().toISOString(),
    };
    store.apiKeys.push(key);
    return key;
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

/** Returns existing message if providerEventId already seen (idempotent). */
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

export async function getSettings() {
  return (await readStoreUnlocked()).settings;
}

export async function updateSettings(patch: Partial<WorkspaceSettings>) {
  return mutateStore((store) => {
    const next = { ...store.settings, ...patch };
    if (patch.callForwardToE164 === "" || patch.callForwardToE164 === undefined) {
      if ("callForwardToE164" in patch) {
        delete next.callForwardToE164;
      }
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
  const timeoutSec = settings.callForwardTimeoutSec ?? 30;
  const fromEnv = process.env.CALL_FORWARD_TO_E164?.trim();
  if (fromEnv) {
    return { e164: fromEnv, timeoutSec, source: "env" };
  }
  if (settings.callForwardToE164) {
    return {
      e164: settings.callForwardToE164,
      timeoutSec,
      source: "settings",
    };
  }
  return { e164: null, timeoutSec, source: "none" };
}

export type { LeadSendStatus };
