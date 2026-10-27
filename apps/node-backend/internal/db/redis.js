// Connects the shared Redis used for catalog cache, OTP codes, and rate limits.
// The API server calls connectRedis at startup.
// Returns a live client, or null when Redis is unset or unreachable so the shop keeps running.

import Redis from "ioredis";

// Called once at startup. A missing URL is not an error: cache and OTP fall back to memory.
export async function connectRedis(cfg) {
  if (!cfg.redisURL) return null;
  let redis;
  try {
    redis = new Redis(cfg.redisURL, {
      // One retry is enough. A stuck Redis must not hold a checkout open.
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      commandTimeout: 500,
      enableReadyCheck: true,
      // Do not connect inside the constructor. We connect and ping ourselves below.
      lazyConnect: true,
    });
    // Swallow later socket errors so a blip does not crash the process.
    redis.on("error", () => {});
    await redis.connect();
    // A TCP connect is not enough. Confirm Redis actually answers.
    await redis.ping();
    return redis;
  } catch (err) {
    // Catalog, OTP, and rate limits have in-process fallbacks. Keep serving.
    console.log(`[REDIS] Failed to connect to Redis: ${err} (continuing without Redis)`);
    try {
      redis?.disconnect();
    } catch {
      /* ignore */
    }
    return null;
  }
}
