// This file serves plant-identification catalogs to the app and to staff.
// It lists languages, floras, species, diseases, varieties, and how many
// photo scans are left today. Answers are cached so repeat lookups do not
// spend the daily identification quota.

import { error, raw, json } from "../../pkg/httpjson/httpjson.js";
import { validLang, validProject } from "../plantnet/policy.js";

// Reads one query-string value. Repeated keys use the first value.
function qget(req, name) {
  const v = req.query?.[name];
  if (Array.isArray(v)) return v[0] == null ? "" : String(v[0]);
  return v == null ? "" : String(v);
}

// Turns latitude and longitude text into numbers, or null when they are not real coordinates.
function parseLatLon(latS, lonS) {
  if (!String(latS || "").trim() || !String(lonS || "").trim()) return null;
  const lat = Number(latS);
  const lon = Number(lonS);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

// Page size for species lists. Blank or invalid input becomes 20, and 20 is the maximum.
function boundedPageSize(s) {
  const n = Number.parseInt(String(s || "").trim(), 10);
  if (!Number.isInteger(n) || n < 1) return 20;
  return Math.min(n, 20);
}

// Shared checks for disease and variety lists: optional name prefix and language.
function catalogQuery(req, res) {
  const q = new URLSearchParams();
  const prefix = String(qget(req, "prefix")).trim();
  if (prefix.length > 80) {
    error(res, 400, "prefix is too long");
    return null;
  }
  if (prefix) q.set("prefix", prefix);
  let lang = String(qget(req, "lang")).trim();
  if (lang) {
    lang = lang.toLowerCase();
    if (!validLang(lang)) {
      error(res, 400, "unsupported language");
      return null;
    }
    q.set("lang", lang);
  }
  return q;
}

// Tells the app whether the plant-identification service is up. Cached for 30 seconds.
export async function plantNetStatus(req, res) {
  await this.servePlantGet(res, "/v2/_status", null, 30_000);
}

// Lists the languages the identification service can return names in.
export async function plantNetLanguages(req, res) {
  await this.servePlantGet(res, "/v2/languages", null, 24 * 60 * 60 * 1000);
}

// Lists floras (regional plant projects), optionally near a latitude and longitude.
export async function plantNetProjects(req, res) {
  // Older flora models are not offered here.
  if (qget(req, "type").toLowerCase() === "legacy") {
    error(res, 400, "Legacy floras use an outdated model and are not available here.");
    return;
  }
  const q = new URLSearchParams();
  const rawLang = String(qget(req, "lang")).trim();
  if (rawLang) {
    const lang = rawLang.toLowerCase();
    if (!validLang(lang)) {
      error(res, 400, "unsupported language");
      return;
    }
    q.set("lang", lang);
  }
  // Coordinates are optional. If either one is sent, both must be valid degrees.
  const latRaw = qget(req, "lat");
  const lonRaw = qget(req, "lon");
  if (latRaw !== "" || lonRaw !== "") {
    const coords = parseLatLon(latRaw, lonRaw);
    if (!coords) {
      error(res, 400, "lat and lon must be decimal degrees");
      return;
    }
    q.set("lat", coords.lat.toFixed(4));
    q.set("lon", coords.lon.toFixed(4));
  }
  await this.servePlantGet(res, "/v2/projects", q, 24 * 60 * 60 * 1000);
}

// Searches species by a name prefix or a page number, for one flora or for all floras.
export async function plantNetSpecies(req, res) {
  // Illustrations are a paid extra, so this route refuses that flag.
  if (qget(req, "images") === "true") {
    error(res, 400, "Species illustrations require a Pl@ntNet pro plan, so this route does not request them.");
    return;
  }
  const prefix = String(qget(req, "prefix")).trim();
  const page = String(qget(req, "page")).trim();
  // The full species list is too large for the free plan, so a prefix or a page is required.
  if (!prefix && !page) {
    error(res, 400, "Pass prefix or page. The full species list is too large to pull on the free plan.");
    return;
  }
  if (prefix.length > 80) {
    error(res, 400, "prefix is too long");
    return;
  }
  const q = new URLSearchParams();
  if (prefix) q.set("prefix", prefix);
  if (page) {
    const p = Number.parseInt(page, 10);
    if (!/^\+?\d+$/.test(page) || !Number.isInteger(p) || p < 1) {
      error(res, 400, "page must be a positive integer");
      return;
    }
    q.set("page", String(p));
    q.set("pageSize", String(boundedPageSize(qget(req, "pageSize"))));
  }
  const lang = String(qget(req, "lang")).trim();
  if (lang) {
    if (!validLang(lang.toLowerCase())) {
      error(res, 400, "unsupported language");
      return;
    }
    q.set("lang", lang.toLowerCase());
  }
  let path = "/v2/species";
  const project = String(qget(req, "project")).trim();
  if (project) {
    if (!validProject(project)) {
      error(res, 400, "unknown project");
      return;
    }
    path = `/v2/projects/${encodeURIComponent(project)}/species`;
  }
  await this.servePlantGet(res, path, q, 6 * 60 * 60 * 1000);
}

// Lists plant diseases the identification service knows, optionally filtered by name prefix.
export async function plantNetDiseases(req, res) {
  const q = catalogQuery(req, res);
  if (!q) return;
  await this.servePlantGet(res, "/v2/diseases", q, 24 * 60 * 60 * 1000);
}

// Lists plant varieties the identification service knows, optionally filtered by name prefix.
export async function plantNetVarieties(req, res) {
  const q = catalogQuery(req, res);
  if (!q) return;
  await this.servePlantGet(res, "/v2/varieties", q, 24 * 60 * 60 * 1000);
}

// Shows staff how many identification credits were granted and how many remain today.
export async function plantNetQuota(req, res) {
  if (!this.cfg.plantNetAPIKey) {
    error(res, 503, "plant identification not configured");
    return;
  }
  let granted;
  let today;
  try {
    // The granted plan changes rarely. Today's usage is cached a little less long.
    granted = await this.cachedPlantGet("/v2/quota", null, 60_000);
    today = await this.cachedPlantGet("/v2/quota/daily", null, 45_000);
  } catch (err) {
    this.writePlantNetError(res, err);
    return;
  }
  const payload = {
    granted: JSON.parse(granted.toString("utf8")),
    today: JSON.parse(today.toString("utf8")),
    reserve: this.cfg.plantNetReserve,
  };
  // The number we remember locally can be newer than the cached daily report.
  const remaining = await this.identifyRemaining(new Date());
  if (remaining != null) payload.identifyRemaining = remaining;
  // History is optional and only fetched when the caller asks for it.
  if (qget(req, "history") === "1") {
    try {
      const history = await this.cachedPlantGet("/v2/quota/history", null, 60 * 60 * 1000);
      payload.history = JSON.parse(history.toString("utf8"));
    } catch (err) {
      this.writePlantNetError(res, err);
      return;
    }
  }
  json(res, 200, payload);
}

// Fetches one catalog page through the cache and sends the raw JSON back.
// Refuses the call when plant identification is not configured.
export async function servePlantGet(res, path, q, ttl) {
  if (!this.cfg.plantNetAPIKey) {
    error(res, 503, "plant identification not configured");
    return;
  }
  try {
    const body = await this.cachedPlantGet(path, q, ttl);
    raw(res, 200, body);
  } catch (err) {
    this.writePlantNetError(res, err);
  }
}
