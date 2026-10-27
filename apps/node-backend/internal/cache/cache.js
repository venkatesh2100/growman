// Catalog cache. Product lists, categories, brands, and tags are stored here so Postgres is not hit on every browse.
// Handlers call get, set, getOrLoadRaw, and delete. servePublic and servePrivate write the HTTP response.
// Redis is shared across processes. A short in-memory copy avoids a Redis round trip on a hot key.
// A Redis miss or error is treated as "not cached". The shop still answers from the database.

import { createHash } from "node:crypto";

// How long a value stays in Redis when the caller does not pass a lifetime. Ten minutes.
export const DefaultTTL = 10 * 60 * 1000;
export const FeaturedProductsTTL = 10 * 60 * 1000;
export const ProductDetailTTL = 30 * 60 * 1000;
export const RelatedProductsTTL = 10 * 60 * 1000;
export const AllCategoriesTTL = 10 * 60 * 1000;
export const CategoryDetailTTL = 15 * 60 * 1000;
export const CatalogTTL = 10 * 60 * 1000;
export const BrandsTTL = 15 * 60 * 1000;
export const TagsTTL = 10 * 60 * 1000;

// The in-process copy expires sooner than Redis so a stock edit shows up within two minutes on this process.
const localTTL = 2 * 60 * 1000;
// Cap the in-process map so a long catalog crawl cannot grow memory without bound.
const localMaxKeys = 4096;
// Kept beside the cache so the Redis wait budget stays visible. This file does not apply them as a separate timer.
const redisGetWait = 120;
const redisSetWait = 200;

export const KeyPrefixFeaturedProducts = "products:featured";
export const KeyPrefixProductDetail = "products:detail:";
export const KeyPrefixRelatedProducts = "products:related:";
export const KeyPrefixProductList = "products:list:";
export const KeyPrefixProductSearch = "products:search:";
export const KeyPrefixCatProducts = "products:cat:";
export const KeyPrefixSubcatProducts = "products:subcat:";
export const KeyPrefixAllCategories = "categories:all";
export const KeyPrefixCategoryDetail = "categories:detail:";
export const KeyPrefixSubcategories = "categories:subs:";
export const KeyPrefixBrands = "brands:all";
export const KeyPrefixTags = "tags:all";
export const KeyPrefixCatalog = "catalog:nav";

// Handlers construct one of these with the shared Redis client. A null client means memory only.
export class CacheHelper {
  constructor(redis) {
    this.redis = redis || null;
    this.local = new Map();
    // One in-flight load per key, so a stampede of product pages does not all query Postgres.
    this.inflight = new Map();
  }

  // Catalog handlers call this. Returns the parsed JSON value, or null on a miss or a corrupt entry.
  async get(key) {
    const raw = await this.getRaw(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      // A truncated value must not be served. Drop it so the next request rebuilds it.
      await this.delete(key);
      return null;
    }
  }

  // Stores a JSON value. ttl is milliseconds. Callers pass the TTL constants above.
  async set(key, value, ttl) {
    const data = JSON.stringify(value);
    await this.setRaw(key, data, ttl);
  }

  // Returns the cached bytes, memory first, then Redis. Null means miss. A Redis error is also a miss.
  async getRaw(key) {
    const local = this.getLocal(key);
    if (local != null) return local;
    if (!this.redis) return null;
    try {
      const cached = await this.redis.get(key);
      if (cached == null) return null;
      const buf = Buffer.isBuffer(cached) ? cached : Buffer.from(cached);
      // Fill the local copy so the next request on this process skips Redis.
      this.setLocal(key, buf, localTTL);
      return buf;
    } catch {
      return null;
    }
  }

  // Writes bytes to memory and, when Redis is up, to Redis. An empty payload is ignored.
  // The Redis write is not awaited: a slow cache must not delay the response the shopper is waiting on.
  async setRaw(key, data, ttl) {
    if (!data || (Buffer.isBuffer(data) && data.length === 0)) return;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    // The local copy never outlives the caller's TTL, and never lasts longer than localTTL.
    const lttl = ttl > 0 && ttl < localTTL ? ttl : localTTL;
    this.setLocal(key, buf, lttl);
    if (!this.redis) return;
    const seconds = Math.max(1, Math.ceil((ttl || DefaultTTL) / 1000));
    this.redis.set(key, buf, "EX", seconds).catch(() => {});
  }

