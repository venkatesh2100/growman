// This file identifies a plant from a customer's photo.
// It checks the daily scan quota, reuses a cached answer for the same photo,
// and asks the identification service for the species, disease, and variety
// only when credits are still available. The photos are also stored for the shop.

import { createHash } from "node:crypto";
import path from "node:path";
import multer from "multer";
import { error, raw } from "../../pkg/httpjson/httpjson.js";
import {
  normalizeFocus,
  pickFlora,
  plan,
  remainingIdentifications,
  untilUTCMidnight,
  validLang,
  validOrgan,
  validProject,
} from "../plantnet/policy.js";
import {
  applyDiseaseLabels,
  catalogHasSpecies,
  healthHits,
  markCached,
  merge,
  topSpecies,
  varietyHits,
} from "../plantnet/scan.js";

// Photos stay in memory. At most eight files, each up to 10 MB.
const plantUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 8, fieldSize: 1024 * 1024 },
}).any();

// Runs the photo upload parser and reports success or the parser's error.
function runMulter(req, res) {
  return new Promise((resolve, reject) => {
    plantUpload(req, res, (err) => (err ? reject(err) : resolve()));
  });
}

// Turns one form value or a list of form values into a list of strings.
function asList(value) {
  if (value == null || value === "") return [];
  return Array.isArray(value) ? value.map((v) => String(v)) : [String(value)];
}

// Reads one form field. Repeated fields use the first value.
function formValue(req, name) {
  const v = req.body?.[name];
  if (Array.isArray(v)) return v[0] == null ? "" : String(v[0]);
  return v == null ? "" : String(v);
}

// True when a form field was sent as 1, true, or yes.
function formFlag(req, name) {
  switch (formValue(req, name).trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
      return true;
    default:
      return false;
  }
}

// The language for species names. Blank or unknown languages become English.
function plantLang(s) {
  s = String(s || "").trim().toLowerCase();
  if (!s) return "en";
  return validLang(s) ? s : "en";
}

// How many species guesses to ask for. Blank becomes 5, and 10 is the maximum.
function plantNBResults(s) {
  const n = Number.parseInt(String(s || "").trim(), 10);
  if (!Number.isInteger(n) || n < 1) return 5;
  return Math.min(n, 10);
}

// Latitude and longitude from the form, or null when they are missing or impossible.
export function parseLatLon(latS, lonS) {
  if (!String(latS || "").trim() || !String(lonS || "").trim()) return null;
  const lat = Number(latS);
  const lon = Number(lonS);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

// How long a scan answer may be cached. A short or missing time lasts until UTC midnight.
function cacheMs(ttl) {
  if (typeof ttl === "number" && ttl >= 60_000) return ttl;
  const next = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1);
  const ms = next - Date.now();
  return ms < 60_000 ? 60_000 : ms;
}

// The HTTP status from a plant-identification error, or 0 when the error is something else.
function plantNetStatusOf(err) {
  if (!err || typeof err !== "object") return 0;
  const msg = String(err.message || "");
  const named = err.name === "APIError" || err.name === "PlantNetAPIError" || msg.startsWith("plantnet status");
  if (!named) return 0;
  const status = Number(err.status || err.statusCode || 0);
  if (status) return status;
  const m = msg.match(/plantnet status (\d+)/);
  return m ? Number(m[1]) : 0;
}

// Logs an identification error after hiding the API key if it leaked into the message.
function logPlantErr(err) {
  if (!err) return;
  let msg = String(err.message || err);
  const i = msg.indexOf("api-key=");
  if (i >= 0) msg = `${msg.slice(0, i)}api-key=redacted`;
  console.log(`[plants] ${msg}`);
}

// A short reason the customer can read when identification fails for a known status.
function plantNetFailureMessage(status) {
  switch (status) {
    case 401:
    case 403:
      return "Plant identification is not configured. Check the Pl@ntNet API key.";
    case 413:
      return "That photo is too large. Crop it closer and try again.";
    case 415:
      return "That photo could not be used. Use a JPEG or PNG of one plant.";
    default:
      if (status >= 500) return "Plant identification is busy right now. Try the photo again.";
      return "Plant identification failed.";
  }
}

