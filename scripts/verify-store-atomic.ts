import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The pre-hotfix catch-all: any read/parse error (including a half-written
 * store.json) wrote a fresh default/demo store over the real file.
 */
async function oldReadStoreUnlocked(
  storePath: string,
  defaultStore: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(storePath, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    await writeFile(storePath, JSON.stringify(defaultStore, null, 2));
    return defaultStore;
  }
}

async function main() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "rvm-store-atomic-"));
  process.env.DATA_DIR = dataDir;

  const { writeFileAtomic, readJsonFile } = await import(
    "../src/lib/store/atomic-write"
  );
  const { createCampaign, listCampaigns, listClients, listLines } = await import(
    "../src/lib/store/db"
  );

  const storePath = path.join(dataDir, "store.json");

  // Missing file still seeds a default store (first boot).
  const seeded = await listCampaigns();
  assert.equal(seeded.length, 0);
  const clients = await listClients();
  assert.ok(clients.some((c) => c.id === "client_demo"));
  const lines = await listLines();
  assert.ok(lines.some((l) => l.id === "ln_1"));
  assert.ok(lines.some((l) => l.id === "ln_4"));

  const campaign = await createCampaign({ name: "real-production-data" });
  const before = await readFile(storePath, "utf8");
  assert.ok(before.includes("real-production-data"));
  assert.ok(before.includes(campaign.id));

  // --- Reproduce the old failure mode ---
  const halfWritten = before.slice(0, Math.max(20, Math.floor(before.length / 3)));
  await writeFile(storePath, halfWritten);
  const wiped = await oldReadStoreUnlocked(storePath, {
    clients: [{ id: "client_demo", name: "Demo Client" }],
    campaigns: [],
    lines: [{ id: "ln_1" }, { id: "ln_2" }, { id: "ln_3" }, { id: "ln_4" }],
  });
  const afterOld = await readFile(storePath, "utf8");
  assert.equal((wiped.campaigns as unknown[]).length, 0);
  assert.ok(afterOld.includes("client_demo"));
  assert.ok(
    !afterOld.includes("real-production-data"),
    "old catch-all must overwrite real data with defaults",
  );

  // Restore the real store and truncate it again to simulate a torn write.
  await writeFile(storePath, before);
  await writeFile(storePath, halfWritten);

  let threw: unknown;
  try {
    await listCampaigns();
  } catch (err) {
    threw = err;
  }
  assert.ok(threw instanceof Error);
  assert.equal(
    (threw as Error).message,
    "store_unparseable",
    "unparseable existing file must throw, not seed defaults",
  );

  const afterNew = await readFile(storePath, "utf8");
  assert.equal(afterNew, halfWritten, "unparseable store.json must be left in place");
  assert.ok(!afterNew.includes("client_demo") || halfWritten.includes("client_demo"));
  assert.ok(
    !afterNew.includes('"name": "Demo Client"') ||
      halfWritten.includes('"name": "Demo Client"'),
  );

  const leftovers = await readdir(dataDir);
  const corruptCopies = leftovers.filter((name) =>
    name.startsWith("store.json.corrupt-"),
  );
  assert.ok(
    corruptCopies.length >= 1,
    "unparseable store must be copied aside before throw",
  );

  // Retry: a torn file that becomes valid mid-backoff is recovered.
  await writeFile(storePath, halfWritten);
  const pending = listCampaigns();
  await new Promise((r) => setTimeout(r, 80));
  await writeFile(storePath, before);
  const recovered = await pending;
  assert.ok(recovered.some((c) => c.id === campaign.id));

  // writeFileAtomic: readers see complete JSON; no leftover tmp.
  const atomicTarget = path.join(dataDir, "atomic-target.json");
  const payload = JSON.stringify({ ok: true, n: 42, campaigns: [campaign] });
  await writeFileAtomic(atomicTarget, payload);
  assert.equal(await readFile(atomicTarget, "utf8"), payload);
  const afterAtomic = await readdir(dataDir);
  assert.equal(
    afterAtomic.filter((name) => name.includes(".tmp-")).length,
    0,
  );

  // writeFileAtomic unlinks tmp when the write fails (target dir missing).
  const missingDir = path.join(dataDir, "no-such-dir", "file.json");
  await assert.rejects(() => writeFileAtomic(missingDir, "{}"));

  // readJsonFile returns null only on ENOENT.
  const missing = await readJsonFile(path.join(dataDir, "absent.json"), {
    retries: 1,
  });
  assert.equal(missing, null);

  // readJsonFile does not treat a present unparseable file as empty.
  const badPath = path.join(dataDir, "bad.json");
  await writeFile(badPath, "{");
  await assert.rejects(
    () => readJsonFile(badPath, { retries: 2, unparseableCode: "scheduled_unparseable" }),
    (err: unknown) =>
      err instanceof Error && err.message === "scheduled_unparseable",
  );
  assert.equal(await readFile(badPath, "utf8"), "{");

  // mkdir + atomic write used by scheduled / allo / org-counters pattern.
  const sibling = path.join(dataDir, "scheduled-sends.json");
  await mkdir(dataDir, { recursive: true });
  await writeFileAtomic(
    sibling,
    JSON.stringify({ sends: [{ id: "sch_keep" }] }, null, 2),
  );
  const queue = await readJsonFile<{ sends: { id: string }[] }>(sibling, {
    retries: 1,
  });
  assert.equal(queue?.sends[0]?.id, "sch_keep");

  // A truncated file (what a non-atomic writeFile can leave visible) is
  // unparseable and must not be treated as empty.
  const tornPath = path.join(dataDir, "torn.json");
  await writeFile(tornPath, '{"campaigns":[');
  await assert.rejects(
    () => readJsonFile(tornPath, { retries: 1, unparseableCode: "torn" }),
    (err: unknown) => err instanceof Error && err.message === "torn",
  );

  console.log("verify-store-atomic: all assertions passed");
}

void main();
