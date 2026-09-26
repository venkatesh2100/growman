// Custom Worker entry (see wrangler.jsonc "main"). It delegates everything to
// the OpenNext-generated worker, but caches optimized images at the edge:
// OpenNext's /_next/image handler re-downloads the original from storage and
// re-runs the Cloudflare Images transform on every request otherwise.

// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- generated file may not exist yet
// @ts-ignore `.open-next/worker.js` is generated at build time
import { default as handler } from "./.open-next/worker.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- generated file may not exist yet
// @ts-ignore `.open-next/worker.js` is generated at build time
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

type WorkerContext = { waitUntil(promise: Promise<unknown>): void };
type OpenNextHandler = {
  fetch(request: Request, env: unknown, ctx: WorkerContext): Promise<Response>;
};

const openNext = handler as OpenNextHandler;
const edgeCache = (caches as unknown as { default: Cache }).default;

const IMAGE_PATH = "/_next/image";
// Storage keys are unique per upload, so remote images never change in place.
const REMOTE_IMAGE_CACHE = "public, max-age=31536000, immutable";
// Files in /public can be replaced under the same name.
const LOCAL_IMAGE_CACHE = "public, max-age=604800, stale-while-revalidate=86400";

function negotiatedFormat(accept: string): string {
  if (accept.includes("image/avif")) return "avif";
  if (accept.includes("image/webp")) return "webp";
  return "original";
}

async function cachedImage(request: Request, env: unknown, ctx: WorkerContext): Promise<Response> {
  const url = new URL(request.url);
  const source = url.searchParams.get("url") ?? "";
  const key = new URL(IMAGE_PATH, url.origin);
  key.searchParams.set("url", source);
  key.searchParams.set("w", url.searchParams.get("w") ?? "");
  key.searchParams.set("q", url.searchParams.get("q") ?? "");
  key.searchParams.set("f", negotiatedFormat(request.headers.get("Accept") ?? ""));
  const cacheKey = new Request(key.toString(), { method: "GET" });

  const hit = await edgeCache.match(cacheKey);
  if (hit) return hit;

  const response = await openNext.fetch(request, env, ctx);
  if (response.status !== 200) return response;

  const headers = new Headers(response.headers);
  if (!headers.get("Cache-Control")?.includes("immutable")) {
    headers.set("Cache-Control", source.startsWith("/") ? LOCAL_IMAGE_CACHE : REMOTE_IMAGE_CACHE);
  }
  // The key already encodes the negotiated format; Vary would only split it.
  headers.delete("Vary");
  const cacheable = new Response(response.body, { status: 200, headers });
  ctx.waitUntil(edgeCache.put(cacheKey, cacheable.clone()));

  const toClient = new Headers(cacheable.headers);
  toClient.set("Vary", "Accept");
  return new Response(cacheable.body, { status: 200, headers: toClient });
}

export default {
  async fetch(request: Request, env: unknown, ctx: WorkerContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === IMAGE_PATH) {
      return cachedImage(request, env, ctx);
    }
    return openNext.fetch(request, env, ctx);
  },
};
