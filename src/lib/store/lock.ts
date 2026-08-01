import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const LOCK_PATH = path.join(DATA_DIR, "store.lock");

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Exclusive file lock so concurrent cron/webhooks don't clobber store.json. */
export async function withStoreLock<T>(
  fn: () => Promise<T>,
  opts?: { timeoutMs?: number },
): Promise<T> {
  const timeoutMs = opts?.timeoutMs ?? 15_000;
  await mkdir(DATA_DIR, { recursive: true });
  const started = Date.now();
  let acquired = false;

  while (!acquired) {
    try {
      const fh = await open(LOCK_PATH, "wx");
      await fh.writeFile(`${process.pid}:${Date.now()}`);
      await fh.close();
      acquired = true;
    } catch {
      if (Date.now() - started > timeoutMs) {
        // Stale lock recovery: if lock file is older than timeout, steal it.
        try {
          await unlink(LOCK_PATH);
        } catch {
          throw new Error("store_lock_timeout");
        }
      } else {
        await sleep(40 + Math.floor(Math.random() * 40));
      }
    }
  }

  try {
    return await fn();
  } finally {
    await unlink(LOCK_PATH).catch(() => {});
  }
}
