import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const STATE_PATH = path.join(DATA_DIR, "allo-sync-state.json");

export type AlloUndeterminedRow = {
  callId: string;
  alloNumberLast4: string;
  contactLast4: string;
  duration?: number;
  direction?: string;
  date?: string;
  summarySnippet?: string;
  recordedAt: string;
};

export type AlloSyncRunStats = {
  at: string;
  mode: "hourly" | "backfill";
  callsScanned: number;
  suppressed: {
    allo_dnc: number;
    allo_tag: number;
    allo_conversation: number;
  };
  undetermined: number;
  skippedAlready: number;
  errors: number;
  cursorThrough?: string;
};

export type AlloSyncState = {
  /** ISO — successful runs advance this; pulls from cursor - 1h */
  cursorIso: string | null;
  lastRun?: AlloSyncRunStats;
  /** Allo call ids already evaluated (idempotency) */
  processedCallIds: string[];
  /** Voicemail ladder cache callId → verdict */
  voicemailCache: Record<string, "voicemail" | "conversation" | "undetermined">;
  undetermined: AlloUndeterminedRow[];
  backfillCompletedAt?: string;
};

const MAX_PROCESSED = 80_000;
const MAX_UNDETERMINED = 5_000;

async function readState(): Promise<AlloSyncState> {
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as AlloSyncState;
    return {
      cursorIso: parsed.cursorIso ?? null,
      lastRun: parsed.lastRun,
      processedCallIds: parsed.processedCallIds ?? [],
      voicemailCache: parsed.voicemailCache ?? {},
      undetermined: parsed.undetermined ?? [],
      backfillCompletedAt: parsed.backfillCompletedAt,
    };
  } catch {
    return {
      cursorIso: null,
      processedCallIds: [],
      voicemailCache: {},
      undetermined: [],
    };
  }
}

async function writeState(state: AlloSyncState): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 0), "utf8");
}

export async function getAlloSyncState(): Promise<AlloSyncState> {
  return readState();
}

export async function saveAlloSyncState(state: AlloSyncState): Promise<void> {
  // trim processed ids
  if (state.processedCallIds.length > MAX_PROCESSED) {
    state.processedCallIds = state.processedCallIds.slice(
      -MAX_PROCESSED,
    );
  }
  if (state.undetermined.length > MAX_UNDETERMINED) {
    state.undetermined = state.undetermined.slice(-MAX_UNDETERMINED);
  }
  // trim voicemail cache keys
  const keys = Object.keys(state.voicemailCache);
  if (keys.length > MAX_PROCESSED) {
    const keep = new Set(state.processedCallIds.slice(-20_000));
    const next: Record<string, "voicemail" | "conversation" | "undetermined"> =
      {};
    for (const k of keys) {
      if (keep.has(k)) next[k] = state.voicemailCache[k]!;
    }
    state.voicemailCache = next;
  }
  await writeState(state);
}

export function suppressionScope(): "global" | "salesglider" {
  const v = (process.env.ALLO_SUPPRESSION_SCOPE ?? "global")
    .trim()
    .toLowerCase();
  return v === "salesglider" ? "salesglider" : "global";
}