// Turns an identification failure into the status and message the app should show.
export function writePlantNetError(res, err) {
  const status = plantNetStatusOf(err);
  if (status) {
    switch (status) {
      case 404:
        error(res, 404, "No plant recognized in that photo.");
        return;
      case 400:
        error(res, 400, "That photo could not be used for identification. Use a JPEG or PNG of one plant.");
        return;
      case 429:
        // The daily scan quota is used up. It resets at midnight UTC.
        error(res, 429, "Plant identification quota is used up for today. It resets at 00:00 UTC.");
        return;
      default:
        logPlantErr(err);
        error(res, 502, plantNetFailureMessage(status));
        return;
    }
  }
  logPlantErr(err);
  error(res, 502, "Plant identification is unavailable. Try the photo again.");
}

// The top species guess from an identification reply, or null when there is no usable guess.
function unwrapTop(body) {
  const result = topSpecies(body);
  if (!result) return null;
  if (Array.isArray(result)) return result[1] ? result[0] : null;
  if (result.ok === false) return null;
  if (result.hit) return result.hit;
  return result;
}

// How many identifications the service says are left, or null when the reply did not say.
function unwrapRemaining(body) {
  const result = remainingIdentifications(body);
  if (result == null) return null;
  if (typeof result === "number" && Number.isFinite(result)) return result;
  if (Array.isArray(result)) return result[1] ? result[0] : null;
  if (typeof result === "object") {
    if (result.ok === false) return null;
    if ("n" in result) return result.n;
    if ("remaining" in result) return result.remaining;
  }
  return null;
}

// Makes sure a reply is raw bytes before it is cached or sent to the app.
function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value);
  return Buffer.from(JSON.stringify(value));
}

// A cache key for this exact set of photos and scan options.
// The same photo with the same options reuses the answer and spends no new credit.
function scanCacheKey(project, lang, focus, nb, detailed, related, noReject, photos, organs) {
  const sum = createHash("sha256");
  photos.forEach((photo, i) => {
    sum.update(photo.bytes);
    sum.update(Buffer.from([0]));
    if (i < organs.length) sum.update(Buffer.from(organs[i]));
  });
  return `plantnet:scan:${project}:${lang}:${focus}:${nb}:${detailed}:${related}:${noReject}:${sum.digest("hex")}`;
}

// A storage path for a saved plant photo, based on the time and a cleaned file name.
function generateImageKey(prefix, filename) {
  if (!prefix) prefix = "uploads";
  const ext = path.extname(filename || "") || ".jpg";
  const timestamp = Math.floor(Date.now() / 1000);
  if (filename) {
    let base = path.basename(filename, path.extname(filename)).toLowerCase().replaceAll(" ", "-").replaceAll("_", "-");
    let sanitized = "";
    for (const r of base) {
      if ((r >= "a" && r <= "z") || (r >= "0" && r <= "9") || r === "-") sanitized += r;
    }
    return `${prefix}/${timestamp}-${sanitized}${ext}`;
  }
  return `${prefix}/${timestamp}-${Date.now() % 1000000}${ext}`;
}

// Reads the uploaded plant photos and the organ label (leaf, flower, and so on) for each one.
async function readPlantPhotos(req) {
  const all = Array.isArray(req.files) ? req.files : [];
  let files = all.filter((f) => f.fieldname === "image");
  if (!files.length) files = all.filter((f) => f.fieldname === "images");
  if (!files.length) throw new Error("at least one image is required");
  if (files.length > 5) throw new Error("maximum 5 images allowed");
  const organsIn = asList(req.body?.organs);
  const photos = [];
  const organs = [];
  for (let i = 0; i < files.length; i++) {
    const fh = files[i];
    const buf = fh.buffer || Buffer.alloc(0);
    if (!buf.length) throw new Error("image file is empty");
    let organ = "auto";
    if (i < organsIn.length && organsIn[i] !== "") {
      organ = organsIn[i].trim().toLowerCase();
      if (!validOrgan(organ)) throw new Error("organs must be auto, leaf, flower, fruit, or bark");
    }
    let name = path.basename(fh.originalname || "");
    if (!name || name === "." || name === "/") name = "plant.jpg";
    // Shrink and convert the photo before it is identified or stored.
    const photo = await this.normalizePlantPhoto({
      filename: name,
      contentType: fh.mimetype || "",
      bytes: buf,
    });
    photos.push(photo);
    organs.push(organ);
  }
  return { photos, organs };
}

