// // @ts-expect-error: Will be resolved by wrangler build
// import { handleImageRequest } from "./cloudflare/images.js";
// // @ts-expect-error: Will be resolved by wrangler build
// import { runWithCloudflareRequestContext } from "./cloudflare/init.js";
// // @ts-expect-error: Will be resolved by wrangler build
// import { maybeGetSkewProtectionResponse } from "./cloudflare/skew-protection.js";
// // @ts-expect-error: Will be resolved by wrangler build
// import { handler as middlewareHandler } from "./middleware/handler.mjs";
// // @ts-expect-error: Will be resolved by wrangler build
// export { DOQueueHandler } from "./.build/durable-objects/queue.js";
// // @ts-expect-error: Will be resolved by wrangler build
// export { DOShardedTagCache } from "./.build/durable-objects/sharded-tag-cache.js";
// // @ts-expect-error: Will be resolved by wrangler build
// export { BucketCachePurge } from "./.build/durable-objects/bucket-cache-purge.js";

// interface Env {
//   WAE?: {
//     writeDataPoint: (data: {
//       blobs: string[];
//       doubles: number[];
//       indexes: string[];
//     }) => void;
//   };
//   ASSETS?: { fetch: (req: Request) => Promise<Response> };
// }

// export default {
//   async fetch(request: Request, env: Env, ctx: ExecutionContext) {
//     return runWithCloudflareRequestContext(request, env, ctx, async () => {

//       // ✅ WAE writeDataPoint — runs on every request
//       try {
//         const country    = request.headers.get('cf-ipcountry')   ?? 'XX';
//         const region     = request.headers.get('cf-region')      ?? 'Unknown';
//         const regionCode = request.headers.get('cf-region-code') ?? 'XX';
//         const city       = request.headers.get('cf-ipcity')      ?? 'Unknown';
//         const pathname   = new URL(request.url).pathname;

//         if (env.WAE) {
//           env.WAE.writeDataPoint({
//             blobs: [country, region, regionCode, city, pathname],
//             doubles: [1],
//             indexes: [country],
//           });
//           console.log('[WAE] written:', country, region, city, pathname);
//         } else {
//           console.log('[WAE] binding missing!');
//         }
//       } catch (e) {
//         console.error('[WAE] error:', e);
//       }

//       const response = maybeGetSkewProtectionResponse(request);
//       if (response) return response;

//       const url = new URL(request.url);

//       if (url.pathname.startsWith("/cdn-cgi/image/")) {
//         const m = url.pathname.match(/\/cdn-cgi\/image\/.+?\/(?<url>.+)$/);
//         if (m === null) return new Response("Not Found!", { status: 404 });
//         const imageUrl = m.groups!.url;
//         return imageUrl.match(/^https?:\/\//)
//           ? fetch(imageUrl, { cf: { cacheEverything: true } } as any)
//           : env.ASSETS?.fetch(new URL(`/${imageUrl}`, url) as any);
//       }

//       if (url.pathname === `${(globalThis as any).__NEXT_BASE_PATH__}/_next/image${(globalThis as any).__TRAILING_SLASH__ ? "/" : ""}`) {
//         return await handleImageRequest(url, request.headers, env);
//       }

//       const reqOrResp = await middlewareHandler(request, env, ctx);
//       if (reqOrResp instanceof Response) return reqOrResp;

//       // @ts-expect-error: resolved by wrangler build
//       const { handler } = await import("./server-functions/default/handler.mjs");
//       return handler(reqOrResp, env, ctx, request.signal);
//     });
//   },
// };