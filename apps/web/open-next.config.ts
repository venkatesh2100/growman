import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import { withRegionalCache } from "@opennextjs/cloudflare/overrides/incremental-cache/regional-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";

// Without an incremental cache every prerendered/ISR route (including
// robots.txt and sitemap.xml) is re-rendered on each request. R2 stores the
// rendered output, the regional Cache API layer in front of it avoids an R2
// read on hot paths, and the Durable Object queue runs the time-based
// revalidations declared by `export const revalidate`.
export default defineCloudflareConfig({
  incrementalCache: withRegionalCache(r2IncrementalCache, {
    mode: "long-lived",
  }),
  queue: doQueue,
  enableCacheInterception: true,
});
