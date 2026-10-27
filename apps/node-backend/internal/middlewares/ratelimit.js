// Request rate limits. Login and OTP use the strict limiter. Ordinary API routes use the named one.
// The router calls the two exported factories and mounts the middleware they return.
// A request over the limit gets 429 and does not continue. Under the limit, next() is called.

import { clientIP } from "./ip.js";

// One counter per key. The expiry is set only on the first hit so the window does not keep sliding.
const rateLimitLua = `
local n = redis.call("INCR", KEYS[1])
if n == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return n
`;

// In-process counter used when Redis is down and the route must still enforce a limit.
// Not shared across processes. Returns an object with incr(key, windowMs) -> count.
function newLocalLimiter() {
  const counts = new Map();
  const resetAt = new Map();
  return {
    incr(key, windowMs) {
      const now = Date.now();
      const reset = resetAt.get(key);
      // A new window starts when this key has never been seen or its window has passed.
      if (reset == null || now > reset) {
        counts.set(key, 0);
        resetAt.set(key, now + windowMs);
        // Drop expired keys once the table gets large so a scan cannot grow forever.
        if (counts.size > 10000) {
          for (const [k, r] of resetAt) {
            if (now > r) {
              counts.delete(k);
              resetAt.delete(k);
            }
          }
        }
      }
      const n = (counts.get(key) || 0) + 1;
      counts.set(key, n);
      return n;
    },
  };
}

// Builds the middleware. identifier picks the bucket (usually the client IP).
// failClosed false: a Redis outage lets the request through. failClosed true: count in this process instead.
// Sends rate-limit headers on every counted request, and 429 when the count passes the limit.
export function rateLimiter({ redis, limit, windowMs, name = "api", identifier, failClosed = false }) {
  const windowSec = Math.max(1, Math.floor(windowMs / 1000));
  const fallback = newLocalLimiter();
  return async (req, res, next) => {
    let id = identifier ? identifier(req) : "";
    if (!id) id = clientIP(req);
    const key = `rl:${name}:${id}`;
    let n;
    if (!redis) {
      // No Redis and this route is allowed to fail open. Do not block the shop.
      if (!failClosed) return next();
      n = fallback.incr(key, windowMs);
    } else {
      try {
        n = Number(await redis.eval(rateLimitLua, 1, key, String(windowSec)));
      } catch (err) {
        if (!failClosed) return next();
        console.log(`[RATELIMIT] ${name} bucket falling back to in-process counter: ${err}`);
        n = fallback.incr(key, windowMs);
      }
    }
    const remaining = Math.max(0, limit - n);
    res.set("X-RateLimit-Limit", String(limit));
    res.set("X-RateLimit-Remaining", String(remaining));
    res.set("X-RateLimit-Reset", String(Math.floor((Date.now() + windowMs) / 1000)));
    if (n > limit) {
      res.set("Retry-After", String(windowSec));
      res.status(429).type("application/json").send('{"error":"rate limit exceeded"}');
      return;
    }
    next();
  };
}

// Normal API routes, keyed by client IP. A Redis outage does not block shoppers.
// Returns Express middleware.
export function namedIPRateLimiter(redis, name, limit, windowMs) {
  return rateLimiter({ redis, name, limit, windowMs, identifier: clientIP });
}

// Login, OTP, and other abuse-sensitive routes. Still counts when Redis is down.
// Returns Express middleware.
export function strictIPRateLimiter(redis, name, limit, windowMs) {
  return rateLimiter({ redis, name, limit, windowMs, failClosed: true, identifier: clientIP });
}
