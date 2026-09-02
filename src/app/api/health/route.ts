import { NextResponse } from "next/server";
import { postgresEnabled, getPrisma } from "@/lib/db/prisma";
import { redisEnabled, getRedis } from "@/lib/db/redis";
import { isAlloSyncConfigured, isAlloSyncEnabled } from "@/lib/allo/client";

export async function GET() {
  let postgres: "up" | "down" | "disabled" = "disabled";
  if (postgresEnabled()) {
    try {
      const prisma = getPrisma();
      if (!prisma) throw new Error("no_prisma");
      await prisma.$queryRaw`SELECT 1`;
      postgres = "up";
    } catch {
      postgres = "down";
    }
  }

  let redis: "up" | "down" | "disabled" = "disabled";
  if (redisEnabled()) {
    try {
      const r = getRedis();
      const pong = r ? await r.ping() : null;
      redis = pong === "PONG" ? "up" : "down";
    } catch {
      redis = "down";
    }
  }

  const alloSyncEnabled = isAlloSyncEnabled();
  const alloConfigured = isAlloSyncConfigured();
  const alloSyncError =
    alloSyncEnabled && !alloConfigured
      ? "ALLO_SUPPRESSION_SYNC enabled but ALLO_API_KEY is missing"
      : null;

  return NextResponse.json({
    ok: !alloSyncError,
    app: "RVM Drop",
    time: new Date().toISOString(),
    postgres,
    redis,
    claimPath: postgres === "up" ? "SKIP_LOCKED" : "FILE_LOCK",
    alloSync: {
      enabled: alloSyncEnabled,
      configured: alloConfigured,
      error: alloSyncError,
    },
  });
}
