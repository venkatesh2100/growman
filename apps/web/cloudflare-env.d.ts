/**
 * Worker bindings available to `getCloudflareContext().env`.
 *
 * Hand-written rather than generated. `wrangler types` emits the full
 * workerd runtime surface (~13k lines) and types two bindings as
 * `typeof import("./worker")` — the OpenNext build output. That would make
 * `tsc` depend on having built the worker first, and type-check generated
 * JavaScript that we neither write nor review. The `cf-typegen` script is
 * still there if you want the complete types locally.
 *
 * Keep this in sync with the bindings in wrangler.jsonc. A binding that is
 * declared here but missing from wrangler.jsonc is `undefined` at runtime,
 * which is why middleware.ts guards every use.
 */
interface CloudflareEnv {
  /** KV counter behind the edge bot/abuse rate limit in middleware.ts. */
  RATE_LIMIT?: KVNamespace;
  /** Workers Analytics Engine dataset for page-view beacons. */
  WAE?: AnalyticsEngineDataset;
  /** OpenNext incremental cache. */
  NEXT_INC_CACHE_KV?: KVNamespace;
  /** Cloudflare Images, which backs next/image through OpenNext. */
  IMAGES?: ImagesBinding;
}

/**
 * Minimal structural stand-ins for the bindings used above. These mirror
 * only the methods the app calls; install @cloudflare/workers-types and run
 * `pnpm cf-typegen` if you need the full runtime API.
 */
interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number; expiration?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

interface AnalyticsEngineDataset {
  writeDataPoint(event: {
    blobs?: string[];
    doubles?: number[];
    indexes?: string[];
  }): void;
}

interface ImagesBinding {
  input(stream: ReadableStream): unknown;
}
