// One-shot command that creates or updates the shop tables, then exits.
// Run it with the migrate entry, not with the API server.
// Prints success, or exits 1 if config, the database, or the migration throws.

import { load } from "../../internal/config/config.js";
import { connect } from "../../internal/db/postgres.js";
import { createHandler } from "../../internal/handlers/handler.js";

// Loads settings, connects to Postgres, runs the schema sync, and closes the pool.
async function main() {
  console.log("Running database migrations...");
  const cfg = load();
  const db = await connect(cfg);
  // Image storage is optional here. Migrations must still run if the bucket is down.
  let imageService = null;
  if (cfg.imageBaseURL) {
    try {
      const mod = await import("../../internal/services/storage/factory.js");
      imageService = await mod.newImageServiceFromConfig(cfg);
    } catch (err) {
      console.log(`[IMAGE] Warning: Image service initialization failed: ${err.message}. Continuing with migrations.`);
    }
  }
  // Redis is not needed to change the schema, so the handler is built without it.
  const h = await createHandler(db, cfg, null, imageService);
  await h.autoMigrate();
  console.log("Migrations completed successfully!");
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
