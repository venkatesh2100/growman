/*
This file signs customers in and keeps their profile.

A customer can use a password, a phone code (MSG91), Google, or Truecaller.
A brand-new phone customer with no name gets a short-lived token that can
only finish the profile. Everyone else gets a normal token that lasts 24 hours.

Guests who check out by email use the code helpers here. The code is stored
as a hash for 5 minutes. After it matches, we hand back a proof that checkout
uses once. Password reset uses the same idea, with its own keys.

Redis holds the codes. If Redis is slow or down, a small in-memory copy is
used so email codes still work. Phone codes need Redis, because each text
costs money and the send limits live there.
*/

import { randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import nodemailer from "nodemailer";
import { Op } from "sequelize";
import { json, error } from "../../pkg/httpjson/httpjson.js";
import {
  requireUser,
  generateToken,
  generateTokenWithScope,
  isAdminRole,
  ScopeFull,
  ScopeOnboarding,
} from "../auth/jwt.js";
import { User, strPtr, emailOrEmpty, phoneOrEmpty } from "../models/index.js";
import { lookupVariants, tenDigitIN, msg91Format } from "../phoneutil/phone.js";
import { exactIP } from "../middlewares/ip.js";

// Login tokens last a day. Passwords use a slow hash. Email codes use a faster
// hash because they expire in 5 minutes. A customer can ask for a new email code
// once a minute. The checkout proof lasts 15 minutes. Redis calls give up after
// 800ms so a stuck Redis does not freeze sign-in.
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const BCRYPT_COST = 10;
const OTP_HASH_COST = 4;
const OTP_EXPIRY_MS = 5 * 60 * 1000;
const OTP_COOLDOWN_MS = 60 * 1000;
const PROOF_TTL_MS = 15 * 60 * 1000;
const REDIS_TIMEOUT_MS = 800;

// Separate Redis keys so an email login code, a password-reset code, and a
// checkout proof cannot be used in place of each other.
const OTP_COOLDOWN_PREFIX = "otp:cooldown:";
const OTP_KEY_PREFIX = "otp:email:";
const PASSWORD_RESET_OTP_PREFIX = "otp:password-reset:";
const PASSWORD_RESET_COOLDOWN_PREFIX = "otp:password-reset:cooldown:";
const PASSWORD_RESET_VERIFIED_PREFIX = "otp:password-reset:verified:";
const VERIFICATION_PROOF_PREFIX = "checkout:verified:";

const SITE_URL = "https://growman.live";
const BANNER_URL = SITE_URL + "/growman.png";
const LOGO_URL = SITE_URL + "/growman-leaf.png";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.venky2100.growman";
const SUPPORT_EMAIL = "growman.live@gmail.com";

// Backup store for email codes when Redis does not answer in time.
const memStore = new Map();

const ERR_PASSWORD_REQUIRED = "password required";
const ERR_INVALID_CREDENTIALS = "invalid credentials";

// The small customer object we send back after login, signup, and profile updates.
function userJSON(user) {
  return {
    id: Number(user.id),
    name: user.name || "",
    email: emailOrEmpty(user),
    phone: phoneOrEmpty(user),
  };
}

// The delivery address stored on the customer, shaped for the app.
function addressJSON(user) {
  return {
    line: user.addressLine || "",
    city: user.city || "",
    state: user.state || "",
    pincode: user.pincode || "",
    country: user.country || "",
    latitude: user.latitude ?? null,
    longitude: user.longitude ?? null,
  };
}

// Strip spaces and one pair of wrapping quotes from a browser header.
function trimQuotes(value) {
  return String(value ?? "").trim().replace(/^"|"$/g, "");
}

// Read the customer's IP, browser, and language from the request.
// Saved when we tell the shop about a new account, so they can see where the signup came from.
export function captureRequest(req) {
  return {
    ip: exactIP(req),
    userAgent: req.get("User-Agent") || "",
    language: (req.get("Accept-Language") || "").trim(),
    platform: trimQuotes(req.get("Sec-CH-UA-Platform")),
    model: trimQuotes(req.get("Sec-CH-UA-Model")),
    secCHUA: (req.get("Sec-CH-UA") || "").trim(),
    secFetchMode: (req.get("Sec-Fetch-Mode") || "").trim(),
    referer: (req.get("Referer") || "").trim(),
    forwardedFor: (req.get("X-Forwarded-For") || "").trim(),
  };
}

// Make a customer's name or code safe to drop into an HTML email.
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The green code box used in verification and password-reset emails.
export function otpBlock(code) {
  return `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#374151;">Use this code to continue:</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:16px 28px;text-align:center;">
<span style="font-size:32px;font-weight:700;letter-spacing:6px;color:#047857;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">${escapeHtml(code)}</span>
</td></tr></table>
<p style="margin:20px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">Expires in 5 minutes. If you didn't request this, you can ignore this email.</p>`;
}

// Wrap email content in the Growman layout: banner, body, and footer links.
export function renderEmail(preheader, innerHTML) {
  const pre = escapeHtml(preheader);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Growman</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">${pre}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f5;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
<tr><td style="padding:0;line-height:0;">
<a href="${SITE_URL}" style="text-decoration:none;">
<img src="${BANNER_URL}" alt="Growman" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;">
</a>
</td></tr>
<tr><td style="padding:32px 28px 8px;">
${innerHTML}
</td></tr>
<tr><td style="padding:16px 28px 28px;border-top:1px solid #f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="vertical-align:middle;">
<img src="${LOGO_URL}" alt="" width="28" height="28" style="display:inline-block;vertical-align:middle;border:0;">
<span style="font-size:13px;color:#6b7280;vertical-align:middle;margin-left:8px;">Growman · <a href="${SITE_URL}" style="color:#059669;text-decoration:none;">growman.live</a></span>
</td>
</tr>
<tr><td style="padding-top:8px;font-size:12px;color:#9ca3af;line-height:1.5;">
Questions? <a href="mailto:${SUPPORT_EMAIL}" style="color:#059669;text-decoration:none;">${SUPPORT_EMAIL}</a>
</td></tr>
<tr><td style="padding-top:10px;font-size:12px;color:#9ca3af;line-height:1.5;">
<a href="${PLAY_STORE_URL}" style="color:#059669;text-decoration:none;font-weight:500;">Get the Growman app on Google Play</a>
</td></tr>
</table>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// True when the text has an @ and a dot. This is a loose check, not a full email parser.
export function validateEmail(email) {
  const emailText = String(email ?? "");
  return emailText.includes("@") && emailText.includes(".");
}

// Build the mail sender from the shop's SMTP settings.
// Port 465 uses a secure connection. Other ports (usually 587) do not.
function mailer(cfg) {
  const port = Number(cfg.smtpPort) || 587;
  return nodemailer.createTransport({
    host: cfg.smtpHost,
    port,
    secure: port === 465,
    auth: { user: cfg.smtpEmail, pass: cfg.smtpPassword },
  });
}

// Send one shop email: codes, order mail, invoices, and welcome notes all come through here.
// Throws if SMTP is not set up, or if there is no recipient. Newlines are stripped from
// the address and subject so a caller cannot sneak in extra headers.
export async function sendTransactionalEmail(to, subject, text, htmlBody, attachments) {
  const cfg = this.cfg;
  if (!cfg.smtpEmail || !cfg.smtpPassword) throw new Error("SMTP credentials not configured");
  if (!to) throw new Error("recipient required");
  const message = {
    from: `Growman <${cfg.smtpEmail}>`,
    to: String(to).replace(/[\r\n]/g, ""),
    subject: String(subject).replace(/[\r\n]/g, ""),
    text,
    html: htmlBody,
  };
  if (attachments?.length) {
    message.attachments = attachments.map((attachment) => ({
      filename: String(attachment.filename || "file").replace(/[\r\n"]/g, ""),
      content: attachment.data,
      contentType: attachment.contentType || "application/octet-stream",
    }));
  }
  await mailer(cfg).sendMail(message);
}

// Remember a value in memory until ttlMs from now. Used when Redis is unavailable.
function memSet(key, value, ttlMs) {
  memStore.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// Read a memory value. An expired entry is deleted and treated as missing.
function memGet(key) {
  const entry = memStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memStore.delete(key);
    return null;
  }
  return entry.value;
}

// Forget a memory value. Called when a code is used or a proof is consumed.
function memDel(key) {
  memStore.delete(key);
}

// Delete a memory value only when it still matches what we expect.
// The entry is removed first, then put back if the value is wrong or already expired,
// so two checks at the same moment cannot both succeed.
function memCompareAndDelete(key, want) {
  const entry = memStore.get(key);
  if (!entry) return false;
  memStore.delete(key);
  if (entry.value === want && Date.now() <= entry.expiresAt) return true;
  memStore.set(key, entry);
  return false;
}

// How many milliseconds a memory value has left. Expired entries are deleted and return 0.
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

// Lower-case and trim an email so codes for "A@x.com" and "a@x.com" share one key.
function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

// Run one Redis command, but stop waiting after 800ms.
// ok false means Redis is missing, slow, or errored. Callers then use memory.
async function redisOp(redis, fn) {
  if (!redis) return { ok: false };
  let timer;
  try {
    const value = await Promise.race([
      fn(redis),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), REDIS_TIMEOUT_MS);
      }),
    ]);
    return { ok: true, value };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

// Save a code in memory and, when Redis answers, in Redis too.
// Memory is written first so a Redis timeout still leaves a copy on this server.
async function setValue(redis, key, value, ttlMs) {
  memSet(key, value, ttlMs);
  await redisOp(redis, (client) => client.set(key, value, "PX", ttlMs));
}

// Read a code. Redis wins when it answers. Otherwise we use the memory copy.
async function getValue(redis, key) {
  const hit = await redisOp(redis, (client) => client.get(key));
  if (hit.ok && hit.value != null) return hit.value;
  return memGet(key);
}

// Forget a code in memory and in Redis.
async function delValue(redis, key) {
  memDel(key);
  await redisOp(redis, (client) => client.del(key));
}

// Redis script: delete the key only when its current value is the one we expect.
const COMPARE_AND_DELETE = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

// Use a checkout proof once. Redis does the check when it is up, and we drop the memory copy.
// When Redis is down, the memory check does the same one-time delete.
async function compareAndDelete(redis, key, want) {
  const hit = await redisOp(redis, (client) => client.eval(COMPARE_AND_DELETE, 1, key, want));
  if (hit.ok) {
    memDel(key);
    return Number(hit.value) === 1;
  }
  return memCompareAndDelete(key, want);
}

// How long the customer must wait before asking for another code.
// Redis reports seconds, so we turn that into milliseconds. Memory is the fallback.
async function cooldownTTL(redis, key) {
  const hit = await redisOp(redis, (client) => client.ttl(key));
  if (hit.ok && Number(hit.value) > 0) return Number(hit.value) * 1000;
  return memTTL(key);
}

// Make a 6-digit code from 3 random bytes. Leading zeros are kept.
function generateDigits() {
  const bytes = randomBytes(3);
  const randomNumber = bytes[0] * 256 * 256 + bytes[1] * 256 + bytes[2];
  return String(randomNumber).padStart(6, "0").slice(0, 6);
}

// Hash a short-lived code. We never store the plain digits.
async function hashOTP(otp) {
  return bcrypt.hash(otp, OTP_HASH_COST);
}

// Create an email verification code, store its hash for 5 minutes, and return the digits to email.
// Called when a guest asks for a checkout code.
export async function generateEmailOTP(email) {
  const key = OTP_KEY_PREFIX + normalizeEmail(email);
  const otp = generateDigits();
  const hashed = await hashOTP(otp);
  await setValue(this.redis, key, hashed, OTP_EXPIRY_MS);
  return otp;
}

// Check an email verification code. A match deletes the hash so it cannot be reused.
// A missing or wrong code returns false. Called from the checkout verify route.
export async function verifyEmailOTPCode(email, otp) {
  const key = OTP_KEY_PREFIX + normalizeEmail(email);
  const hashed = await getValue(this.redis, key);
  if (hashed == null) return false;
  const ok = await bcrypt.compare(String(otp ?? ""), hashed);
  if (!ok) return false;
  await delValue(this.redis, key);
  return true;
}

// Whether this email may receive another verification code yet.
// ok false means the customer should wait ttlMs. Called before we generate a new code.
export async function canResendEmailOTP(email) {
  const ttl = await cooldownTTL(this.redis, OTP_COOLDOWN_PREFIX + normalizeEmail(email));
  if (ttl <= 0) return { ok: true, ttlMs: 0 };
  return { ok: false, ttlMs: ttl };
}

// Start the one-minute wait after a verification email is sent.
export async function setEmailOTPCooldown(email) {
  await setValue(this.redis, OTP_COOLDOWN_PREFIX + normalizeEmail(email), "1", OTP_COOLDOWN_MS);
}

// Hand the guest a random proof after their email code matched.
// Checkout must send this proof back. It lasts 15 minutes.
export async function issueVerificationProof(email) {
  const token = randomBytes(32).toString("hex");
  await setValue(this.redis, VERIFICATION_PROOF_PREFIX + normalizeEmail(email), token, PROOF_TTL_MS);
  return token;
}

// Compare two strings without leaking which character differed.
// Used for the checkout proof so a guesser cannot time the check.
function constTimeEqual(left, right) {
  const leftBytes = Buffer.from(String(left));
  const rightBytes = Buffer.from(String(right));
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

// Use a checkout proof once, for this email only.
// An empty token, a missing proof, or a mismatch returns false and leaves the stored proof in place
// when the compare-and-delete does not match. A match deletes it.
export async function consumeVerificationProof(email, token) {
  if (!token) return false;
  const key = VERIFICATION_PROOF_PREFIX + normalizeEmail(email);
  const stored = await getValue(this.redis, key);
  if (stored == null) return false;
  if (!constTimeEqual(stored, token)) return false;
  return compareAndDelete(this.redis, key, stored);
}

// How many seconds the checkout proof stays valid. Sent to the app with the proof.
export function verificationProofTTLSeconds() {
  return Math.floor(PROOF_TTL_MS / 1000);
}

// Create a password-reset code and clear any earlier "already verified" mark for this email.
// The plain digits are returned so we can email them. Only the hash is stored.
async function generatePasswordResetOTPValue(email) {
  const normalizedEmail = normalizeEmail(email);
  const otp = generateDigits();
  const hashed = await hashOTP(otp);
  await setValue(this.redis, PASSWORD_RESET_OTP_PREFIX + normalizedEmail, hashed, OTP_EXPIRY_MS);
  await delValue(this.redis, PASSWORD_RESET_VERIFIED_PREFIX + normalizedEmail);
  return otp;
}

// Check a password-reset code without using it up.
// A match remembers the digits for 5 minutes so the next step can finish the reset.
async function verifyPasswordResetOTPValue(email, otp) {
  const normalizedEmail = normalizeEmail(email);
  const key = PASSWORD_RESET_OTP_PREFIX + normalizedEmail;
  const hashed = await getValue(this.redis, key);
  if (hashed == null) return false;
  const ok = await bcrypt.compare(String(otp ?? ""), hashed);
  if (!ok) return false;
  await setValue(this.redis, PASSWORD_RESET_VERIFIED_PREFIX + normalizedEmail, String(otp), OTP_EXPIRY_MS);
  return true;
}

// Use a password-reset code once, then forget both the hash and the verified mark.
// If the customer already passed the verify step, the stored digits are enough.
// Otherwise we check the hash now, which also writes the verified mark, and then delete both.
async function consumePasswordResetOTPValue(email, otp) {
  const normalizedEmail = normalizeEmail(email);
  const verifiedKey = PASSWORD_RESET_VERIFIED_PREFIX + normalizedEmail;
  const otpKey = PASSWORD_RESET_OTP_PREFIX + normalizedEmail;
  const stored = await getValue(this.redis, verifiedKey);
  if (stored != null && stored === String(otp)) {
    await delValue(this.redis, verifiedKey);
    await delValue(this.redis, otpKey);
    return true;
  }
  const valid = await verifyPasswordResetOTPValue(email, otp);
  if (!valid) return false;
  await delValue(this.redis, verifiedKey);
  await delValue(this.redis, otpKey);
  return true;
}

// Forget a password-reset code. Called when the reset email fails to send,
// so a code the customer never received cannot be used.
async function deletePasswordResetOTPValue(email) {
  const normalizedEmail = normalizeEmail(email);
  await delValue(this.redis, PASSWORD_RESET_OTP_PREFIX + normalizedEmail);
  await delValue(this.redis, PASSWORD_RESET_VERIFIED_PREFIX + normalizedEmail);
}

// Whether this email may receive another password-reset code yet.
async function canResendPasswordReset(email) {
  const ttl = await cooldownTTL(this.redis, PASSWORD_RESET_COOLDOWN_PREFIX + normalizeEmail(email));
  if (ttl <= 0) return { ok: true, ttlMs: 0 };
  return { ok: false, ttlMs: ttl };
}

// Start the one-minute wait after a password-reset email is sent.
async function setPasswordResetCooldownValue(email) {
  await setValue(this.redis, PASSWORD_RESET_COOLDOWN_PREFIX + normalizeEmail(email), "1", OTP_COOLDOWN_MS);
}

// Read a positive whole number from the environment, or use fallback.
// Missing, zero, and junk values all use the fallback.
function envInt(key, fallback) {
  const rawValue = process.env[key];
  if (!rawValue) return fallback;
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

// Decide if this phone may receive another SMS code right now.
// A resend (isRetry) only waits out the short cooldown. A new send also counts
// toward the daily cap for the phone and the hourly cap for the IP.
// Throws if Redis is not configured. Phone texts are not allowed without those limits.
async function otpThrottleAllow(redis, phone, ip, isRetry) {
  if (!redis) throw new Error("redis not configured");
  const cooldownMs = envInt("OTP_COOLDOWN_SECONDS", 30) * 1000;
  const dayCap = envInt("OTP_DAY_CAP", 20);
  const ipCap = envInt("OTP_IP_HOUR_CAP", 40);

  // Still inside the short wait from the previous text. Do not count this as a new send.
  const ttl = await redis.ttl("otp:cooldown:" + phone);
  if (ttl > 0) return { ok: false, reason: "cooldown", retryAfterMs: ttl * 1000 };

  if (!isRetry) {
    // Count a new code for this phone. The counter expires after a day.
    // If we are over the cap, undo the count and tell the caller when the day window ends.
    const dayCount = await redis.incr("otp:daycap:" + phone);
    if (dayCount === 1) await redis.expire("otp:daycap:" + phone, 24 * 60 * 60);
    if (dayCount > dayCap) {
      await redis.decr("otp:daycap:" + phone);
      let dayTTL = await redis.ttl("otp:daycap:" + phone);
      if (dayTTL < 0) dayTTL = 60 * 60;
      return { ok: false, reason: "daycap", retryAfterMs: dayTTL * 1000 };
    }
    // The same check for the caller's IP, over one hour. Skip it when we have no IP.
    if (ip) {
      const ipCount = await redis.incr("otp:ipcap:" + ip);
      if (ipCount === 1) await redis.expire("otp:ipcap:" + ip, 60 * 60);
      if (ipCount > ipCap) {
        await redis.decr("otp:ipcap:" + ip);
        let ipTTL = await redis.ttl("otp:ipcap:" + ip);
        if (ipTTL < 0) ipTTL = 60;
        return { ok: false, reason: "ipcap", retryAfterMs: ipTTL * 1000 };
      }
    }
  }

  // The send is allowed. Start the short wait so the next tap is not instant.
  await redis.set("otp:cooldown:" + phone, "1", "PX", cooldownMs);
  return { ok: true, reason: "", retryAfterMs: cooldownMs };
}

// Read which MSG91 channel the app asked to retry on.
// The app may send retryChannel or channel, as a number or a numeric string.
// 0 means "not specified".
function parseRetryChannel(primary, fallback) {
  for (const raw of [primary, fallback]) {
    if (raw == null || raw === "null") continue;
    if (typeof raw === "number" && raw > 0) return raw;
    if (typeof raw === "string") {
      const parsedChannel = Number.parseInt(raw.trim(), 10);
      if (Number.isFinite(parsedChannel) && parsedChannel > 0) return parsedChannel;
    }
  }
  return 0;
}

// Turn an MSG91 status code into text. Quoted JSON strings lose their quotes.
function codeString(code) {
  if (code == null) return "";
  if (typeof code === "string") return code;
  if (typeof code === "number") return String(code);
  return String(code).replace(/^"|"$/g, "");
}

// Turn an MSG91 error body into a sentence we can log and, for IP blocks, show the operator.
function formatMsg91Error(out, raw) {
  const msg = String(out?.message ?? "").trim();
  const code = codeString(out?.code);
  if (msg.toLowerCase() === "ipblocked") {
    return "MSG91 blocked this server IP. In MSG91 dashboard → Authkey / IP security, allow your public IP (or disable IP restriction for this key), then retry.";
  }
  if (!msg) return raw;
  if (code) return `${msg} (code ${code})`;
  return msg;
}

// POST JSON to MSG91 and parse the reply. A body that is not JSON is an error,
// because we need their type and message fields to know if the text was accepted.
async function postJSON(url, payload, timeoutMs = 15000) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await resp.text();
  let out;
  try {
    out = JSON.parse(raw);
  } catch (err) {
    throw new Error(`msg91 decode: ${err.message} (body=${raw})`);
  }
  return { out, raw };
}

// Ask MSG91's widget to text a code to this phone.
// Some numbers are verified without a code (access-token comes back immediately).
// Otherwise the message field is the request id the app must send back with the code.
async function widgetSendOTP(cfg, phone) {
  const { out, raw } = await postJSON("https://control.msg91.com/api/v5/widget/sendOtpMobile", {
    widgetId: cfg.msg91WidgetID,
    tokenAuth: cfg.msg91TokenAuth,
    identifier: phone,
  });
  if (out["access-token"] || out.invisibleVerified) {
    return { reqId: "", accessToken: out["access-token"] || out.message || "" };
  }
  if (out.type !== "success") throw new Error(`msg91 widget send failed: ${formatMsg91Error(out, raw)}`);
  if (!String(out.message ?? "").trim()) throw new Error(`msg91 widget send missing reqId (body=${raw})`);
  return { reqId: out.message, accessToken: "" };
}

// Ask MSG91's widget to check the digits the customer typed.
// Returns their access token, which later proves which phone was verified.
async function widgetVerifyOTP(cfg, reqId, otp) {
  const { out, raw } = await postJSON("https://control.msg91.com/api/v5/widget/verifyOtp", {
    widgetId: cfg.msg91WidgetID,
    tokenAuth: cfg.msg91TokenAuth,
    reqId,
    otp,
  });
  if (out.type !== "success" && !out["access-token"]) {
    throw new Error(`msg91 widget verify failed: ${formatMsg91Error(out, raw)}`);
  }
  const tok = out["access-token"] || out.message || "";
  if (!tok) throw new Error(`msg91 widget verify missing access-token (body=${raw})`);
  return tok;
}

// Ask MSG91 to send the same code again, on SMS, WhatsApp, or a voice call.
// Channel 11 is SMS, 12 is WhatsApp, 4 is voice, 3 is also accepted.
// A missing channel (0) becomes SMS. Anything else is rejected.
async function widgetRetryOTP(cfg, reqId, channel) {
  let chosenChannel = channel;
  if (![11, 12, 4, 3].includes(chosenChannel)) {
    if (chosenChannel === 0) chosenChannel = 11;
    else throw new Error(`unsupported retry channel ${chosenChannel} (use 11=SMS, 12=WhatsApp, 4=Voice)`);
  }
  const { out, raw } = await postJSON("https://control.msg91.com/api/v5/widget/retryOtp", {
    widgetId: cfg.msg91WidgetID,
    tokenAuth: cfg.msg91TokenAuth,
    reqId,
    retryChannel: String(chosenChannel),
  });
  if (out.type !== "success") throw new Error(`msg91 widget retry failed: ${formatMsg91Error(out, raw)}`);
  if (!String(out.message ?? "").trim()) return reqId;
  return out.message;
}

// True when the text looks like an email, or like a phone with at least 10 digits.
function looksLikeIdentifier(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed.includes("@")) return true;
  return (trimmed.match(/\d/g) || []).length >= 10;
}

// Find the phone or email MSG91 says it verified.
// They put it in different places depending on the widget response shape.
function extractIdentifier(raw) {
  if (typeof raw?.message === "string" && looksLikeIdentifier(raw.message)) return raw.message;
  if (raw?.message && typeof raw.message === "object") {
    for (const key of ["mobile", "phone", "identifier", "email"]) {
      if (typeof raw.message[key] === "string" && raw.message[key]) return raw.message[key];
    }
  }
  if (raw?.data && typeof raw.data === "object") {
    for (const key of ["mobile", "phone", "identifier", "email"]) {
      if (typeof raw.data[key] === "string" && raw.data[key]) return raw.data[key];
    }
  }
  for (const key of ["mobile", "phone", "identifier", "email"]) {
    if (typeof raw?.[key] === "string" && raw[key]) return raw[key];
  }
  return "";
}

// Ask MSG91 which phone or email an access token belongs to.
// Called after the widget says the customer is verified, before we create an account.
async function verifyAccessToken(cfg, accessToken) {
  const form = new URLSearchParams();
  form.set("authkey", cfg.msg91AuthKey);
  form.set("access-token", accessToken);
  const resp = await fetch("https://control.msg91.com/api/v5/widget/verifyAccessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form,
    signal: AbortSignal.timeout(15000),
  });
  const body = await resp.text();
  let raw;
  try {
    raw = JSON.parse(body);
  } catch (err) {
    throw new Error(`msg91 widget verify decode: ${err.message} (body=${body})`);
  }
  const resultType = raw.type || "";
  if (resultType && resultType !== "success") {
    throw new Error(`access token verify failed: ${raw.message || body}`);
  }
  const verifiedIdentifier = extractIdentifier(raw);
  if (!verifiedIdentifier) throw new Error(`msg91 widget verify missing identifier (body=${body})`);
  return verifiedIdentifier;
}

// Send a code with MSG91's older template API. MSG91 generates the digits.
// Used when the widget ids are not configured but a template id is.
async function templateSendOTP(cfg, phone) {
  const url = new URL("https://control.msg91.com/api/v5/otp");
  url.searchParams.set("template_id", cfg.msg91TemplateID);
  url.searchParams.set("mobile", phone);
  url.searchParams.set("otp_length", "6");
  url.searchParams.set("otp_expiry", "10");
  const resp = await fetch(url, {
    method: "POST",
    headers: { authkey: cfg.msg91AuthKey, "Content-Type": "application/json", Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  const body = await resp.text();
  let out;
  try {
    out = JSON.parse(body);
  } catch (err) {
    throw new Error(`msg91 send decode: ${err.message} (body=${body})`);
  }
  if (out.type !== "success") throw new Error(`msg91 send failed: ${out.message}`);
}

// Check a code with MSG91's template API. MSG91 stored the digits, not us.
async function templateVerifyOTP(cfg, phone, otp) {
  const url = new URL("https://control.msg91.com/api/v5/otp/verify");
  url.searchParams.set("mobile", phone);
  url.searchParams.set("otp", otp);
  const resp = await fetch(url, {
    method: "GET",
    headers: { authkey: cfg.msg91AuthKey, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  const body = await resp.text();
  let out;
  try {
    out = JSON.parse(body);
  } catch (err) {
    throw new Error(`msg91 verify decode: ${err.message} (body=${body})`);
  }
  if (out.type !== "success") throw new Error(`otp verify failed: ${out.message}`);
}

// Trade Truecaller's one-time code for an access token.
// The app sends the code and the code verifier from the Truecaller login.
async function truecallerExchange(clientId, code, codeVerifier) {
  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("client_id", clientId);
  form.set("code", code);
  form.set("code_verifier", codeVerifier);
  const resp = await fetch("https://oauth-account-noneu.truecaller.com/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form,
    signal: AbortSignal.timeout(15000),
  });
  const body = await resp.text();
  let out;
  try {
    out = JSON.parse(body);
  } catch (err) {
    throw new Error(`truecaller token decode: ${err.message} (body=${body})`);
  }
  if (resp.status >= 300 || !out.access_token) {
    const msg = out.error_description || out.error || body;
    throw new Error(`truecaller token exchange failed (${resp.status}): ${msg}`);
  }
  return out.access_token;
}

// Read the customer's name and phone from Truecaller.
// A profile with no phone cannot become a Growman account.
async function truecallerUserInfo(accessToken) {
  const resp = await fetch("https://oauth-account-noneu.truecaller.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  const body = await resp.text();
  if (resp.status >= 300) throw new Error(`truecaller userinfo failed (${resp.status}): ${body}`);
  let profile;
  try {
    profile = JSON.parse(body);
  } catch (err) {
    throw new Error(`truecaller userinfo decode: ${err.message} (body=${body})`);
  }
  if (!String(profile.phone_number ?? "").trim()) throw new Error("truecaller userinfo missing phone_number");
  const parts = [];
  if (String(profile.given_name ?? "").trim()) parts.push(String(profile.given_name).trim());
  if (String(profile.family_name ?? "").trim()) parts.push(String(profile.family_name).trim());
  profile.fullName = parts.join(" ").trim();
  return profile;
}

// True when the text looks like a Google ID token (three dot-separated parts).
// An access token does not have that shape, so we verify it a different way.
function isJWT(value) {
  const parts = String(value ?? "").split(".");
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

// Sign a 24-hour login token. A signing failure is logged and returned as null
// so the route can answer the customer without throwing.
async function issueToken(secret, userId, role, ttlMs) {
  try {
    return generateToken(secret, userId, role, ttlMs);
  } catch (err) {
    console.log(`[AUTH] token: ${err.message}`);
    return null;
  }
}

// Check an email or phone plus a password, and return the customer.
// An email is anything containing @. Anything else is treated as a phone,
// and we try the common ways that phone may have been stored.
// A missing password, an unknown customer, or a bad password all fail the same way
// except a blank password, which has its own message.
export async function authenticateUser(identifier, password) {
  if (!password) {
    const err = new Error(ERR_PASSWORD_REQUIRED);
    err.status = 401;
    throw err;
  }
  let user = null;
  if (String(identifier ?? "").includes("@")) {
    user = await User.findOne({ where: { email: identifier } });
  } else {
    const variants = lookupVariants(identifier);
    if (variants.length) user = await User.findOne({ where: { phone: { [Op.in]: variants } } });
  }
  if (!user) {
    const err = new Error(ERR_INVALID_CREDENTIALS);
    err.status = 401;
    throw err;
  }
  const hash = user.passwordHash || "";
  const match = hash ? await bcrypt.compare(password, hash) : false;
  if (!match) {
    const err = new Error(ERR_INVALID_CREDENTIALS);
    err.status = 401;
    throw err;
  }
  return user;
}

// Sign the customer in with email (or phone) and password.
// POST /api/v1/auth/login. Returns a token and a short profile.
export async function login(req, res) {
  const payload = decodeBody(req, res, "invalid payload");
  if (!payload) return;

  // Wrong password or unknown customer stops here. We do not say which one.
  let user;
  try {
    user = await this.authenticateUser(payload.email, payload.password);
  } catch (err) {
    error(res, 401, err.message || ERR_INVALID_CREDENTIALS);
    return;
  }

  // Sign a token that lasts 24 hours. Stop if signing fails.
  const token = await issueToken(this.cfg.jwtSecret, user.id, user.role, TOKEN_TTL_MS);
  if (!token) {
    error(res, 500, "token issue failed");
    return;
  }
  json(res, 200, { token, user: userJSON(user) });
}

// Sign an admin in. Same password check as login, then the role must be an admin.
// POST /api/v1/auth/admin/login. The response is only the token.
export async function adminLogin(req, res) {
  const payload = decodeBody(req, res, "invalid payload");
  if (!payload) return;
  let user;
  try {
    user = await this.authenticateUser(payload.email, payload.password);
  } catch (err) {
    error(res, 401, err.message || ERR_INVALID_CREDENTIALS);
    return;
  }
  if (!isAdminRole(user.role)) {
    error(res, 403, "admin access required");
    return;
  }
  const token = await issueToken(this.cfg.jwtSecret, user.id, user.role, TOKEN_TTL_MS);
  if (!token) {
    error(res, 500, "token issue failed");
    return;
  }
  json(res, 200, { token });
}

// Read a JSON object body. Arrays and empty bodies are rejected with badMsg.
// Returns null after writing the error, so the route can return immediately.
function decodeBody(req, res, badMsg) {
  if (!req.rawBody || req.rawBody.length === 0 || req.body == null || typeof req.body !== "object" || Array.isArray(req.body)) {
    error(res, 400, badMsg);
    return null;
  }
  return req.body;
}

// Create a password account.
// POST /api/v1/auth/signup. Name, email, phone, and a password of 8 to 72 characters are required.
// The email and phone must be new. We tell the shop, then return a login token.
export async function signup(req, res) {
  const payload = decodeBody(req, res, "invalid payload");
  if (!payload) return;
  if (!payload.name) {
    error(res, 400, "name is required");
    return;
  }
  if (!payload.email || !String(payload.email).includes("@")) {
    error(res, 400, "valid email is required");
    return;
  }
  if (!payload.phone) {
    error(res, 400, "phone is required");
    return;
  }
  if (String(payload.password ?? "").length < 8) {
    error(res, 400, "password must be at least 8 characters");
    return;
  }
  // bcrypt only uses the first 72 bytes. Reject longer passwords instead of silently truncating.
  if (String(payload.password).length > 72) {
    error(res, 400, "password is too long");
    return;
  }

  // One account per email and per phone.
  const existing = await User.findOne({
    where: { [Op.or]: [{ email: payload.email }, { phone: payload.phone }] },
  });
  if (existing) {
    error(res, 409, "user with this email or phone already exists");
    return;
  }

  let passwordHash;
  try {
    passwordHash = await bcrypt.hash(payload.password, BCRYPT_COST);
  } catch {
    error(res, 500, "failed to create account");
    return;
  }

  // Email is not verified yet. The customer signed up with a password, not Google or a phone code.
  let user;
  try {
    user = await User.create({
      name: payload.name,
      email: strPtr(payload.email),
      phone: strPtr(payload.phone),
      passwordHash,
      emailVerified: false,
      provider: "local",
      role: "user",
    });
  } catch (err) {
    console.log(`[AUTH] Error creating user: ${err.message}`);
    error(res, 500, "failed to create account");
    return;
  }

  // Tell the shop. A failed notice does not undo the account.
  try {
    await this.notifyMerchantNewUser(user, "signup", captureRequest(req));
  } catch (err) {
    console.log(`[AUTH] notify new user: ${err.message}`);
  }

  const token = await issueToken(this.cfg.jwtSecret, user.id, user.role, TOKEN_TTL_MS);
  if (!token) {
    error(res, 500, "token issue failed");
    return;
  }
  json(res, 200, { token });
}

// Tell the app whether an email or phone already has an account.
// GET /api/v1/auth/check-user. At least one of email or phone is required.
// The answer includes the stored email and phone when a customer was found.
export async function checkUserExists(req, res) {
  const email = String(req.query?.email ?? "").trim();
  const phone = String(req.query?.phone ?? "").trim();
  if (!email && !phone) {
    error(res, 400, "email or phone is required");
    return;
  }

  // Both fields match either one. Phone is compared against the stored spelling variants.
  // A phone that produces no variants looks up a value that will not match, so exists stays false.
  const where = {};
  if (email && phone) {
    where[Op.or] = [{ email }, { phone: { [Op.in]: lookupVariants(phone) } }];
  } else if (email) {
    where.email = email;
  } else {
    const variants = lookupVariants(phone);
    where.phone = { [Op.in]: variants.length ? variants : ["__none__"] };
  }
  const user = await User.findOne({ where });
  json(res, 200, {
    exists: Boolean(user),
    email: emailOrEmpty(user),
    phone: phoneOrEmpty(user),
  });
}

// Text a login code to an Indian mobile number, or resend it on another channel.
// POST /api/v1/auth/otp/send. Needs Redis. Prefers the MSG91 widget, and falls
// back to the template API. A widget reply that is already verified signs the customer in.
export async function sendPhoneOTP(req, res) {
  const body = decodeBody(req, res, "bad request");
  if (!body) return;

  // Which channel to use if this is a resend. 0 means the app did not choose.
  let channel = parseRetryChannel(body.retryChannel, body.channel);

  // Only a 10-digit Indian mobile is accepted. MSG91 wants it with the country code.
  const tenDigitPhone = tenDigitIN(body.phone);
  if (!tenDigitPhone) {
    error(res, 400, "Enter a valid 10-digit mobile number");
    return;
  }
  const phone = msg91Format(tenDigitPhone);

  // Widget credentials win. Template credentials are the fallback. Neither means we cannot send.
  const useWidget = Boolean(this.cfg.msg91WidgetID && this.cfg.msg91TokenAuth);
  const useTemplate = Boolean(this.cfg.msg91AuthKey && this.cfg.msg91TemplateID);
  if (!useWidget && !useTemplate) {
    error(res, 503, "OTP service is not configured (set MSG91_WIDGET_ID + MSG91_TOKEN_AUTH)");
    return;
  }
  if (!this.redis) {
    error(res, 503, "OTP service temporarily unavailable");
    return;
  }

  // A request id means this is a resend of a code already issued. Resends skip the daily and IP caps.
  const isRetry = String(body.reqId ?? "").trim() !== "";
  let gate;
  try {
    gate = await otpThrottleAllow(this.redis, phone, exactIP(req), isRetry);
  } catch (err) {
    console.log(`[OTP] throttle error: ${err.message}`);
    error(res, 500, "Couldn't send the code. Try again.");
    return;
  }
  if (!gate.ok) {
    let waitSeconds = Math.floor(gate.retryAfterMs / 1000);
    if (waitSeconds < 1) waitSeconds = 30;
    let msg = "Too many attempts. Try again shortly.";
    if (gate.reason === "cooldown") msg = `Please wait ${waitSeconds} seconds before requesting another code.`;
    else if (gate.reason === "daycap") msg = "Daily OTP limit reached for this number. Try again tomorrow, or clear otp:daycap:* in Redis while testing.";
    else if (gate.reason === "ipcap") msg = "Too many OTP requests from this network. Try again in a bit.";
    res.set("Retry-After", String(waitSeconds));
    error(res, 429, msg);
    return;
  }

  if (useWidget) {
    // Resend the existing code. Default the channel to SMS when the app did not pick one.
    if (String(body.reqId ?? "").trim()) {
      if (!channel) channel = 11;
      try {
        const newId = await widgetRetryOTP(this.cfg, String(body.reqId).trim(), channel);
        json(res, 200, { cooldownSeconds: 30, reqId: newId, channel });
      } catch (err) {
        console.log(`[OTP] msg91 widget retry failed phone=${phone} channel=${channel}: ${err.message}`);
        error(res, 502, "Couldn't resend the code on that channel. Try SMS or another option.");
      }
      return;
    }

    // First send for this tap.
    let sent;
    try {
      sent = await widgetSendOTP(this.cfg, phone);
    } catch (err) {
      console.log(`[OTP] msg91 widget send failed phone=${phone}: ${err.message}`);
      const errMsg = err.message || "";
      let userFacing = "Couldn't send the code. Check MSG91 Mobile Integration and try again.";
      if (errMsg.toLowerCase().includes("ipblocked") || errMsg.includes("blocked this server IP")) {
        userFacing = "MSG91 blocked this server's IP. Whitelist your public IP in the MSG91 dashboard (Authkey → IP security), then retry.";
      }
      error(res, 502, userFacing);
      return;
    }

    // MSG91 already trusts this phone (no code to type). Sign the customer in now.
    if (sent.accessToken) {
      let created;
      try {
        created = await this.findOrCreateByPhone(tenDigitPhone, { net: captureRequest(req) });
      } catch {
        error(res, 500, "server error");
        return;
      }
      const user = created.user;
      // No name yet: the token can only finish the profile. A name means a normal token.
      const needsProfile = !String(user.name ?? "").trim();
      const scope = needsProfile ? ScopeOnboarding : ScopeFull;
      let token;
      try {
        token = generateTokenWithScope(this.cfg.jwtSecret, user.id, user.role, scope, TOKEN_TTL_MS);
      } catch {
        error(res, 500, "token issue failed");
        return;
      }
      json(res, 200, { token, isNewUser: needsProfile, isNewAccount: created.isNew, verified: true });
      return;
    }

    // The text was sent. The app must come back with this request id and the digits.
    json(res, 200, { cooldownSeconds: 30, reqId: sent.reqId });
    return;
  }

  // Template API: MSG91 chooses the digits. There is no request id to return.
  try {
    await templateSendOTP(this.cfg, phone);
  } catch (err) {
    console.log(`[OTP] msg91 send failed: ${err.message}`);
    error(res, 502, "Couldn't send the code. Try again.");
    return;
  }
  json(res, 200, { cooldownSeconds: 30 });
}

// Finish a widget login when the app already has MSG91's access token.
// POST /api/v1/auth/otp/widget/verify. We ask MSG91 which phone that token belongs to,
// then sign that customer in.
export async function verifyWidgetOTP(req, res) {
  const body = decodeBody(req, res, "bad request");
  if (!body) return;
  const accessToken = String(body.accessToken ?? "").trim();
  if (!accessToken) {
    error(res, 400, "accessToken is required");
    return;
  }
  if (!this.cfg.msg91AuthKey) {
    error(res, 503, "OTP service is not configured");
    return;
  }

  // MSG91 tells us the phone or email it verified. A failure means the token is not trusted.
  let verifiedID;
  try {
    verifiedID = await verifyAccessToken(this.cfg, accessToken);
  } catch (err) {
    console.log(`[OTP] widget access-token verify failed: ${err.message}`);
    error(res, 401, "That verification didn't check out. Try again.");
    return;
  }

  // Prefer the identifier MSG91 returned. Fall back to the one the app sent.
  // It must be an Indian mobile. An email-only identifier stops here.
  let identifierText = verifiedID;
  if (!identifierText) identifierText = body.identifier;
  const tenDigitPhone = tenDigitIN(identifierText);
  if (!tenDigitPhone) {
    console.log(`[OTP] widget identifier not a mobile: ${JSON.stringify(identifierText)}`);
    error(res, 400, "Verified identifier must be an Indian mobile number");
    return;
  }

  let created;
  try {
    created = await this.findOrCreateByPhone(tenDigitPhone, { net: captureRequest(req) });
  } catch (err) {
    console.log(`[OTP] findOrCreate: ${err.message}`);
    error(res, 500, "server error");
    return;
  }
  // isNewAccount is reported as false on this path. isNewUser still follows whether the customer has a name.
  await this.respondPhoneAuth(res, created.user, false);
}

// Check the digits the customer typed, then sign them in.
// POST /api/v1/auth/otp/verify. A request id uses the widget. Otherwise the template API.
export async function verifyPhoneOTP(req, res) {
  const body = decodeBody(req, res, "bad request");
  if (!body) return;
  const tenDigitPhone = tenDigitIN(body.phone);
  const otp = String(body.otp ?? "").trim();
  const reqID = String(body.reqId ?? "").trim();
  if (!tenDigitPhone || otp.length < 4) {
    error(res, 400, "bad request");
    return;
  }
  const phone = msg91Format(tenDigitPhone);

  // Widget verify when we have widget keys and the request id from the send step.
  const useWidget = Boolean(this.cfg.msg91WidgetID && this.cfg.msg91TokenAuth && reqID);
  if (useWidget) {
    try {
      await widgetVerifyOTP(this.cfg, reqID, otp);
    } catch (err) {
      console.log(`[OTP] widget verify failed phone=${phone}: ${err.message}`);
      error(res, 401, "That code didn't match.");
      return;
    }
  } else {
    if (!this.cfg.msg91AuthKey || !this.cfg.msg91TemplateID) {
      error(res, 503, "OTP service is not configured");
      return;
    }
    try {
      await templateVerifyOTP(this.cfg, phone, otp);
    } catch (err) {
      console.log(`[OTP] verify failed: ${err.message}`);
      error(res, 401, "That code didn't match.");
      return;
    }
  }

  // The code matched. Find the customer or create one, then issue a token.
  let created;
  try {
    created = await this.findOrCreateByPhone(tenDigitPhone, { net: captureRequest(req) });
  } catch (err) {
    console.log(`[OTP] findOrCreate: ${err.message}`);
    error(res, 500, "server error");
    return;
  }
  await this.respondPhoneAuth(res, created.user, created.isNew);
}

// Sign the customer in with Truecaller instead of a text code.
// POST /api/v1/auth/truecaller. We exchange the code, read the phone, then
// find or create the account the same way a phone code does.
export async function verifyTruecaller(req, res) {
  const body = decodeBody(req, res, "bad request");
  if (!body) return;
  const code = String(body.authorizationCode ?? "").trim();
  const verifier = String(body.codeVerifier ?? "").trim();
  if (!code || !verifier) {
    error(res, 400, "authorizationCode and codeVerifier are required");
    return;
  }
  if (!String(this.cfg.truecallerClientID ?? "").trim()) {
    error(res, 503, "Truecaller is not configured");
    return;
  }

  let accessToken;
  try {
    accessToken = await truecallerExchange(this.cfg.truecallerClientID.trim(), code, verifier);
  } catch (err) {
    console.log(`[Truecaller] token exchange failed: ${err.message}`);
    error(res, 401, "Truecaller verification failed. Try SMS instead.");
    return;
  }

  let profile;
  try {
    profile = await truecallerUserInfo(accessToken);
  } catch (err) {
    console.log(`[Truecaller] userinfo failed: ${err.message}`);
    error(res, 401, "Couldn't read your Truecaller profile. Try SMS instead.");
    return;
  }

  // The phone from Truecaller must be an Indian mobile we can store.
  const tenDigitPhone = tenDigitIN(profile.phone_number);
  if (!tenDigitPhone) {
    error(res, 400, "Truecaller didn't return a valid Indian mobile number");
    return;
  }

  // Copy the name and email onto a new account, or onto an existing one that is still blank.
  let created;
  try {
    created = await this.findOrCreateByPhone(tenDigitPhone, {
      name: profile.fullName,
      email: String(profile.email ?? "").trim(),
      provider: "truecaller",
      net: captureRequest(req),
    });
  } catch (err) {
    console.log(`[Truecaller] findOrCreate: ${err.message}`);
    error(res, 500, "server error");
    return;
  }
  await this.respondPhoneAuth(res, created.user, created.isNew);
}

// Send the login token after a phone or Truecaller check succeeded.
// A customer with no name gets an onboarding token that can only finish the profile.
// A customer who already has a name gets a normal token.
export async function respondPhoneAuth(res, user, isNewAccount) {
  const needsProfile = !String(user.name ?? "").trim();
  const scope = needsProfile ? ScopeOnboarding : ScopeFull;
  let token;
  try {
    token = generateTokenWithScope(this.cfg.jwtSecret, user.id, user.role, scope, TOKEN_TTL_MS);
  } catch {
    error(res, 500, "token issue failed");
    return;
  }
  const customer = userJSON(user);
  customer.role = user.role;
  json(res, 200, { token, isNewUser: needsProfile, isNewAccount, user: customer });
}

// Find the customer for this mobile number, or create one.
// Called after a phone code, a widget token, or Truecaller succeeds.
// An existing customer is marked phone-verified. Blank name and email are filled
// from the profile when we have them. A new customer notifies the shop.
export async function findOrCreateByPhone(tenDigit, profile = {}) {
  const details = { provider: "phone", ...profile };
  if (!details.provider) details.provider = "phone";
  const variants = lookupVariants(tenDigit);
  let user = variants.length ? await User.findOne({ where: { phone: { [Op.in]: variants } } }) : null;
  if (user) {
    user.phoneVerifiedAt = new Date();
    if (!user.phone) user.phone = strPtr(tenDigit);
    if (!String(user.name ?? "").trim() && String(details.name ?? "").trim()) user.name = String(details.name).trim();
    if (!user.email && String(details.email ?? "").trim() && String(details.email).includes("@")) {
      user.email = strPtr(String(details.email).trim());
    }
    await user.save();
    return { user, isNew: false };
  }
  const email = String(details.email ?? "").trim();
  user = await User.create({
    name: String(details.name ?? "").trim(),
    email: email && email.includes("@") ? email : null,
    phone: strPtr(tenDigit),
    passwordHash: null,
    phoneVerifiedAt: new Date(),
    provider: details.provider,
    role: "user",
  });
  try {
    await this.notifyMerchantNewUser(user, "phone/" + details.provider, details.net || {});
  } catch (err) {
    console.log(`[AUTH] notify phone user: ${err.message}`);
  }
  return { user, isNew: true };
}

// Save the name (and optional email) for a phone customer who signed up without one.
// POST /api/v1/auth/profile/complete. Allowed with the onboarding token.
// Replaces that token with a normal one.
export async function completePhoneProfile(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body) || !String(body.name ?? "").trim()) {
    error(res, 400, "name is required");
    return;
  }
  const user = await User.findByPk(claims.userId);
  if (!user) {
    error(res, 404, "user not found");
    return;
  }
  user.name = String(body.name).trim();

  // Email is optional. When present it must look like an email and must not belong to someone else.
  if (body.email != null) {
    const email = String(body.email).trim();
    if (email) {
      if (!email.includes("@")) {
        error(res, 400, "valid email is required");
        return;
      }
      const existing = await User.findOne({ where: { email, id: { [Op.ne]: user.id } } });
      if (existing) {
        error(res, 409, "email already in use");
        return;
      }
      user.email = email;
    }
  }
  try {
    await user.save();
  } catch (err) {
    console.log(`[OTP] complete profile: ${err.message}`);
    error(res, 500, "server error");
    return;
  }

  // The profile is finished, so the new token has full access.
  let token;
  try {
    token = generateTokenWithScope(this.cfg.jwtSecret, user.id, user.role, ScopeFull, TOKEN_TTL_MS);
  } catch {
    error(res, 500, "token issue failed");
    return;
  }
  const customer = userJSON(user);
  customer.role = user.role;
  json(res, 200, { token, user: customer });
}

// Return the signed-in customer's profile and saved address.
// GET /api/v1/auth/me. Needs a finished account (not the onboarding-only token).
export async function me(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const user = await User.findByPk(claims.userId, {
    attributes: ["id", "name", "email", "phone", "emailVerified", "role", "addressLine", "city", "state", "pincode", "country", "latitude", "longitude"],
  });
  if (!user) {
    error(res, 404, "user not found");
    return;
  }
  const resp = userJSON(user);
  resp.emailVerified = user.emailVerified;
  resp.role = user.role;
  resp.address = addressJSON(user);
  json(res, 200, resp);
}

// Check a Google token. A JWT is an ID token and is checked against our client id.
// Anything else is treated as an access token and checked with Google's userinfo endpoint.
async function verifyGoogleToken(cfg, token) {
  if (isJWT(token) && cfg.googleClientID) return verifyGoogleIDToken(cfg, token);
  return verifyGoogleAccessToken(token);
}

// Check a Google ID token and return the email, name, and whether Google verified the email.
async function verifyGoogleIDToken(cfg, idToken) {
  const client = new OAuth2Client(cfg.googleClientID);
  const ticket = await client.verifyIdToken({ idToken, audience: cfg.googleClientID });
  const claims = ticket.getPayload() || {};
  if (!claims.email) throw new Error("email not provided by google");
  return {
    id: claims.sub || "",
    email: claims.email,
    verified_email: Boolean(claims.email_verified),
    name: claims.name || "",
    picture: claims.picture || "",
  };
}

// Check a Google access token by asking Google who it belongs to.
async function verifyGoogleAccessToken(accessToken) {
  const resp = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: "Bearer " + accessToken },
    signal: AbortSignal.timeout(10000),
  });
  if (resp.status !== 200) throw new Error("google token verification failed");
  const userInfo = await resp.json();
  if (!userInfo.email) throw new Error("email not provided by google");
  return userInfo;
}

// Sign in or sign up with Google.
// POST /api/v1/auth/google. An existing email is linked to Google.
// A new email becomes an account with no password, and the shop is told.
export async function google(req, res) {
  const payload = decodeBody(req, res, "invalid payload");
  if (!payload) return;
  if (!payload.token) {
    error(res, 400, "token is required");
    return;
  }
  let googleUser;
  try {
    googleUser = await verifyGoogleToken(this.cfg, payload.token);
  } catch (err) {
    console.log(`[AUTH] Google token verification failed: ${err.message}`);
    error(res, 401, "invalid google token");
    return;
  }

  let user = await User.findOne({ where: { email: googleUser.email } });
  if (!user) {
    try {
      user = await User.create({
        name: googleUser.name || "",
        email: strPtr(googleUser.email),
        phone: null,
        passwordHash: null,
        emailVerified: Boolean(googleUser.verified_email),
        provider: "google",
        role: "user",
      });
    } catch (err) {
      console.log(`[AUTH] Error creating Google user: ${err.message}`);
      error(res, 500, "failed to create account");
      return;
    }
    try {
      await this.notifyMerchantNewUser(user, "google", captureRequest(req));
    } catch (err) {
      console.log(`[AUTH] notify google user: ${err.message}`);
    }
  } else if (user.provider !== "google") {
    // The email already belonged to a password account. Mark it as Google and refresh verification.
    user.provider = "google";
    user.emailVerified = Boolean(googleUser.verified_email);
    if (!user.name) user.name = googleUser.name || "";
    await user.save();
  }

  const token = await issueToken(this.cfg.jwtSecret, user.id, user.role, TOKEN_TTL_MS);
  if (!token) {
    error(res, 500, "token issue failed");
    return;
  }
  json(res, 200, { token });
}

// Same as Google sign-in. POST /api/v1/auth/google-signup calls this.
export async function googleSignup(req, res) {
  return this.google(req, res);
}

// Email a password-reset code if an account exists for this address.
// POST /api/v1/auth/forgot-password/send-otp.
// An unknown email gets the same success message, so we do not reveal who has an account.
export async function sendPasswordResetOTP(req, res) {
  const body = decodeBody(req, res, "invalid request body");
  if (!body) return;
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    error(res, 400, "valid email is required");
    return;
  }

  // Unknown email: answer as if we sent the code, and do not send anything.
  const user = await User.findOne({ where: { email } });
  if (!user) {
    json(res, 200, { message: "If an account exists with this email, a password reset code has been sent" });
    return;
  }
  if (!this.cfg.smtpEmail || !this.cfg.smtpPassword) {
    console.log("[PASSWORD RESET] SMTP credentials not configured");
    error(res, 503, "email_unavailable");
    return;
  }

  // One reset code per minute. The app is told how long is left.
  let gate;
  try {
    gate = await canResendPasswordReset.call(this, email);
  } catch (err) {
    console.log(`[PASSWORD RESET] Cooldown check failed: ${err.message}`);
    error(res, 503, "otp_unavailable");
    return;
  }
  if (!gate.ok) {
    json(res, 429, { error: "otp_cooldown", retry_after: Math.trunc(gate.ttlMs / 1000) });
    return;
  }

  let otp;
  try {
    otp = await generatePasswordResetOTPValue.call(this, email);
  } catch (err) {
    console.log(`[PASSWORD RESET] Error generating OTP: ${err.message}`);
    error(res, 503, "otp_unavailable");
    return;
  }
  const text = `Your password reset code is ${otp}.\n\nValid for 5 minutes.\n\nIf you didn't request this, your password stays unchanged.\n\nApp: ${PLAY_STORE_URL}`;
  const inner = `<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Password reset</h1>
<p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.5;">Use this code to choose a new password.</p>
${otpBlock(otp)}`;
  try {
    await this.sendTransactionalEmail(email, "Reset your Growman password", text, renderEmail("Reset your Growman password", inner));
  } catch (err) {
    // The customer never saw the code. Delete it so it cannot be used.
    console.log(`[PASSWORD RESET] Error sending OTP email: ${err.message}`);
    await deletePasswordResetOTPValue.call(this, email);
    error(res, 502, "email_send_failed");
    return;
  }
  await setPasswordResetCooldownValue.call(this, email);
  json(res, 200, {
    message: "If an account exists with this email, a password reset code has been sent",
    cooldown: 60,
  });
}

// Check a password-reset code without changing the password yet.
// POST /api/v1/auth/forgot-password/verify-otp. A match is remembered for the reset call.
export async function verifyPasswordResetOTP(req, res) {
  const body = decodeBody(req, res, "invalid request body");
  if (!body) return;
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    error(res, 400, "valid email is required");
    return;
  }
  if (!body.otp) {
    error(res, 400, "OTP is required");
    return;
  }
  let valid;
  try {
    valid = await verifyPasswordResetOTPValue.call(this, email, body.otp);
  } catch (err) {
    console.log(`[PASSWORD RESET] Error verifying OTP: ${err.message}`);
    error(res, 503, "otp_unavailable");
    return;
  }
  if (!valid) {
    error(res, 400, "invalid or expired OTP");
    return;
  }
  json(res, 200, { success: true, message: "OTP verified successfully" });
}

// Set a new password after the reset code checks out.
// POST /api/v1/auth/forgot-password/reset. The code is used up before the password is saved.
// The new password must match the confirmation and be at least 8 characters.
export async function resetPassword(req, res) {
  const body = decodeBody(req, res, "invalid request body");
  if (!body) return;
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    error(res, 400, "valid email is required");
    return;
  }
  if (!body.otp) {
    error(res, 400, "OTP is required");
    return;
  }
  if (!body.newPassword || String(body.newPassword).length < 8) {
    error(res, 400, "password must be at least 8 characters");
    return;
  }
  if (body.newPassword !== body.confirmPassword) {
    error(res, 400, "passwords do not match");
    return;
  }

  // Use the code once. A wrong or expired code stops before we touch the password.
  let valid;
  try {
    valid = await consumePasswordResetOTPValue.call(this, email, body.otp);
  } catch (err) {
    console.log(`[PASSWORD RESET] Error verifying OTP: ${err.message}`);
    error(res, 503, "otp_unavailable");
    return;
  }
  if (!valid) {
    error(res, 400, "invalid or expired OTP");
    return;
  }

  const user = await User.findOne({ where: { email } });
  if (!user) {
    error(res, 404, "user not found");
    return;
  }
  let passwordHash;
  try {
    passwordHash = await bcrypt.hash(body.newPassword, BCRYPT_COST);
  } catch {
    error(res, 500, "failed to reset password");
    return;
  }
  user.passwordHash = passwordHash;
  try {
    await user.save();
  } catch (err) {
    console.log(`[PASSWORD RESET] Error updating password: ${err.message}`);
    error(res, 500, "failed to reset password");
    return;
  }
  json(res, 200, { success: true, message: "Password reset successfully" });
}

