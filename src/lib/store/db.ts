import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import type {
  ApiKeyRecord,
  CampaignRecord,
  ClientRecord,
  InboxMessage,
  LeadRecord,
  StoreShape,
} from "./types";

const STORE_PATH = path.join(process.cwd(), ".data", "store.json");

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
  inbox: [
    {
      id: "inbox_demo_1",
      clientId: "client_demo",
      fromE164: "+14155550199",
      toE164: "+14155550101",
      channel: "VOICE_CALLBACK",
      body: "Missed callback — 32s ring, no voicemail left.",
      category: "UNREAD",
      createdAt: new Date().toISOString(),
    },
  ],
});

async function readStore(): Promise<StoreShape> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    return JSON.parse(raw) as StoreShape;
  } catch {
    const fresh = defaultStore();
    await writeStore(fresh);
    return fresh;
  }
}

async function writeStore(store: StoreShape): Promise<void> {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2));
}

export async function listCampaigns() {
  return (await readStore()).campaigns.sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export async function getCampaign(id: string) {
  return (await readStore()).campaigns.find((c) => c.id === id) ?? null;
}

export async function createCampaign(input: {
  name: string;
  clientId?: string;
}): Promise<CampaignRecord> {
  const store = await readStore();
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
  await writeStore(store);
  return campaign;
}

export async function updateCampaign(
  id: string,
  patch: Partial<CampaignRecord>,
): Promise<CampaignRecord | null> {
  const store = await readStore();
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
  await writeStore(store);
  return store.campaigns[idx]!;
}

export async function listLeads(campaignId: string) {
  return (await readStore()).leads.filter((l) => l.campaignId === campaignId);
}

export async function importLeads(
  campaignId: string,
  leads: Omit<LeadRecord, "id" | "campaignId" | "createdAt">[],
): Promise<number> {
  const store = await readStore();
  const now = new Date().toISOString();
  for (const lead of leads) {
    store.leads.push({
      ...lead,
      id: `lead_${randomUUID().slice(0, 8)}`,
      campaignId,
      createdAt: now,
    });
  }
  await writeStore(store);
  return leads.length;
}

export async function listClients() {
  return (await readStore()).clients;
}

export async function createClient(name: string): Promise<ClientRecord> {
  const store = await readStore();
  const client: ClientRecord = {
    id: `client_${randomUUID().slice(0, 8)}`,
    name,
    createdAt: new Date().toISOString(),
  };
  store.clients.push(client);
  await writeStore(store);
  return client;
}

export async function listApiKeys(clientId?: string) {
  const keys = (await readStore()).apiKeys.filter((k) => !k.revokedAt);
  return clientId ? keys.filter((k) => k.clientId === clientId) : keys;
}

export async function createApiKey(input: {
  clientId: string;
  name: string;
}): Promise<ApiKeyRecord> {
  const store = await readStore();
  const key: ApiKeyRecord = {
    id: `key_${randomUUID().slice(0, 8)}`,
    clientId: input.clientId,
    name: input.name,
    key: `ds_${randomBytes(24).toString("hex")}`,
    createdAt: new Date().toISOString(),
  };
  store.apiKeys.push(key);
  await writeStore(store);
  return key;
}

export async function revokeApiKey(id: string) {
  const store = await readStore();
  const key = store.apiKeys.find((k) => k.id === id);
  if (!key) return false;
  key.revokedAt = new Date().toISOString();
  await writeStore(store);
  return true;
}

export async function listInbox(clientId?: string) {
  const msgs = (await readStore()).inbox.sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  return clientId ? msgs.filter((m) => m.clientId === clientId) : msgs;
}

export async function updateInboxMessage(
  id: string,
  patch: Partial<InboxMessage>,
) {
  const store = await readStore();
  const idx = store.inbox.findIndex((m) => m.id === id);
  if (idx < 0) return null;
  store.inbox[idx] = { ...store.inbox[idx]!, ...patch, id };
  await writeStore(store);
  return store.inbox[idx]!;
}

export async function addInboxMessage(
  msg: Omit<InboxMessage, "id" | "createdAt">,
) {
  const store = await readStore();
  const row: InboxMessage = {
    ...msg,
    id: `inbox_${randomUUID().slice(0, 8)}`,
    createdAt: new Date().toISOString(),
  };
  store.inbox.push(row);
  await writeStore(store);
  return row;
}