// Saves the scan photos in cloud storage. A failed upload is logged and does not fail the scan.
export function storePlantPhotos(photos) {
  if (!this.imageService || !photos?.length) return;
  const saved = photos.map((p) => ({ ...p, bytes: Buffer.from(p.bytes) }));
  // Upload in the background so the scan reply is not delayed by storage.
  void (async () => {
    for (let i = 0; i < saved.length; i++) {
      const photo = saved[i];
      let filename = photo.filename;
      // Extra photos in one scan get a number so they do not overwrite each other.
      if (saved.length > 1) {
        const ext = path.extname(photo.filename);
        const base = filename.slice(0, filename.length - ext.length);
        filename = `${base}-${i + 1}${ext}`;
      }
      const imageKey = generateImageKey("plants", filename);
      try {
        await this.imageService.uploadImage(imageKey, photo.bytes, photo.contentType);
      } catch (err) {
        console.log(`[plants] silent cloud storage upload failed for ${photo.filename}: ${err.message || err}`);
      }
    }
  })();
}

// Query string that only carries the language, for disease and variety catalogs.
function langValues(lang) {
  const q = new URLSearchParams();
  if (lang) q.set("lang", lang);
  return q;
}

// Fetches one identification-service page, using the cache when the same page was fetched recently.
export async function cachedPlantGet(path, q, ttl) {
  const vals = new URLSearchParams();
  if (q) {
    const source = q instanceof URLSearchParams ? q : new URLSearchParams(q);
    for (const [k, v] of source) {
      if (v !== "") vals.append(k, v);
    }
  }
  const key = `plantnet:get:${path}?${vals.toString()}`;
  const now = new Date();
  const hit = await this.plantLoad(key, now);
  if (hit) return hit;
  const client = this.plantClient();
  const rawBody = await client.get(path, Object.fromEntries(vals));
  const body = asBuffer(rawBody);
  await this.plantSet(key, body, ttl, now);
  return body;
}

// Floras near a latitude and longitude, cached for a day so the map lookup is not repeated.
export async function projectsNear(lat, lon, lang) {
  const key = `plantnet:projects:${lat.toFixed(1)}:${lon.toFixed(1)}:${lang}`;
  const now = new Date();
  const cached = await this.plantLoad(key, now);
  if (cached) {
    try {
      const projects = JSON.parse(cached.toString("utf8"));
      if (Array.isArray(projects)) return projects;
    } catch { /* fetch again */ }
  }
  const q = { lat: lat.toFixed(4), lon: lon.toFixed(4) };
  if (lang) q.lang = lang;
  const rawBody = await this.plantClient().get("/v2/projects", q);
  const body = asBuffer(rawBody);
  await this.plantSet(key, body, 24 * 60 * 60 * 1000, now);
  const projects = JSON.parse(body.toString("utf8"));
  if (!Array.isArray(projects)) throw new Error("plantnet projects");
  return projects;
}

// Chooses which flora to scan against: the one the customer named, or the one near their location.
export async function resolveFlora(req, lang) {
  const explicit = formValue(req, "project").trim();
  let fallback = this.cfg.plantNetProject;
  if (!validProject(fallback)) fallback = "all";
  if (explicit && explicit !== "all") return validProject(explicit) ? explicit : fallback;
  const coords = parseLatLon(formValue(req, "lat"), formValue(req, "lon"));
  if (!coords) return fallback;
  try {
    const projects = await this.projectsNear(coords.lat, coords.lon, lang);
    return pickFlora("", projects, fallback);
  } catch (err) {
    logPlantErr(err);
    return fallback;
  }
}