// Update the signed-in customer's name, phone, or saved address.
// PUT /api/v1/auth/profile. Only fields the app sent are changed.
// A phone that another customer already uses is rejected.
export async function updateProfile(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const body = decodeBody(req, res, "invalid request body");
  if (!body) return;
  const user = await User.findByPk(claims.userId);
  if (!user) {
    error(res, 404, "user not found");
    return;
  }
  if (body.name) user.name = body.name;
  if (body.phone) {
    const existing = await User.findOne({ where: { phone: body.phone, id: { [Op.ne]: user.id } } });
    if (existing) {
      error(res, 409, "phone number already in use");
      return;
    }
    user.phone = strPtr(body.phone);
  }
  if (body.addressLine) user.addressLine = body.addressLine;
  if (body.city) user.city = body.city;
  if (body.state) user.state = body.state;
  if (body.pincode) user.pincode = body.pincode;
  if (body.country) user.country = body.country;
  if (body.latitude != null) user.latitude = body.latitude;
  if (body.longitude != null) user.longitude = body.longitude;
  try {
    await user.save();
  } catch (err) {
    console.log(`[AUTH] Error updating profile: ${err.message}`);
    error(res, 500, "failed to update profile");
    return;
  }
  const customer = userJSON(user);
  customer.address = addressJSON(user);
  json(res, 200, { success: true, message: "Profile updated successfully", user: customer });
}

// Save the signed-in customer's map pin and address lines.
// POST /api/v1/auth/save-location. Latitude and longitude are required.
// Missing address fields are stored as empty strings, which clears a previous value.
export async function saveLocation(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const body = decodeBody(req, res, "invalid request body");
  if (!body) return;
  if (!body.latitude || !body.longitude) {
    error(res, 400, "latitude and longitude are required");
    return;
  }
  const user = await User.findByPk(claims.userId);
  if (!user) {
    error(res, 404, "user not found");
    return;
  }
  user.addressLine = body.addressLine || "";
  user.city = body.city || "";
  user.state = body.state || "";
  user.pincode = body.pincode || "";
  user.country = body.country || "";
  user.latitude = body.latitude;
  user.longitude = body.longitude;
  try {
    await user.save();
  } catch (err) {
    console.log(`[AUTH] Error saving location: ${err.message}`);
    error(res, 500, "failed to save location");
    return;
  }
  json(res, 200, { success: true, message: "Location saved successfully" });
}
