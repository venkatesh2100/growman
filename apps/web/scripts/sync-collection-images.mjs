#!/usr/bin/env node
/**
 * Snapshots the category / plant-type tile photos into `public/collections`.
 *
 * The tiles on the homepage and `/categories` stand in for a whole collection,
 * so they reuse a photo of a product inside it. Those photos live in object
 * storage, which means every visitor pays a cross-origin fetch for an image
 * that changes at most when the catalog is re-merchandised. This script picks
 * the same candidate the site would have picked, downloads it once, shrinks it
 * to tile size, and records the local path in `lib/seo/collectionImages.ts`.
 *
 * Run it whenever collections change:
 *   pnpm --filter web sync:collection-images        # keeps existing files
 *   pnpm --filter web sync:collection-images --force # re-downloads everything
 *
 * The candidate ordering here intentionally mirrors `lib/seo/catalog.ts`. It is
 * duplicated rather than imported because that module pulls in the browser
 * auth store through `lib/api`, which cannot load in a plain Node script.
 */

import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = path.join(APP_DIR, "public", "collections");
const PUBLIC_PREFIX = "/collections";
const MANIFEST_FILE = path.join(APP_DIR, "lib", "seo", "collectionImages.ts");

/** Tiles render at 144px at most, so 288px covers 2x displays. */
const TILE_SIZE = 288;
const WEBP_QUALITY = 72;
const PRODUCT_PAGE_SIZE = 100;
const MAX_PRODUCT_PAGES = 200;
const FETCH_TIMEOUT_MS = 20_000;
/** Give up on a collection after this many dead candidate URLs. */
const MAX_CANDIDATES = 6;

const force = process.argv.includes("--force");

function loadEnv() {
  // `process.loadEnvFile` exists from Node 20.12; without it the API base has
  // to come from the shell, which is fine in CI.
  for (const file of [".env.local", ".env"]) {
    const full = path.join(APP_DIR, file);
    if (existsSync(full)) {
      try {
        process.loadEnvFile?.(full);
      } catch {
        // A malformed env file should not stop an explicit API_URL from working.
      }
    }
  }
}

function apiBase() {
  const base =
    process.env.GO_API_URL ||
    process.env.NEXT_PUBLIC_GO_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8080/api/v1";
  return base.replace(/\/+$/, "");
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function fetchCategories(base) {
  const payload = await getJson(`${base}/categories`);
  if (!Array.isArray(payload)) return [];

  const bySlug = new Map();
  for (const category of payload) {
    if (category?.slug && !bySlug.has(category.slug)) {
      bySlug.set(category.slug, category);
    }
  }
  return [...bySlug.values()];
}

async function fetchAllProducts(base) {
  const products = [];
  for (let page = 1; page <= MAX_PRODUCT_PAGES; page += 1) {
    const payload = await getJson(
      `${base}/products?page=${page}&pageSize=${PRODUCT_PAGE_SIZE}`
    );
    const batch = Array.isArray(payload) ? payload : (payload?.data ?? []);
    if (batch.length === 0) break;
    products.push(...batch);
    if (Array.isArray(payload) || !payload?.pagination?.hasNext) break;
  }
  return products;
}

/** Size images first: they are what the shop cards show and are less often stale. */
function productImageUrls(product) {
  const fromSizes = (product.sizes ?? []).flatMap(
    (size) => size.images?.filter(Boolean) ?? []
  );
  const all = [...fromSizes, product.imageUrl].filter(
    (url) => typeof url === "string" && url.length > 0
  );
  return [...new Set(all)];
}

/** Featured products win, so merchandising choices still decide the tile. */
function candidateUrls(products) {
  const withImages = products.filter((p) => productImageUrls(p).length > 0);
  const ordered = [
    ...withImages.filter((p) => p.featured),
    ...withImages.filter((p) => !p.featured),
  ];

  const urls = [];
  for (const product of ordered) {
    for (const url of productImageUrls(product)) {
      if (!urls.includes(url)) urls.push(url);
    }
    if (urls.length >= MAX_CANDIDATES) break;
  }
  return urls.slice(0, MAX_CANDIDATES);
}

function groupProducts(products) {
  const byCategory = new Map();
  const bySubcategory = new Map();
  const push = (map, key, item) => {
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  };

  for (const product of products) {
    push(byCategory, product.categoryId, product);
    if (product.subcategoryId) push(bySubcategory, product.subcategoryId, product);
  }
  return { byCategory, bySubcategory };
}

/**
 * Every tile that needs a local photo, as `{ key, file, urls }`.
 *
 * `key` matches the lookup keys used by `lib/seo/catalog.ts`: the category slug
 * on its own, or `categorySlug/subcategorySlug` for a plant type.
 */
function planTiles(categories, products) {
  const { byCategory, bySubcategory } = groupProducts(products);
  const tiles = [];

  for (const category of categories) {
    const own = byCategory.get(category.id) ?? [];
    if (own.length === 0) continue;

    tiles.push({
      key: category.slug,
      file: `${category.slug}.webp`,
      urls: candidateUrls(own),
    });

    for (const subcategory of category.subcategories ?? []) {
      const items = bySubcategory.get(subcategory.id) ?? [];
      if (items.length === 0) continue;
      tiles.push({
        key: `${category.slug}/${subcategory.slug}`,
        file: `${category.slug}--${subcategory.slug}.webp`,
        urls: candidateUrls(items),
      });
    }
  }

  return tiles.filter((tile) => tile.urls.length > 0);
}

async function loadSharp() {
  try {
    return (await import("sharp")).default;
  } catch {
    console.warn(
      "[collections] sharp is unavailable — storing originals without resizing."
    );
    return null;
  }
}

/** Downloads the first candidate that actually returns an image. */
async function downloadFirstWorking(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      if (!(res.headers.get("content-type") ?? "").startsWith("image/")) continue;
      return { url, body: Buffer.from(await res.arrayBuffer()) };
    } catch {
      // Dead key or timeout: fall through to the next product photo.
    }
  }
  return null;
}

