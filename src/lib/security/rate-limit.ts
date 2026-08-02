import { API_RATE_LIMIT } from "@/lib/hardening/constants";
import { getRedis } from "@/lib/db/redis";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Shared rate limit — Redis when REDIS_URL is set, else in-process. */
export async function checkRateLimit(
  key: string,
  opts?: { windowMs?: number; max?: number },
): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  const windowMs = opts?.windowMs ?? API_RATE_LIMIT.windowMs;
  const max = opts?.max ?? API_RATE_LIMIT.max;

  const redis = getRedis();
  if (redis) {
    try {
      const rk = `rl:${key}`;
      const n = await redis.incr(rk);
      if (n === 1) {
        await redis.pexpire(rk, windowMs);
      }
      if (n > max) {
        const ttl = await redis.pttl(rk);
        return {
          ok: false,
          retryAfterSec: Math.max(1, Math.ceil((ttl > 0 ? ttl : windowMs) / 1000)),
        };
      }
      return { ok: true };
    } catch {
      /* fall through to memory */
    }
  }

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
