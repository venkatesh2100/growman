// Opens Postgres through Prisma and warms a few connections.
// The API server and the migrate command both call connect once at startup.
// Returns the database handle stored on the handler as `sequelize`
// (the name the route files already use). The handle talks to Prisma.

import { initPrisma } from "./client.js";
import { createDatabase } from "./records.js";

// Called at process start. Throws if neither database URL is set or if Postgres rejects the login.
export async function connect(cfg) {
  const connectionString = cfg.databaseURL || cfg.hyperdriveURL;
  const using = cfg.databaseURL ? "DATABASE_URL" : "HYPERDRIVE_URL";
  if (!connectionString) throw new Error("DATABASE_URL or HYPERDRIVE_URL is required");
  if (cfg.appEnv === "development") console.log(`[DB] connecting via ${using}`);

  const logSql = process.env.LOG_SQL === "1" || process.env.LOG_SQL === "true";
  const prisma = initPrisma(connectionString, { logSql });
  await prisma.$queryRawUnsafe("SELECT 1");
  const warm = 4;
  for (let i = 1; i < warm; i++) await prisma.$queryRawUnsafe("SELECT 1");
  return createDatabase();
}
