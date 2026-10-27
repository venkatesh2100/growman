// Opens the shop database and registers every table model on that connection.
// The API server and the migrate command both call connect once at startup.
// Returns a Sequelize instance that is already authenticated and warmed up.

import pg from "pg";
import { Sequelize } from "sequelize";
import { initModels } from "../models/index.js";

// Order ids and user ids are bigint columns. Return them as numbers so the rest of the shop can compare them.
pg.defaults.parseInt8 = true;

// Called at process start. Throws if neither database URL is set or if Postgres rejects the login.
export async function connect(cfg) {
  // A direct URL wins. Hyperdrive is only used when that setting is empty.
  const connectionString = cfg.databaseURL || cfg.hyperdriveURL;
  const using = cfg.databaseURL ? "DATABASE_URL" : "HYPERDRIVE_URL";
  // The shop cannot serve catalog or checkout without Postgres.
  if (!connectionString) throw new Error("DATABASE_URL or HYPERDRIVE_URL is required");
  // In development, print which setting was chosen so a wrong host is obvious.
  if (cfg.appEnv === "development") console.log(`[DB] connecting via ${using}`);

  // SQL text stays out of the logs unless someone turns LOG_SQL on.
  const logSql = process.env.LOG_SQL === "1" || process.env.LOG_SQL === "true";
  // A missing or zero pool size means 40 connections, enough for checkout bursts.
  const max = cfg.dbMaxOpenConns > 0 ? cfg.dbMaxOpenConns : 40;
  // Idle connections stay ready. Never keep more idle sockets than the pool allows.
  let idle = cfg.dbMaxIdleConns > 0 ? cfg.dbMaxIdleConns : 10;
  if (idle > max) idle = max;

  const sequelize = new Sequelize(connectionString, {
    dialect: "postgres",
    logging: logSql ? (sql) => console.log(sql) : false,
    benchmark: logSql,
    // Drop an idle socket after 10 minutes. A request waits at most 30 seconds for a free connection.
    pool: { max, min: Math.min(4, idle), idle: 10 * 60 * 1000, acquire: 30_000 },
    // Columns are snake_case. Soft-deleted rows stay in the table, and every row has created/updated times.
    define: { underscored: true, paranoid: true, timestamps: true },
  });
  // Fail immediately if the password, host, or database name is wrong.
  await sequelize.authenticate();
  // Open a few connections now so the first shopper does not pay the handshake cost.
  const warm = Math.min(4, idle);
  for (let i = 0; i < warm; i++) await sequelize.query("SELECT 1");
  // Attach User, Product, Order, and the rest of the shop tables to this connection.
  initModels(sequelize);
  return sequelize;
}
