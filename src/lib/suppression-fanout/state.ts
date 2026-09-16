import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  DeliveryReceipt,
  FanoutRunStats,
  SuppressionEvent,
} from "./types";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const STATE_PATH = path.join(DATA_DIR, "suppression-fanout-state.json");
const QUEUE_PATH = path.join(DATA_DIR, "smartlead-unsub-queue.json");

export type FanoutState = {
  cursorIso: string | null;
  lastRun?: FanoutRunStats;
  backfillCompletedAt?: string;
  events: Record<string, SuppressionEvent>;
  deliveries: Record<string, DeliveryReceipt>;
  harvested: {
    allo: string[];
    rvm: string[];
    smartlead: string[];
  };
  alloTagPresent?: boolean | null;
};

const MAX_HARVESTED = 80_000;

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 0), "utf8");
}

export function emptyFanoutState(): FanoutState {
  return {
    cursorIso: null,
    events: {},
    deliveries: {},
    harvested: { allo: [], rvm: [], smartlead: [] },
    alloTagPresent: null,
  };
}

export async function getFanoutState(): Promise<FanoutState> {
  const parsed = await readJson<Partial<FanoutState>>(STATE_PATH, {});
  return {
    cursorIso: parsed.cursorIso ?? null,
    lastRun: parsed.lastRun,
    backfillCompletedAt: parsed.backfillCompletedAt,
    events: parsed.events ?? {},
    deliveries: parsed.deliveries ?? {},
    harvested: {
      allo: parsed.harvested?.allo ?? [],
      rvm: parsed.harvested?.rvm ?? [],
      smartlead: parsed.harvested?.smartlead ?? [],
    },
    alloTagPresent: parsed.alloTagPresent ?? null,
  };
}

export async function saveFanoutState(state: FanoutState): Promise<void> {
  for (const key of ["allo", "rvm", "smartlead"] as const) {
    if (state.harvested[key].length > MAX_HARVESTED) {
      state.harvested[key] = state.harvested[key].slice(-MAX_HARVESTED);
    }
  }
  await writeJson(STATE_PATH, state);
}

export type SmartleadQueueItem = {
  id: string;
  eventType?: string;
  email?: string;
  phone?: string;
  domain?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  campaignId?: string | number;
  occurredAt: string;
};

export async function readSmartleadQueue(): Promise<SmartleadQueueItem[]> {
  const parsed = await readJson<{ items?: SmartleadQueueItem[] }>(QUEUE_PATH, {});
  return parsed.items ?? [];
}

export async function writeSmartleadQueue(items: SmartleadQueueItem[]): Promise<void> {
  await writeJson(QUEUE_PATH, { items });
}

export async function enqueueSmartleadUnsub(item: SmartleadQueueItem): Promise<void> {
  const items = await readSmartleadQueue();
  if (items.some((x) => x.id === item.id)) return;
  items.push(item);
  await writeSmartleadQueue(items);
}
