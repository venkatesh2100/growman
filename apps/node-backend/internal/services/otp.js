// Email and password-reset codes, plus the short-lived proof checkout uses after a code is accepted.
// Auth handlers call the OTPService methods. Redis is tried first. This process keeps a copy so a Redis blip
// does not forget a code that was just sent. A match returns true. A miss, a wrong code, or an expired code returns false.

import { randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";

// A code is useless after five minutes. A resend is refused for one minute.
export const otpExpiryMinutes = 5;
export const otpResendCooldownMs = 60 * 1000;
const otpCooldownPrefix = "otp:cooldown:";
const otpKeyPrefix = "otp:email:";
const passwordResetOTPPrefix = "otp:password-reset:";
const passwordResetCooldownPrefix = "otp:password-reset:cooldown:";
const passwordResetVerifiedPrefix = "otp:password-reset:verified:";
const verificationProofPrefix = "checkout:verified:";
const redisOpTimeoutMs = 800;
// Long enough to reach payment, short enough that a leaked token is near-useless.
export const verificationProofTtlMs = 15 * 60 * 1000;

// Deletes the key only when the stored value still matches. Two checkouts cannot both spend one proof.
const compareAndDeleteScript = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

// Process-wide fallback. Redis is best-effort; memory already holds the value.
const memStore = new Map();

// The API builds one of these with the shared Redis client. A null client means memory only.
export class OTPService {
  constructor(redis) {
    this.redis = redis || null;
  }

  // Login and signup call this, then email the returned digits. The stored value is a hash, not the code.
  // Returns the plain 6-digit code. The caller must send it. It is not stored in the clear.
  async generateOTP(email) {
    email = normalizeEmail(email);
    const otp = generateDigits();
    const hashed = hashOTP(otp);
    await this.setValue(otpKeyPrefix + email, hashed, otpExpiryMinutes * 60 * 1000);
    return otp;
  }

  // Login calls this with the code the shopper typed. A hit deletes the code so it cannot be reused.
  // Returns true only when the hash matches.
  async verifyOTP(email, otp) {
    email = normalizeEmail(email);
    const key = otpKeyPrefix + email;
    const found = await this.getValue(key);
    if (!found.ok) return false;
    if (!otpMatches(found.value, otp)) return false;
    await this.delValue(key);
    return true;
  }

  // Forgot-password calls this. Any earlier "already verified" flag for this email is cleared.
  // Returns the plain code for the email.
  async generatePasswordResetOTP(email) {
    email = normalizeEmail(email);
    const otp = generateDigits();
    const hashed = hashOTP(otp);
    await this.setValue(passwordResetOTPPrefix + email, hashed, otpExpiryMinutes * 60 * 1000);
    await this.delValue(passwordResetVerifiedPrefix + email);
    return otp;
  }

  // The reset form's first step. The code is kept so the later password change can still check it.
  // Returns true when the hash matches. A verified flag is stored beside the hash.
  async verifyPasswordResetOTP(email, otp) {
    email = normalizeEmail(email);
    const key = passwordResetOTPPrefix + email;
    const found = await this.getValue(key);
    if (!found.ok) return false;
    if (!otpMatches(found.value, otp)) return false;
    // Keep the OTP for the reset step, and mark verified so reset can proceed if Redis flakes.
    await this.setValue(passwordResetVerifiedPrefix + email, String(otp ?? ""), otpExpiryMinutes * 60 * 1000);
    return true;
  }

  // The password-change step. Prefers the verified flag. If that flag is gone, checks the hash again.
  // Either path deletes both keys. Returns true when this code may change the password.
  async consumePasswordResetOTP(email, otp) {
    email = normalizeEmail(email);
    const verifiedKey = passwordResetVerifiedPrefix + email;
    const otpKey = passwordResetOTPPrefix + email;
    const stored = await this.getValue(verifiedKey);
    if (stored.ok && stored.value === String(otp ?? "")) {
      await this.delValue(verifiedKey);
      await this.delValue(otpKey);
      return true;
    }
    const valid = await this.verifyPasswordResetOTP(email, otp);
    if (!valid) return false;
    await this.delValue(verifiedKey);
    await this.delValue(otpKey);
    return true;
  }

  // Drops a reset code and its verified flag. Called when the reset is abandoned or finished another way.
  async deletePasswordResetOTP(email) {
    email = normalizeEmail(email);
    await this.delValue(passwordResetOTPPrefix + email);
    await this.delValue(passwordResetVerifiedPrefix + email);
  }

  // { ok, ttlMs }. ttlMs is the remaining cooldown; divide by 1000 and truncate for retry_after seconds.
  // Login calls this before sending another email code.
  async canResendOTP(email) {
    return this.cooldownState(otpCooldownPrefix + normalizeEmail(email));
  }

  // Starts the one-minute wait after a code email is sent.
  async setResendCooldown(email) {
    await this.setValue(otpCooldownPrefix + normalizeEmail(email), "1", otpResendCooldownMs);
  }

  // Opaque single-use token bound to one email. The OTP is deleted on
  // verification and is not replayed as a bearer credential.
  // Checkout calls this after the email code is accepted. Returns the hex token to put on the order.
  async issueVerificationProof(email) {
    email = normalizeEmail(email);
    const token = randomBytes(32).toString("hex");
    await this.setValue(verificationProofPrefix + email, token, verificationProofTtlMs);
    return token;
  }

  // False for a missing, expired, mismatched, or already-used token.
  // Checkout calls this once, when the order is placed. A wrong guess does not delete the real proof.
  async consumeVerificationProof(email, token) {
    email = normalizeEmail(email);
    if (!token) return false;
    const key = verificationProofPrefix + email;
    const found = await this.getValue(key);
    if (!found.ok) return false;
    // Constant-time compare. A mismatch leaves the stored proof in place
    // so a guess cannot lock the shopper out of checkout.
    if (!constantTimeEqual(found.value, token)) return false;
    // compare-and-delete so two concurrent checkouts cannot both spend one proof.
    return this.compareAndDelete(key, String(token));
  }

  // Same cooldown check as canResendOTP, for the password-reset email.
  async canResendPasswordResetOTP(email) {
    return this.cooldownState(passwordResetCooldownPrefix + normalizeEmail(email));
  }

  // Starts the one-minute wait after a reset code is sent.
  async setPasswordResetCooldown(email) {
    await this.setValue(passwordResetCooldownPrefix + normalizeEmail(email), "1", otpResendCooldownMs);
  }

  // ok is false while the cooldown key still has time left. ttlMs is that remaining time, or 0 when a send is allowed.
  async cooldownState(key) {
    const ttlMs = await this.cooldownTTL(key);
    if (ttlMs <= 0) return { ok: true, ttlMs: 0 };
    return { ok: false, ttlMs };
  }

  // Writes memory first, then Redis. A Redis failure is ignored because the memory copy is already there.
  async setValue(key, value, ttlMs) {
    memSet(key, value, ttlMs);
    if (!this.redis) return;
    try {
      await withTimeout(this.redis.set(key, value, "PX", Math.max(1, Math.round(ttlMs))));
    } catch {
      /* memory already has it */
    }
  }

  // Redis wins when it answers. A timeout or a miss falls through to this process's copy.
  // Returns { value, ok }. ok is false when neither store has the key.
  async getValue(key) {
    if (this.redis) {
      try {
        const val = await withTimeout(this.redis.get(key));
        if (val != null) return { value: String(val), ok: true };
      } catch {
        /* fall through to memory */
      }
    }
    const mem = memGet(key);
    if (mem != null) return { value: mem, ok: true };
    return { value: "", ok: false };
  }

  // Removes the key from memory and from Redis. A Redis error does not put the memory value back.
  async delValue(key) {
    memDel(key);
    if (!this.redis) return;
    try {
      await withTimeout(this.redis.del(key));
    } catch {
      /* best-effort */
    }
  }

  // True only when Redis (or memory) still holds want and the delete happened. A mismatch returns false.
  async compareAndDelete(key, want) {
    if (this.redis) {
      try {
        const res = await withTimeout(this.redis.eval(compareAndDeleteScript, 1, key, want));
        memDel(key);
        return Number(res) === 1;
      } catch {
        /* fall through to memory */
      }
    }
    return memCompareAndDelete(key, want);
  }

  // Remaining cooldown in milliseconds. Redis TTL is in seconds, so it is scaled. A Redis error uses memory.
  async cooldownTTL(key) {
    if (this.redis) {
      try {
        const ttl = await withTimeout(this.redis.ttl(key));
        if (typeof ttl === "number" && ttl > 0) return ttl * 1000;
      } catch {
        /* fall through to memory */
      }
    }
    return memTTL(key);
  }
}

// Handlers call this instead of constructing OTPService themselves. Returns the service.
export function createOTPService(redis) {
  return new OTPService(redis);
}

// Memory copy of one key. expiresAt is an absolute timestamp.
function memSet(key, value, ttlMs) {
  memStore.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// Returns the value, or null when the key is missing or already expired. Expired keys are deleted.
function memGet(key) {
  const entry = memStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memStore.delete(key);
    return null;
  }
  return entry.value;
}

function memDel(key) {
  memStore.delete(key);
}

// Removes the key first so a second caller cannot also succeed, then puts it back if the value did not match
// or it had already expired. Returns true only for a live match.
function memCompareAndDelete(key, want) {
  const entry = memStore.get(key);
  if (!entry) return false;
  memStore.delete(key);
  if (entry.value === want && Date.now() < entry.expiresAt) return true;
  memStore.set(key, entry);
  return false;
}

// Remaining milliseconds for a memory key, or 0 when it is missing or expired.
function memTTL(key) {
  const entry = memStore.get(key);
  if (!entry) return 0;
  const ttl = entry.expiresAt - Date.now();
  if (ttl <= 0) {
    memStore.delete(key);
    return 0;
  }
  return ttl;
}

// Codes are stored per address, so "User@Mail.com" and "user@mail.com" share one code.
function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

// Six digits from random bytes. A leading zero is kept. This is not a timestamp.
function generateDigits() {
  const buf = randomBytes(3);
  const n = buf[0] * 65536 + buf[1] * 256 + buf[2];
  return String(n).padStart(6, "0").slice(0, 6);
}

// Slow hash so a leaked Redis value is not the code itself. Cost 4 is enough for a 6-digit value.
function hashOTP(otp) {
  return bcrypt.hashSync(otp, 4);
}

// False when the hash is corrupt or the code does not match. A throw must not become a successful login.
function otpMatches(hashed, otp) {
  try {
    return bcrypt.compareSync(String(otp ?? ""), hashed);
  } catch {
    return false;
  }
}

// True when both strings are the same length and the same bytes. Length is checked first because the
// constant-time compare refuses unequal buffers. A mismatch still takes the same time for equal lengths.
function constantTimeEqual(stored, token) {
  const a = Buffer.from(String(stored));
  const b = Buffer.from(String(token));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Rejects if Redis does not answer within ms. The original promise's rejection is swallowed so a late
// failure does not become an unhandled error after we already timed out.
function withTimeout(promise, ms = redisOpTimeoutMs) {
  promise.then(
    () => {},
    () => {},
  );
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("redis op timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
