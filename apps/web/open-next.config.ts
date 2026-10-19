import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import kvIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache";
import { withRegionalCache } from "@opennextjs/cloudflare/overrides/incremental-cache/regional-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";

// Without an incremental cache every prerendered/ISR route (including
// robots.txt and sitemap.xml) is re-rendered on each request. KV stores the
// rendered output (R2 is not enabled on this Cloudflare account), the
// regional Cache API layer in front of it avoids a KV read on hot paths, and
// the Durable Object queue runs the time-based revalidations declared by
// `export const revalidate`.
export default defineCloudflareConfig({
  incrementalCache: withRegionalCache(kvIncrementalCache, {
    mode: "long-lived",
  }),
  queue: doQueue,
  enableCacheInterception: true,
});
