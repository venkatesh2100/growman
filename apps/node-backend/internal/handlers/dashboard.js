// This file draws the staff map of where shoppers are visiting from.
// An admin asks for the world or for India, for today, this week, or this
// month. The numbers come from Cloudflare's visit analytics.

import { error, json } from "../../pkg/httpjson/httpjson.js";
import { isAdminRole, requireUser } from "../auth/jwt.js";

// Reads one query-string value. Repeated keys use the first value.
function qget(req, name) {
  const v = req.query?.[name];
  if (Array.isArray(v)) return v[0] == null ? "" : String(v[0]);
  return v == null ? "" : String(v);
}

// Turns the staff time choice into the number of days the analytics query looks back.
function daysForTimeFrame(timeFrame) {
  switch (timeFrame) {
    case "weekly": return "7";
    case "monthly": return "30";
    default: return "1";
  }
}

// Turns a missing analytics value into the same empty marker the old service used.
function goSprint(v) {
  if (v == null) return "<nil>";
  return String(v);
}

// Visit counts that are not a real number become zero so the map can still draw.
function waeFloat(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// Runs one SQL query against Cloudflare's analytics engine and returns the rows.
export async function queryWAE(sql) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${this.cfg.cloudflareAccountID}/analytics_engine/sql`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${this.cfg.cloudflareAPIToken}` },
    body: sql,
    signal: AbortSignal.timeout(20_000),
  });
  // A failed analytics call is reported with its status instead of throwing here.
  if (res.status >= 300) return { rows: null, status: res.status, error: null };
  try {
    const parsed = await res.json();
    return { rows: Array.isArray(parsed.data) ? parsed.data : [], status: res.status, error: null };
  } catch (err) {
    return { rows: null, status: res.status, error: err };
  }
}

// Counts recent visits by country for the world map. An empty list means the map stays blank.
export async function fetchWorldMapStats(timeFrame) {
  if (!this.cfg.cloudflareAccountID) return [];
  const sql = `
SELECT
  blob1 AS countryCode,
  SUM(_sample_interval * double1) AS requests
FROM wae_events_v2
WHERE timestamp > NOW() - INTERVAL '${daysForTimeFrame(timeFrame)}' DAY
GROUP BY countryCode
ORDER BY requests DESC
LIMIT 250`;
  let rows;
  let status;
  let err;
  try {
    ({ rows, status, error: err } = await this.queryWAE(sql));
  } catch {
    return [];
  }
  if (err || status >= 300 || !rows) return [];
  const stats = [];
  for (const row of rows) {
    const code = goSprint(row.countryCode).trim();
    // Skip countries the analytics row did not actually name.
    if (!code || code.toLowerCase() === "null") continue;
    stats.push({ code, name: code, value: waeFloat(row.requests) });
  }
  return stats;
}

// Counts recent visits inside India by region. Missing Cloudflare settings are an error.
export async function fetchIndiaMapStats(timeFrame) {
  if (!this.cfg.cloudflareAPIToken || !this.cfg.cloudflareAccountID) {
    throw new Error("cloudflare account analytics is not configured");
  }
  const sql = `
SELECT
  blob3 AS regionCode,
  blob2 AS region,
  SUM(_sample_interval * double1) AS requests
FROM wae_events_v2
WHERE timestamp > NOW() - INTERVAL '${daysForTimeFrame(timeFrame)}' DAY
  AND blob1 = 'IN'
GROUP BY regionCode, region
ORDER BY requests DESC
LIMIT 100`;
  let rows;
  let status;
  let err;
  try {
    ({ rows, status, error: err } = await this.queryWAE(sql));
  } catch (cause) {
    throw new Error(`cloudflare wae query failed: ${cause.message || cause}`);
  }
  if (err) throw new Error(`cloudflare wae query failed: ${err.message || err}`);
  if (status >= 300) throw new Error(`cloudflare wae request failed (status ${status})`);
  return (rows || []).map((row) => ({
    code: goSprint(row.regionCode),
    name: goSprint(row.region),
    value: waeFloat(row.requests),
  }));
}

// Staff-only map. World view, or India by region, for daily, weekly, or monthly traffic.
export async function dashboardMap(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  if (!isAdminRole(claims.role)) {
    error(res, 403, "admin access required");
    return;
  }
  let timeFrame = qget(req, "timeFrame").trim().toLowerCase();
  if (!timeFrame) timeFrame = "daily";
  const country = qget(req, "country").trim();
  const mapType = qget(req, "mapType").trim().toLowerCase();
  let stats;
  try {
    if (mapType === "world") stats = await this.fetchWorldMapStats(timeFrame);
    else if (mapType === "country") {
      if (country.toLowerCase() !== "india") {
        error(res, 400, "only India country map is supported");
        return;
      }
      stats = await this.fetchIndiaMapStats(timeFrame);
    } else {
      error(res, 400, "mapType must be world or country");
      return;
    }
  } catch (err) {
    error(res, 502, err.message || "cloudflare wae query failed");
    return;
  }
  json(res, 200, { success: true, formattedStats: stats });
}
