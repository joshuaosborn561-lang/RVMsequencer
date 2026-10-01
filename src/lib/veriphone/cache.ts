import { mkdir } from "node:fs/promises";
import path from "node:path";
import { VERIPHONE_CACHE_TTL_MS } from "@/lib/hardening/constants";
import { getPrisma, postgresEnabled } from "@/lib/db/prisma";
import { readJsonFile, writeFileAtomic } from "@/lib/store/atomic-write";
import type { VeriphoneCacheEntry } from "./types";

type CacheFile = { entries: Record<string, VeriphoneCacheEntry> };

function cachePath(): string {
  const dir = process.env.DATA_DIR || path.join(process.cwd(), ".data");
  return path.join(dir, "phone-type-cache.json");
}

export function cacheExpiryIso(checkedAt: Date, now = checkedAt): string {
  return new Date(checkedAt.getTime() + VERIPHONE_CACHE_TTL_MS).toISOString();
}

export function cacheEntryFresh(
  entry: Pick<VeriphoneCacheEntry, "expiresAt"> | null | undefined,
  now = new Date(),
): entry is VeriphoneCacheEntry {
  if (!entry?.expiresAt) return false;
  const exp = Date.parse(entry.expiresAt);
  return Number.isFinite(exp) && exp > now.getTime();
}

async function readFileCache(): Promise<CacheFile> {
  const parsed = await readJsonFile<CacheFile>(cachePath(), {
    unparseableCode: "phone_type_cache_unparseable",
  });
  if (!parsed) return { entries: {} };
  return { entries: parsed.entries ?? {} };
}

async function writeFileCache(file: CacheFile): Promise<void> {
  const target = cachePath();
  await mkdir(path.dirname(target), { recursive: true });
  await writeFileAtomic(target, JSON.stringify(file, null, 2));
}

function rowToEntry(row: {
  e164: string;
  phoneValid: boolean;
  phoneType: string;
  carrier: string | null;
  country: string | null;
  checkedAt: Date;
  expiresAt: Date;
}): VeriphoneCacheEntry {
  return {
    e164: row.e164,
    phoneValid: row.phoneValid,
    phoneType: row.phoneType,
    carrier: row.carrier ?? undefined,
    country: row.country ?? undefined,
    checkedAt: row.checkedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

export async function getPhoneTypeCache(
  e164: string,
  now = new Date(),
): Promise<VeriphoneCacheEntry | null> {
  const prisma = postgresEnabled() ? getPrisma() : null;
  if (prisma) {
    try {
      const row = await prisma.phoneTypeCache.findUnique({ where: { e164 } });
      if (row) {
        const entry = rowToEntry(row);
        return cacheEntryFresh(entry, now) ? entry : null;
      }
    } catch (err) {
      console.error("[veriphone] prisma cache read failed, using file", err);
    }
  }

  const file = await readFileCache();
  const entry = file.entries[e164];
  return cacheEntryFresh(entry, now) ? entry : null;
}

export async function putPhoneTypeCache(
  entry: VeriphoneCacheEntry,
): Promise<void> {
  const prisma = postgresEnabled() ? getPrisma() : null;
  if (prisma) {
    try {
      await prisma.phoneTypeCache.upsert({
        where: { e164: entry.e164 },
        create: {
          e164: entry.e164,
          phoneValid: entry.phoneValid,
          phoneType: entry.phoneType,
          carrier: entry.carrier,
          country: entry.country,
          checkedAt: new Date(entry.checkedAt),
          expiresAt: new Date(entry.expiresAt),
        },
        update: {
          phoneValid: entry.phoneValid,
          phoneType: entry.phoneType,
          carrier: entry.carrier,
          country: entry.country,
          checkedAt: new Date(entry.checkedAt),
          expiresAt: new Date(entry.expiresAt),
        },
      });
      return;
    } catch (err) {
      console.error("[veriphone] prisma cache write failed, using file", err);
    }
  }

  const file = await readFileCache();
  file.entries[entry.e164] = entry;
  await writeFileCache(file);
}

export function entryFromLookup(input: {
  e164: string;
  phoneValid: boolean;
  phoneType: string;
  carrier?: string;
  country?: string;
  now?: Date;
}): VeriphoneCacheEntry {
  const checkedAt = input.now ?? new Date();
  return {
    e164: input.e164,
    phoneValid: input.phoneValid,
    phoneType: input.phoneType,
    carrier: input.carrier,
    country: input.country,
    checkedAt: checkedAt.toISOString(),
    expiresAt: cacheExpiryIso(checkedAt),
  };
}
