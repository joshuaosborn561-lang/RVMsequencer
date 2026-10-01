import { mkdir } from "node:fs/promises";
import path from "node:path";
import { readJsonFile, writeFileAtomic } from "@/lib/store/atomic-write";

export type VeriphonePauseState = {
  paused: boolean;
  pausedReason?: string;
  pausedAt?: string;
  lastError?: string;
  httpStatus?: number;
};

const DEFAULT_STATE: VeriphonePauseState = { paused: false };

function statePath(): string {
  const dir = process.env.DATA_DIR || path.join(process.cwd(), ".data");
  return path.join(dir, "veriphone-state.json");
}

export async function readVeriphonePauseState(): Promise<VeriphonePauseState> {
  const parsed = await readJsonFile<Partial<VeriphonePauseState>>(statePath(), {
    unparseableCode: "veriphone_state_unparseable",
  });
  if (!parsed) return { ...DEFAULT_STATE };
  return {
    paused: Boolean(parsed.paused),
    pausedReason: parsed.pausedReason,
    pausedAt: parsed.pausedAt,
    lastError: parsed.lastError,
    httpStatus: parsed.httpStatus,
  };
}

export async function writeVeriphonePauseState(
  state: VeriphonePauseState,
): Promise<VeriphonePauseState> {
  const target = statePath();
  await mkdir(path.dirname(target), { recursive: true });
  await writeFileAtomic(target, JSON.stringify(state, null, 2));
  return state;
}

export async function pauseVeriphone(input: {
  httpStatus: 401 | 402;
  message: string;
}): Promise<VeriphonePauseState> {
  const reason =
    input.httpStatus === 401
      ? "VERIPHONE_HTTP_401"
      : "VERIPHONE_HTTP_402";
  const current = await readVeriphonePauseState();
  const next: VeriphonePauseState = {
    paused: true,
    pausedReason: reason,
    pausedAt: current.pausedAt ?? new Date().toISOString(),
    lastError: input.message,
    httpStatus: input.httpStatus,
  };
  console.error(
    `[veriphone] paused verification (${reason}): ${input.message}. Unverified leads will not be sent until this is resolved.`,
  );
  await writeVeriphonePauseState(next);
  if (!current.paused) {
    const { appendAudit } = await import("@/lib/store/db");
    await appendAudit({
      action: "VERIPHONE_PAUSED",
      actor: "system",
      entityType: "veriphone",
      detail: {
        reason,
        httpStatus: input.httpStatus,
        message: input.message,
      },
    });
  }
  return next;
}

export async function clearVeriphonePause(): Promise<void> {
  const current = await readVeriphonePauseState();
  if (!current.paused) return;
  await writeVeriphonePauseState({ paused: false });
  console.info("[veriphone] verification resumed");
}
