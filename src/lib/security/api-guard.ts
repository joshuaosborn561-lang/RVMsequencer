import { NextResponse } from "next/server";
import {
  checkRateLimit,
  clientKeyFromRequest,
} from "@/lib/security/rate-limit";

/** Light per-IP rate limit for mutating API routes. */
export async function guardApiRateLimit(
  req: Request,
  bucket = "api",
): Promise<NextResponse | null> {
  const rl = await checkRateLimit(`${bucket}:${clientKeyFromRequest(req)}`);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
  }
  return null;
}

/** CRON_SECRET via `x-cron-secret` or `Authorization: Bearer`. */
export function authorizeCronSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const header = req.headers.get("x-cron-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  return header === secret || auth === `Bearer ${secret}`;
}

/** 401 unless cron/operator secret matches (same contract as tick / Allo sync). */
export function guardCronAuth(req: Request): NextResponse | null {
  if (authorizeCronSecret(req)) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
