// Process health for the shop API.
//
// The liveness check only says the process is up. The readiness check pings
// Postgres and, when configured, Redis. Postgres must answer or the process
// is down. Redis trouble marks the process degraded but still serving.
// Image storage is reported as configured or not. The version route reports
// the build and the current time in India.

import { json } from "../../pkg/httpjson/httpjson.js";

// Redis is given two seconds to answer the readiness ping.
const readinessTimeoutMs = 2000;

// Liveness. The process is up. This does not check the database.
export async function health(req, res) {
  json(res, 200, { status: "ok", service: "node-backend" });
}

// Readiness. Postgres is required. Redis and image storage are reported and do not by themselves take the process down.
export async function ready(req, res) {
  const checks = {};
  let status = 200;
  let overall = "ok";
  try {
    await this.sequelize.query("SELECT 1");
    const pool = this.sequelize.connectionManager.pool;
    const using = pool?.using ?? pool?._count ?? 0;
    const idle = pool?.available ?? 0;
    checks.postgres = "ok";
    checks.postgres_conns = `${using} in use, ${idle} idle`;
  } catch (err) {
    checks.postgres = `error: ${err.message}`;
    status = 503;
    overall = "down";
  }
  if (!this.redis) {
    checks.redis = "not configured";
  } else {
    try {
      await Promise.race([
        this.redis.ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), readinessTimeoutMs)),
      ]);
      checks.redis = "ok";
    } catch (err) {
      checks.redis = `error: ${err.message}`;
      // Redis is optional. A failure leaves the API up and marks it degraded.
      if (overall === "ok") overall = "degraded";
    }
  }
  checks.images = this.imageService ? "ok" : "not configured";
  json(res, status, { status: overall, service: "node-backend", checks });
}

// Build identity and the current time in Asia/Kolkata.
export async function version(req, res) {
  const serverTime = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Kolkata", hour12: false }).replace(" ", "T") + "+05:30";
  json(res, 200, {
    server_time: serverTime,
    built_at: "2026-03-09-v2",
    git: process.env.GIT_COMMIT || "",
  });
}
