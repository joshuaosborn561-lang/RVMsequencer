import { API_RATE_LIMIT } from "@/lib/hardening/constants";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Simple in-process rate limit (per instance). Good enough until Redis. */
export function checkRateLimit(
  key: string,
  opts?: { windowMs?: number; max?: number },
): { ok: true } | { ok: false; retryAfterSec: number } {
  const windowMs = opts?.windowMs ?? API_RATE_LIMIT.windowMs;
  const max = opts?.max ?? API_RATE_LIMIT.max;
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  if (b.count > max) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
    };
  }
  return { ok: true };
}

export function clientKeyFromRequest(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "anon"
  );
}
