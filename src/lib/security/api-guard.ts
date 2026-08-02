import { NextResponse } from "next/server";
import {
  checkRateLimit,
  clientKeyFromRequest,
} from "@/lib/security/rate-limit";

/** Light per-IP rate limit for mutating API routes. */
export function guardApiRateLimit(
  req: Request,
  bucket = "api",
): NextResponse | null {
  const rl = checkRateLimit(`${bucket}:${clientKeyFromRequest(req)}`);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
  }
  return null;
}
