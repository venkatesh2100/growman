// Per-phone and per-IP limits for OTP sends. Retries only pay the cooldown.
// The phone-login handler calls Throttle.allow before MSG91 is asked to send a code.
// Returns { ok, reason, retryAfter }. retryAfter is milliseconds the client should wait.
// A missing Redis throws. This limiter does not fail open, because an unlimited SMS bill is worse than a 500.

export const BlockNone = "";
export const BlockCooldown = "cooldown";
export const BlockDayCap = "daycap";
export const BlockIPCap = "ipcap";

// Reads a positive integer from the environment. Blank, junk, or non-positive values use fallback.
function envInt(key, fallback) {
  const value = process.env[key];
  if (value == null || value === "") return fallback;
  if (!/^[+-]?\d+$/.test(value)) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

// Accepts the raw Redis client, or a wrapper that keeps it on .rdb or .redis. Returns null when neither can INCR.
function resolveRedis(redis) {
  if (redis && typeof redis.incr === "function") return redis;
  if (redis && typeof redis.rdb?.incr === "function") return redis.rdb;
  if (redis && typeof redis.redis?.incr === "function") return redis.redis;
  return null;
}

/**
 * @returns {Promise<{ ok: boolean, reason: string, retryAfter: number }>}
 * retryAfter is milliseconds (a Go time.Duration).
 */
// Called as Throttle.allow. isRetry true skips the daily and per-IP caps and only checks the short cooldown.
// A send that is allowed also starts the cooldown, so the next tap inside that window is BlockCooldown.
export async function allow(ctx, phone, ip, isRetry) {
  // Honour a cancelled request before any Redis call.
  if (ctx && typeof ctx === "object" && ctx.aborted) {
    throw ctx.reason ?? new DOMException("This operation was aborted", "AbortError");
  }
  const redis = this?.redis;
  if (!redis) throw new Error("redis not configured");

  const cooldownSeconds = envInt("OTP_COOLDOWN_SECONDS", 30);
  const dayCap = envInt("OTP_DAY_CAP", 20);
  const ipCap = envInt("OTP_IP_HOUR_CAP", 40);
  const cooldownMs = cooldownSeconds * 1000;

  // The short wait is checked first so a shopper who just received a code is not also charged a daily count.
  const cooldownKey = `otp:cooldown:${phone}`;
  let ttlSeconds;
  try {
    ttlSeconds = Number(await redis.ttl(cooldownKey));
  } catch (err) {
    throw err;
  }
  if (ttlSeconds > 0) {
    return { ok: false, reason: BlockCooldown, retryAfter: ttlSeconds * 1000 };
  }

  // A resend of the same code does not count as a new SMS against the day or the IP.
  if (!isRetry) {
    const dayKey = `otp:daycap:${phone}`;
    const dayCount = Number(await redis.incr(dayKey));
    // The first hit of the day starts the 24-hour window. Later hits keep the original expiry.
    if (dayCount === 1) {
      try {
        await redis.expire(dayKey, 24 * 60 * 60);
      } catch {
        /* Go discards the Expire error */
      }
    }
    if (dayCount > dayCap) {
      // Put the count back so a rejected send does not consume a slot.
      try {
        await redis.decr(dayKey);
      } catch {
        /* ignored, same as the Go client */
      }
      let dayTTL = 0;
      try {
        dayTTL = Number(await redis.ttl(dayKey));
      } catch {
        dayTTL = 0;
      }
      // A missing expiry would otherwise block until Redis forgets the key. One hour is the fallback wait.
      if (dayTTL < 0) dayTTL = 60 * 60;
      return { ok: false, reason: BlockDayCap, retryAfter: dayTTL * 1000 };
    }

    if (ip) {
      const ipKey = `otp:ipcap:${ip}`;
      const ipCount = Number(await redis.incr(ipKey));
      // The IP window is one hour, shared by every phone that address tries.
      if (ipCount === 1) {
        try {
          await redis.expire(ipKey, 60 * 60);
        } catch {
          /* ignored */
        }
      }
      if (ipCount > ipCap) {
        try {
          await redis.decr(ipKey);
        } catch {
          /* ignored */
        }
        let ipTTL = 0;
        try {
          ipTTL = Number(await redis.ttl(ipKey));
        } catch {
          ipTTL = 0;
        }
        if (ipTTL < 0) ipTTL = 60;
        return { ok: false, reason: BlockIPCap, retryAfter: ipTTL * 1000 };
      }
    }
  }

  // The send is allowed. Start the cooldown so the next tap waits.
  await redis.set(cooldownKey, "1", "EX", cooldownSeconds);
  return { ok: true, reason: BlockNone, retryAfter: cooldownMs };
}

// Holds the Redis client. The phone handler constructs this once.
export class Throttle {
  constructor(redis) {
    this.redis = resolveRedis(redis);
  }

  // Same return as allow. ctx is an abort signal, phone and ip are the buckets, isRetry skips the caps.
  allow(ctx, phone, ip, isRetry) {
    return allow.call(this, ctx, phone, ip, isRetry);
  }
}

// Returns a Throttle bound to this Redis. Callers use this instead of new Throttle when they want the helper.
export function createThrottle(redis) {
  return new Throttle(redis);
}
