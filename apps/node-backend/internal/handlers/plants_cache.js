// This file remembers plant-scan answers so a repeat photo does not spend
// another identification credit. It keeps a small copy in this process and
// a longer copy in the shared cache. Staff and customers both benefit when
// Redis is down, because the in-memory copy still avoids a second paid scan.
// The shared catalog cache expires its memory tier after two minutes; without
// this, a repeat photo would spend another identify credit whenever Redis is down.

import { createClient } from "../plantnet/client.js";

// How many scan answers this process will keep before it drops the oldest one.
const plantMemMax = 256;
const plantMem = {
  items: new Map(),
  remaining: 0,
  remainingOK: false,
  remainingDay: "",
  flight: new Map(),
};

// The UTC calendar day, used so yesterday's leftover scan quota is not reused today.
function utcDay(now) {
  return now.toISOString().slice(0, 10);
}

// Copies bytes so a later change to the original buffer cannot change the cached copy.
function copyBytes(raw) {
  if (raw == null) return Buffer.alloc(0);
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  return Buffer.from(buf);
}

// Reads one cached answer from this process, or drops it if it has expired.
function plantMemGet(key, now) {
  const item = plantMem.items.get(key);
  if (!item || now.getTime() > item.exp) {
    if (item) plantMem.items.delete(key);
    return null;
  }
  return copyBytes(item.raw);
}

// Stores one answer in this process. Drops expired rows, then the oldest row, when full.
function plantMemSet(key, raw, ttlMs, now) {
  if (!raw || (Buffer.isBuffer(raw) && raw.length === 0) || !(ttlMs > 0)) return;
  if (plantMem.items.size >= plantMemMax) {
    for (const [k, v] of plantMem.items) {
      if (now.getTime() > v.exp) plantMem.items.delete(k);
    }
  }
  if (plantMem.items.size >= plantMemMax) {
    const first = plantMem.items.keys().next().value;
    if (first !== undefined) plantMem.items.delete(first);
  }
  plantMem.items.set(key, { raw: copyBytes(raw), exp: now.getTime() + ttlMs });
}

// Runs one scan for a photo key, and makes other requests for that same photo wait for it.
// Two customers scanning the same picture at once then share one identification credit.
export async function plantFlight(key, fn) {
  const existing = plantMem.flight.get(key);
  if (existing) return existing;
  const job = Promise.resolve()
    .then(fn)
    .finally(() => plantMem.flight.delete(key));
  plantMem.flight.set(key, job);
  return job;
}

// Loads a cached plant answer from memory first, then from the shared cache.
export async function plantLoad(key, now = new Date()) {
  const mem = plantMemGet(key, now);
  if (mem) return mem;
  if (!this.cache) return null;
  const raw = await this.cache.getRaw(key);
  if (raw == null) return null;
  // Keep a ten-minute copy in this process so the next lookup skips the shared cache.
  const buf = copyBytes(raw);
  plantMemSet(key, buf, 10 * 60 * 1000, now);
  return buf;
}

// Saves a plant answer in this process and in the shared cache.
export async function plantSet(key, raw, ttlMs, now = new Date()) {
  plantMemSet(key, raw, ttlMs, now);
  if (this.cache) await this.cache.setRaw(key, copyBytes(raw), ttlMs);
}

// How long until the next UTC midnight, which is when the daily scan quota resets.
// Never shorter than one minute, so a clock tick at midnight does not cache for zero time.
function untilUtcMidnightMs(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const ms = next - now.getTime();
  return ms < 60_000 ? 60_000 : ms;
}

// Remembers how many plant identifications are left today, until UTC midnight.
export async function noteIdentifyRemaining(n, now = new Date()) {
  plantMem.remaining = n;
  plantMem.remainingOK = true;
  plantMem.remainingDay = utcDay(now);
  if (this.cache) await this.cache.set("plantnet:identify-remaining", n, untilUtcMidnightMs(now));
}

// Reads how many plant identifications are left today. Null means we do not know yet.
export async function identifyRemaining(now = new Date()) {
  // Use the number saved in this process when it is still for today's UTC day.
  if (plantMem.remainingOK && plantMem.remainingDay === utcDay(now)) {
    return plantMem.remaining;
  }
  if (!this.cache) return null;
  const n = await this.cache.get("plantnet:identify-remaining");
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  plantMem.remaining = n;
  plantMem.remainingOK = true;
  plantMem.remainingDay = utcDay(now);
  return n;
}

// Builds the plant-identification client from the configured key and optional base address.
export function plantClient() {
  const client = createClient(this.cfg.plantNetAPIKey);
  const base = String(this.cfg.plantNetBaseURL || "").trim();
  if (base && client) client.baseURL = base;
  return client;
}
