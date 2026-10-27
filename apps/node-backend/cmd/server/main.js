// This file starts the shop API.
//
// It does the same jobs as the Go server, in this order:
//   1. Read settings from the environment (.env).
//   2. Connect to Postgres. The API cannot run without it.
//   3. Connect to Redis if REDIS_URL is set. Redis is optional.
//      Without it, cache and rate limits stay inside this one process.
//   4. Connect to image storage if IMAGE_BASE_URL is set.
//      If that fails, the API still starts, but uploads are turned off.
//   5. Build the handler object that every route uses.
//   6. Update the database tables when AUTO_MIGRATE=true (the default).
//   7. Insert sample rows when SEED_ON_STARTUP=true (off by default).
//   8. Start background jobs: return unpaid stock, book shipments,
//      and delete old personal data.
//   9. Listen for HTTP requests until the process is asked to stop.

import { createServer } from "node:http";
import { load } from "../../internal/config/config.js";
import { connect } from "../../internal/db/postgres.js";
import { connectRedis } from "../../internal/db/redis.js";
import { createHandler } from "../../internal/handlers/handler.js";
import { newRouter } from "../../internal/server/router.js";

// GO_PORT may be "8080" or ":8080". Node's listen() wants the number.
function listenAddress(port) {
  if (!port) return ":8080";
  if (port.startsWith(":") || port.startsWith("/")) return port;
  return `:${port}`;
}

// Image uploads are optional. A missing bucket must not stop the shop.
async function maybeImageService(settings) {
  if (!settings.imageBaseURL) return null;
  try {
    const storageModule = await import("../../internal/services/storage/factory.js");
    return await storageModule.newImageServiceFromConfig(settings);
  } catch (err) {
    if (err.code === "ERR_MODULE_NOT_FOUND") {
      console.log("[IMAGE] init failed: storage module missing (uploads disabled)");
      return null;
    }
    console.log(`[IMAGE] init failed: ${err.message} (uploads disabled)`);
    return null;
  }
}

async function main() {
  // settings holds every env var the API reads (database, Razorpay, email, ...).
  const settings = load();
  const database = await connect(settings);
  // redisClient is null when Redis is not configured or cannot be reached.
  const redisClient = await connectRedis(settings);
  const imageService = await maybeImageService(settings);
  // handler is the one object passed to every route. It holds the database,
  // the settings, the cache, and the courier client.
  const handler = await createHandler(database, settings, redisClient, imageService);

  // Create any missing tables and search indexes. Safe to run on every boot.
  if (settings.autoMigrate) await handler.autoMigrate();
  if (settings.seedOnStartup) {
    try {
      const seed = await import("../../seed/seed.js");
      await seed.ensureSampleData();
    } catch (err) {
      if (err.code !== "ERR_MODULE_NOT_FOUND") throw err;
    }
  }

  // One stop signal is shared by every background job.
  // When the process shuts down, the jobs stop before the database closes.
  const stopSignal = new AbortController();
  if (typeof handler.startInventorySweeper === "function") {
    // Every 5 minutes: put stock back for orders that were never paid.
    handler.startInventorySweeper(stopSignal.signal, 5 * 60 * 1000);
  }
  if (typeof handler.startShipmentWorker === "function") {
    // Every 15 minutes: book courier pickup and refresh tracking.
    handler.startShipmentWorker(stopSignal.signal, 15 * 60 * 1000);
  }
  if (typeof handler.startRetentionSweeper === "function") {
    // Once a day: delete personal data that has passed its keep-until date.
    handler.startRetentionSweeper(stopSignal.signal);
  }

  const app = newRouter(handler, settings);
  const address = listenAddress(settings.port);
  const portNumber = address.startsWith(":") ? Number(address.slice(1)) : 8080;

  // Time limits match the Go server so a slow client cannot hold a connection open.
  const server = createServer({
    headersTimeout: 5000, // 5 seconds to send the headers
    requestTimeout: 30_000, // 30 seconds to send the body
    keepAliveTimeout: 90_000,
    maxHeaderSize: 1 << 16, // 64 KB
  }, app);

  // Ctrl+C or a container stop. Jobs stop first, then the HTTP server.
  const shutdown = () => {
    console.log("shutting down");
    stopSignal.abort();
    server.close(() => {
      redisClient?.quit().catch(() => {});
      database.close().catch(() => {});
    });
    // Do not wait forever if a connection refuses to close.
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise((resolve, reject) => {
    server.listen(portNumber, () => {
      console.log(`listening on ${address}`);
      resolve();
    });
    server.on("error", reject);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
