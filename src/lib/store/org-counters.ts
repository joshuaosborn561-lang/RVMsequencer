import { getPrisma } from "@/lib/db/prisma";
import { getRedis } from "@/lib/db/redis";
import { HARD_CAP_DAILY_SENDS } from "@/lib/hardening/constants";
import { getSettings } from "@/lib/store/db";
import { withStoreLock } from "@/lib/store/lock";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { readJsonFile, writeFileAtomic } from "@/lib/store/atomic-write";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const COUNTS_PATH = path.join(DATA_DIR, "org-daily.json");

function utcDateKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

async function readFileCounts(): Promise<Record<string, number>> {
  const parsed = await readJsonFile<Record<string, number>>(COUNTS_PATH, {
    unparseableCode: "org_counters_unparseable",
  });
  if (parsed == null) return {};
  return parsed;
}

async function writeFileCounts(counts: Record<string, number>) {
  await mkdir(path.dirname(COUNTS_PATH), { recursive: true });
  await writeFileAtomic(COUNTS_PATH, JSON.stringify(counts, null, 2));
}

export async function getSharedOrgSendsToday(now = new Date()): Promise<number> {
  const key = utcDateKey(now);
  const redis = getRedis();
  if (redis) {
    try {
      const v = await redis.get(`org:sends:${key}`);
      if (v != null) return Number(v) || 0;
    } catch {
      /* fall through */
    }
  }

  const prisma = getPrisma();
  if (prisma) {
    try {
      const row = await prisma.orgDailyCounter.findUnique({
        where: { dateKey: key },
      });
      if (row) return row.sends;
    } catch {
      /* fall through */
    }
  }

  const counts = await readFileCounts();
  return counts[key] ?? 0;
}

export async function incrementSharedOrgSends(now = new Date()): Promise<number> {
  const key = utcDateKey(now);
  const redis = getRedis();
  if (redis) {
    try {
      const n = await redis.incr(`org:sends:${key}`);
      if (n === 1) await redis.expire(`org:sends:${key}`, 172_800);
      // Best-effort mirror to Postgres
      const prisma = getPrisma();
      if (prisma) {
        await prisma.orgDailyCounter
          .upsert({
            where: { dateKey: key },
            create: { dateKey: key, sends: n },
            update: { sends: n },
          })
          .catch(() => undefined);
      }
      return n;
    } catch {
      /* fall through */
    }
  }

  const prisma = getPrisma();
  if (prisma) {
    try {
      const row = await prisma.orgDailyCounter.upsert({
        where: { dateKey: key },
        create: { dateKey: key, sends: 1 },
        update: { sends: { increment: 1 } },
      });
      return row.sends;
    } catch {
      /* fall through */
    }
  }

  return withStoreLock(async () => {
    const counts = await readFileCounts();
    counts[key] = (counts[key] ?? 0) + 1;
    await writeFileCounts(counts);
    return counts[key]!;
  });
}

export async function sharedOrgDailyCap(): Promise<number> {
  const settings = await getSettings();
  return settings.hardCapDailySends ?? HARD_CAP_DAILY_SENDS;
}
