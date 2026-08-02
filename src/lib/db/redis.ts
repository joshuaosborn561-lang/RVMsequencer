import Redis from "ioredis";

const globalForRedis = globalThis as unknown as { redis?: Redis | null };

export function getRedis(): Redis | null {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (globalForRedis.redis === undefined) {
    try {
      globalForRedis.redis = new Redis(url, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        lazyConnect: false,
      });
      globalForRedis.redis.on("error", () => {
        /* swallow — callers fall back */
      });
    } catch {
      globalForRedis.redis = null;
    }
  }
  return globalForRedis.redis ?? null;
}

export function redisEnabled(): boolean {
  return Boolean(process.env.REDIS_URL?.trim());
}
