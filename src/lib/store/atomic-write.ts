import { randomBytes } from "node:crypto";
import { copyFile, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}

/**
 * Write `data` so readers never observe a truncated target.
 * Same-directory temp file + rename; unlink the temp on failure.
 */
export async function writeFileAtomic(
  target: string,
  data: string | Buffer,
): Promise<void> {
  const dir = path.dirname(target);
  const tmp = path.join(
    dir,
    `${path.basename(target)}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`,
  );
  try {
    const fh = await open(tmp, "w");
    try {
      await fh.writeFile(data);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, target);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

export type ReadJsonFileOptions = {
  /** Total parse attempts (default 6). */
  retries?: number;
  /** Error.message after retries are exhausted. */
  unparseableCode?: string;
};

/**
 * Read and parse JSON. Returns null only on ENOENT.
 * Parse failures retry with 50ms*(i+1) backoff, then copy the file to
 * `${target}.corrupt-${Date.now()}` and throw — never treat as empty.
 */
export async function readJsonFile<T>(
  target: string,
  opts?: ReadJsonFileOptions,
): Promise<T | null> {
  const retries = opts?.retries ?? 6;
  const unparseableCode = opts?.unparseableCode ?? "json_unparseable";

  for (let i = 0; i < retries; i++) {
    let raw: string;
    try {
      raw = await readFile(target, "utf8");
    } catch (err) {
      if (isEnoent(err)) return null;
      throw err;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      if (i < retries - 1) {
        await sleep(50 * (i + 1));
        continue;
      }
    }
  }

  await copyFile(target, `${target}.corrupt-${Date.now()}`).catch(
    () => undefined,
  );
  throw new Error(unparseableCode);
}