  // Returns cached bytes, or runs load() once and stores the result.
  // Concurrent callers for the same key share that one load. ttl is the Redis lifetime in milliseconds.
  async getOrLoadRaw(key, ttl, load) {
    const hit = await this.getRaw(key);
    if (hit != null) return hit;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const job = (async () => {
      // Another request may have filled the cache while we waited to become the loader.
      const again = await this.getRaw(key);
      if (again != null) return again;
      const raw = await load();
      await this.setRaw(key, raw, ttl);
      return Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  // Drops exact keys from memory and Redis. Handlers call this after a product or stock edit.
  async delete(...keys) {
    for (const k of keys) this.local.delete(k);
    if (this.redis && keys.length) {
      await this.redis.unlink(...keys).catch(() => {});
    }
  }

  // Drops every key matching a Redis glob, such as "products:list:*" after a catalog edit.
  // Memory is cleared first. Redis is scanned in pages so a large keyspace is not loaded at once.
  async deletePattern(pattern) {
    this.deleteLocalPattern(pattern);
    if (!this.redis) return;
    let cursor = "0";
    do {
      const [next, keys] = await this.redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
      cursor = next;
      if (keys.length) await this.redis.unlink(...keys);
    } while (cursor !== "0");
  }

  // In-process read. An expired entry is deleted and reported as a miss.
  getLocal(key) {
    const item = this.local.get(key);
    if (!item) return null;
    if (Date.now() > item.exp) {
      this.local.delete(key);
      return null;
    }
    return item.data;
  }

  // In-process write. When the map is full, expired keys go first, then the oldest eighth of the map.
  setLocal(key, data, ttl) {
    if (this.local.size >= localMaxKeys) {
      const now = Date.now();
      for (const [k, v] of this.local) if (now > v.exp) this.local.delete(k);
      if (this.local.size >= localMaxKeys) {
        let n = 0;
        const limit = Math.floor(localMaxKeys / 8);
        for (const k of this.local.keys()) {
          this.local.delete(k);
          if (++n >= limit) break;
        }
      }
    }
    this.local.set(key, { data, exp: Date.now() + (ttl > 0 ? ttl : localTTL) });
  }

  // A pattern without a star is one key. A trailing star deletes every local key with that prefix.
  deleteLocalPattern(pattern) {
    if (!pattern.endsWith("*")) {
      this.local.delete(pattern);
      return;
    }
    const prefix = pattern.slice(0, -1);
    for (const k of this.local.keys()) if (k.startsWith(prefix)) this.local.delete(k);
  }
}

// Public catalog JSON. Handlers call this with the cached bytes.
// Sends 304 when the browser already has this body, otherwise 200 with a two-minute public cache.
export function servePublic(req, res, raw) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  const etag = etagOf(buf);
  res.set("Content-Type", "application/json; charset=utf-8");
  res.set("Cache-Control", "public, max-age=120, stale-while-revalidate=300");
  res.set("ETag", etag);
  res.set("Vary", "Accept-Encoding");
  if (noneMatch(req.get("If-None-Match"), etag)) {
    res.status(304).end();
    return;
  }
  res.status(200).set("Content-Length", String(buf.length)).send(buf);
}

// Account and cart JSON. Must not be stored by a shared cache. Sends 200 and returns nothing.
export function servePrivate(res, raw) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  res.set("Content-Type", "application/json; charset=utf-8");
  res.set("Cache-Control", "private, no-store");
  res.status(200).set("Content-Length", String(buf.length)).send(buf);
}

// Short fingerprint of the body, used as the ETag. Same bytes always produce the same tag.
function etagOf(buf) {
  let h = 0xcbf29ce484222325n;
  for (const b of buf) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `"${h.toString(16)}"`;
}

// True when the browser's If-None-Match header lists this exact tag. Weak or extra tags do not match.
function noneMatch(header, etag) {
  if (!header) return false;
  return header.split(",").some((part) => part.trim() === etag);
}

// Stable 16-hex-character key for a search string. Case and surrounding spaces do not change the key.
export function hashKey(s) {
  return createHash("sha1").update(String(s ?? "").trim().toLowerCase()).digest("hex").slice(0, 16);
}

void redisGetWait;
void redisSetWait;
