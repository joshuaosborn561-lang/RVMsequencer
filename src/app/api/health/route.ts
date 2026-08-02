import { NextResponse } from "next/server";
import { postgresEnabled, getPrisma } from "@/lib/db/prisma";
import { redisEnabled, getRedis } from "@/lib/db/redis";

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

  return NextResponse.json({
    ok: true,
    app: "RVM Drop",
    time: new Date().toISOString(),
    postgres,
    redis,
    claimPath: postgres === "up" ? "SKIP_LOCKED" : "FILE_LOCK",
  });
}