// Remembers the remaining scan count from a service reply, when the reply included one.
export async function observeRemaining(body) {
  const n = unwrapRemaining(body);
  if (n == null) return null;
  await this.noteIdentifyRemaining(n, new Date());
  return n;
}

// A "too many requests" reply means the daily scan quota is now zero.
export async function noteAPIFailure(err) {
  if (plantNetStatusOf(err) === 429) await this.noteIdentifyRemaining(0, new Date());
}

// The variety catalog for one language, cached for a day.
export async function varietyCatalog(lang) {
  return this.cachedPlantGet("/v2/varieties", langValues(lang), 24 * 60 * 60 * 1000);
}

// The disease catalog for one language. A failure here does not fail the whole scan.
export async function diseaseCatalog(lang) {
  try {
    return await this.cachedPlantGet("/v2/diseases", langValues(lang), 24 * 60 * 60 * 1000);
  } catch (err) {
    logPlantErr(err);
    return null;
  }
}

// Runs one plant scan: species first, then disease and variety only if the quota plan allows them.
export async function runScan(input) {
  const client = this.plantClient();
  const req = {
    project: input.project,
    organs: input.organs,
    lang: input.lang,
    nbResults: input.nb,
    includeRelatedImages: input.related,
    noReject: input.noReject,
    detailed: input.detailed,
  };
  // Species identification always runs. It is the one credit this scan must spend.
  let speciesBody;
  try {
    speciesBody = asBuffer(await client.identifySpecies(req, input.photos));
  } catch (err) {
    await this.noteAPIFailure(err);
    throw err;
  }
  // Read how many identifications are left after that species call.
  let remaining = await this.observeRemaining(speciesBody);
  const known = remaining != null;
  if (!known) remaining = 0;
  // Keep a reserve of credits. Disease and variety are skipped when the reserve would be used up.
  let reserve = this.cfg.plantNetReserve;
  if (reserve < 0) reserve = 0;
  const spend = plan(input.focus, remaining, known, reserve) || {};
  const wantDisease = Boolean(spend.disease ?? spend.Disease);
  let diseaseSkip = spend.diseaseSkip ?? spend.DiseaseSkip ?? "";
  let varietySkip = spend.varietySkip ?? spend.VarietySkip ?? "";
  const wantVariety = Boolean(spend.variety ?? spend.Variety);
  let credits = 1;
  const hit = unwrapTop(speciesBody);

  let origin = null;
  let care = null;
  let health = { ran: false, skipped: diseaseSkip };
  const jobs = [];
  // Origin and the care guide do not spend an identification credit.
  if (hit) {
    // Look up where the species is from, then write its care guide.
    jobs.push((async () => {
      origin = await this.lookupOrigin(hit.gbifId || hit.gbifID || "");
      care = await this.careGuide(hit, input.lang, origin);
    })());
  }
  // Disease identification spends another credit, and only when the quota plan says to.
  if (wantDisease) {
    jobs.push((async () => {
      try {
        const body = asBuffer(await client.identifyDiseases(req, input.photos));
        await this.observeRemaining(body);
        let hits = healthHits(body) || [];
        hits = applyDiseaseLabels(hits, await this.diseaseCatalog(input.lang)) || hits;
        health = { ran: true, results: hits };
      } catch (err) {
        logPlantErr(err);
        await this.noteAPIFailure(err);
        health = { ran: false, skipped: "failed" };
      }
    })());
  }
  await Promise.all(jobs);
  if (health.ran) credits++;

  // Variety identification is a third credit, and it is skipped when the species is unknown or the reserve is tight.
  let varieties = { ran: false, skipped: varietySkip };
  if (wantVariety) {
    if (!hit) {
      varieties = { ran: false, skipped: "no_species" };
    } else {
      const left = await this.identifyRemaining(new Date());
      if (left != null && left <= reserve) {
        varieties = { ran: false, skipped: "quota_reserve" };
      } else {
        try {
          const catalog = await this.varietyCatalog(input.lang);
          const named = hit.scientificNameWithoutAuthor || "";
          const full = hit.scientificName || "";
          // A species that is not in the variety catalog cannot have a variety scan.
          if (!catalogHasSpecies(catalog, named) && !catalogHasSpecies(catalog, full)) {
            varieties = { ran: false, skipped: "not_in_catalog" };
          } else {
            try {
              const body = asBuffer(await client.identifyVarieties(req, input.photos));
              await this.observeRemaining(body);
              credits++;
              varieties = { ran: true, results: varietyHits(body) || [] };
            } catch (err) {
              logPlantErr(err);
              await this.noteAPIFailure(err);
              varieties = { ran: false, skipped: "failed" };
            }
          }
        } catch (err) {
          logPlantErr(err);
          varieties = { ran: false, skipped: "failed" };
        }
      }
    }
  }

  // Prefer the care-guide origin text, and keep the GBIF source label when both exist.
  const careOrigin = typeof care?.origin === "string" ? care.origin : "";
  if (origin) {
    if (careOrigin) {
      origin.summary = careOrigin;
      if (origin.source === "gbif") origin.source = "gbif+guidance";
    }
  } else if (careOrigin) {
    origin = { summary: careOrigin, source: "guidance" };
  }

  const leftNow = await this.identifyRemaining(new Date());
  const merged = asBuffer(merge(speciesBody, {
    flora: input.project,
    species: hit || undefined,
    origin: origin || undefined,
    care: care || undefined,
    health,
    varieties,
    quota: {
      creditsUsed: credits,
      reserve,
      remaining: leftNow == null ? undefined : leftNow,
    },
  }));
  // The combined answer is cached until the daily quota resets at UTC midnight.
  return { body: merged, ttl: cacheMs(untilUTCMidnight(new Date())) };
}