async function writeManifest(entries) {
  const lines = entries
    .map(([key, src]) => `  ${JSON.stringify(key)}: ${JSON.stringify(src)},`)
    .join("\n");

  const contents = `/**
 * Generated by \`pnpm --filter web sync:collection-images\` — do not edit.
 *
 * Maps a collection to the tile photo committed under \`public/collections\`,
 * keyed by category slug, or \`categorySlug/subcategorySlug\` for a plant type.
 * Collections missing here simply fall back to their object-storage URLs.
 */
export const COLLECTION_TILE_IMAGES: Record<string, string> = {
${lines}
};
`;

  await writeFile(MANIFEST_FILE, contents, "utf8");
}

/** Drops images for collections that no longer exist. */
async function pruneStale(keepFiles) {
  const existing = await readdir(OUTPUT_DIR);
  for (const file of existing) {
    if (file.endsWith(".webp") && !keepFiles.has(file)) {
      await rm(path.join(OUTPUT_DIR, file));
      console.log(`[collections] removed stale ${file}`);
    }
  }
}

async function main() {
  loadEnv();
  const base = apiBase();
  console.log(`[collections] reading catalog from ${base}`);

  const [categories, products] = await Promise.all([
    fetchCategories(base),
    fetchAllProducts(base),
  ]);
  const tiles = planTiles(categories, products);
  if (tiles.length === 0) {
    throw new Error("no collections with images were returned by the API");
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const sharp = await loadSharp();

  const entries = [];
  let downloaded = 0;
  let reused = 0;

  for (const tile of tiles) {
    const target = path.join(OUTPUT_DIR, tile.file);

    if (!force && existsSync(target)) {
      entries.push([tile.key, `${PUBLIC_PREFIX}/${tile.file}`]);
      reused += 1;
      continue;
    }

    const found = await downloadFirstWorking(tile.urls);
    if (!found) {
      console.warn(`[collections] no reachable photo for ${tile.key}`);
      continue;
    }

    const body = sharp
      ? await sharp(found.body)
          .resize(TILE_SIZE, TILE_SIZE, { fit: "cover", position: "centre" })
          .webp({ quality: WEBP_QUALITY })
          .toBuffer()
      : found.body;

    await writeFile(target, body);
    entries.push([tile.key, `${PUBLIC_PREFIX}/${tile.file}`]);
    downloaded += 1;
    console.log(
      `[collections] ${tile.key} → ${tile.file} (${Math.round(body.length / 1024)} kB)`
    );
  }

  entries.sort(([a], [b]) => a.localeCompare(b));
  await writeManifest(entries);
  await pruneStale(new Set(entries.map(([, src]) => path.basename(src))));

  console.log(
    `[collections] ${entries.length} tiles ready (${downloaded} downloaded, ${reused} reused)`
  );
}

main().catch((error) => {
  console.error("[collections] failed:", error.message ?? error);
  process.exitCode = 1;
});