// The photo-scan request: check the quota, reuse a cached answer, or run a new identification.
export async function identifyPlant(req, res) {
  if (!this.cfg.plantNetAPIKey) {
    error(res, 503, "plant identification not configured");
    return;
  }
  try {
    await runMulter(req, res);
  } catch (err) {
    const msg = String(err?.message || err);
    if (err?.code === "LIMIT_FILE_SIZE" || msg.toLowerCase().includes("too large")) {
      error(res, 413, "images must be 10MB or smaller in total");
      return;
    }
    error(res, 400, "failed to parse multipart form");
    return;
  }

  let photos;
  let organs;
  try {
    ({ photos, organs } = await readPlantPhotos.call(this, req));
  } catch (err) {
    error(res, 400, err.message || "failed to read image");
    return;
  }
  const lang = plantLang(formValue(req, "lang"));
  const nb = plantNBResults(formValue(req, "nb-results"));
  const focus = normalizeFocus(formValue(req, "focus"));
  const detailed = formFlag(req, "detailed");
  const related = formFlag(req, "related-images");
  const noReject = formFlag(req, "no-reject");
  // Store the photos even if the scan is later served from cache or refused for quota.
  this.storePlantPhotos(photos);

  // Stop before calling the service when today's scan quota is already used up.
  const now = new Date();
  const left = await this.identifyRemaining(now);
  if (left != null && left <= 0) {
    error(res, 429, "Plant identification quota is used up for today. It resets at 00:00 UTC.");
    return;
  }
  const project = await this.resolveFlora(req, lang);
  const cacheKey = scanCacheKey(project, lang, focus, nb, detailed, related, noReject, photos, organs);
  // The same photo and options return the saved answer and spend no new credit.
  const cached = await this.plantLoad(cacheKey, now);
  if (cached) {
    raw(res, 200, asBuffer(markCached(cached)));
    return;
  }
  try {
    // If two scans of the same photo arrive together, only one of them calls the service.
    const body = await this.plantFlight(cacheKey, async () => {
      const again = await this.plantLoad(cacheKey, new Date());
      if (again) return asBuffer(markCached(again));
      const scanned = await this.runScan({ photos, organs, project, lang, focus, nb, detailed, related, noReject });
      await this.plantSet(cacheKey, scanned.body, scanned.ttl, new Date());
      return scanned.body;
    });
    raw(res, 200, body);
  } catch (err) {
    writePlantNetError(res, err);
  }
}
