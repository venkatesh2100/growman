// Flattens Pl@ntNet identify payloads and merges care, health, and variety fields back on.
// The scan handler calls topSpecies, healthHits, varietyHits, and merge.
// Country helpers turn GBIF country codes into the origin sentence shown on the result.

import { binomial } from "./policy.js";

// Body as text. A buffer is decoded. An object is stringified so JSON.parse can read it again.
function asText(body) {
  if (typeof body === "string") return body;
  if (body == null) return "";
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  return JSON.stringify(body);
}

// An id that might be a string, a number, or a boolean. Anything else becomes "".
function flexID(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return Number.isInteger(value) ? String(value) : JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
}

/** `[hit, ok]`. ok is false when the first result has no scientific name. */
// The scan handler uses the first result only. A bad body or an empty list is a miss, not a throw.
export function topSpecies(body) {
  const empty = {
    scientificName: "",
    scientificNameWithoutAuthor: "",
    commonNames: [],
    family: "",
    genus: "",
    score: 0,
    gbifId: "",
    powoId: "",
  };
  let doc;
  try {
    doc = JSON.parse(asText(body));
  } catch {
    return [empty, false];
  }
  const results = doc?.results;
  if (!Array.isArray(results) || results.length === 0) return [empty, false];
  const row = results[0];
  const species = row?.species ?? {};
  const hit = {
    scientificName: species.scientificName ?? "",
    scientificNameWithoutAuthor: species.scientificNameWithoutAuthor ?? "",
    commonNames: Array.isArray(species.commonNames) ? species.commonNames : [],
    family: species.family?.scientificName ?? "",
    genus: species.genus?.scientificName ?? "",
    score: typeof row.score === "number" ? row.score : 0,
    gbifId: flexID(row.gbif?.id),
    powoId: flexID(row.powo?.id),
  };
  // No scientific name means the photo was not identified. The score alone is not enough.
  if (hit.scientificName === "" && hit.scientificNameWithoutAuthor === "") return [empty, false];
  return [hit, true];
}

// Disease matches from a health identify call. A blank hit is skipped. A bad body is an empty list, not an error.
export function healthHits(body) {
  let doc;
  try {
    doc = JSON.parse(asText(body));
  } catch {
    return [];
  }
  const out = [];
  for (const hit of doc?.results ?? []) {
    const name = hit?.name ?? "";
    const description = hit?.description ?? "";
    const label = hit?.label ?? "";
    // A result with no name, description, or label is noise.
    if (name === "" && description === "" && label === "") continue;
    out.push({
      name,
      description,
      label,
      score: typeof hit?.score === "number" ? hit.score : 0,
    });
  }
  return out;
}

// Fills a missing disease label from the catalog, matched by disease name.
// Hits that already have a description or a label are left alone. Returns the same list.
export function applyDiseaseLabels(hits, catalog) {
  if (!hits?.length) return hits;
  const text = catalog == null ? "" : asText(catalog);
  if (text === "" || text === "[]") return hits;
  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    return hits;
  }
  if (!Array.isArray(rows)) return hits;
  const labels = new Map();
  for (const row of rows) {
    if (row?.name && row?.label) labels.set(row.name, row.label);
  }
  for (const hit of hits) {
    if (!hit.description && !hit.label) hit.label = labels.get(hit.name) ?? "";
  }
  return hits;
}

// Variety names under each species result. A variety with a blank name is skipped. Returns a flat list.
export function varietyHits(body) {
  let doc;
  try {
    doc = JSON.parse(asText(body));
  } catch {
    return [];
  }
  const out = [];
  for (const row of doc?.results ?? []) {
    let species = row?.species?.scientificNameWithoutAuthor ?? "";
    if (!species) species = row?.species?.scientificName ?? "";
    for (const variety of row?.varieties ?? []) {
      // Skip a variety row that has no name to show.
      if (!String(variety?.name ?? "").trim()) continue;
      out.push({
        name: variety.name,
        species,
        score: typeof variety.score === "number" ? variety.score : 0,
      });
    }
  }
  return out;
}

// True when this catalog row is the same genus and species, ignoring the author citation.
function speciesMatches(raw, want) {
  if (raw == null) return false;
  if (typeof raw === "string") return binomial(raw) === want;
  if (typeof raw === "object") {
    return binomial(raw.scientificNameWithoutAuthor) === want || binomial(raw.scientificName) === want;
  }
  return false;
}

// True when the disease or variety catalog lists this species. The scan skips those calls when this is false.
export function catalogHasSpecies(catalog, name) {
  const want = binomial(name);
  if (!want) return false;
  const text = catalog == null ? "" : typeof catalog === "string" || Buffer.isBuffer(catalog) || catalog instanceof Uint8Array ? asText(catalog) : null;
  let rows = catalog;
  if (text != null) {
    if (text === "") return false;
    try {
      rows = JSON.parse(text);
    } catch {
      return false;
    }
  } else if (catalog == null || (typeof catalog === "string" && catalog === "")) {
    return false;
  }
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return rows.some((row) => speciesMatches(row?.species, want));
}

// Sorts object keys so two equal payloads encode to the same text.
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

// JSON with sorted keys, and <, >, and & escaped so the stored scan matches the other encoder.
function goMarshal(value) {
  return JSON.stringify(sortKeys(value)).replace(/[&<>\u2028\u2029]/g, (ch) => {
    const hex = ch.codePointAt(0).toString(16).padStart(4, "0");
    return `\\u${hex}`;
  });
}

// The species block stored on the scan. Empty fields are omitted so the payload stays small.
function speciesJSON(species) {
  const out = {};
  const gbifId = species.gbifId || species.gbifID || "";
  const powoId = species.powoId || species.powoID || "";
  if (species.scientificName) out.scientificName = species.scientificName;
  if (species.scientificNameWithoutAuthor) out.scientificNameWithoutAuthor = species.scientificNameWithoutAuthor;
  if (Array.isArray(species.commonNames) && species.commonNames.length) out.commonNames = species.commonNames;
  if (species.family) out.family = species.family;
  if (species.genus) out.genus = species.genus;
  if (typeof species.score === "number" && species.score !== 0) out.score = species.score;
  if (gbifId) out.gbifId = gbifId;
  if (powoId) out.powoId = powoId;
  return out;
}

// Native-range text. A blank summary or an empty country list is left out.
function originJSON(origin) {
  const out = {};
  if (origin.summary) out.summary = origin.summary;
  if (Array.isArray(origin.nativeCountries) && origin.nativeCountries.length) out.nativeCountries = origin.nativeCountries;
  if (origin.source) out.source = origin.source;
  return out;
}

// One disease hit. A zero score is omitted.
function healthHitJSON(hit) {
  const out = {};
  if (hit?.name) out.name = hit.name;
  if (hit?.description) out.description = hit.description;
  if (hit?.label) out.label = hit.label;
  if (typeof hit?.score === "number" && hit.score !== 0) out.score = hit.score;
  return out;
}

// The health or variety side of a scan. ran says the call was made. skipped says why it was not.
function sideJSON(side, mapHit) {
  const out = { ran: Boolean(side?.ran) };
  if (side?.skipped) out.skipped = side.skipped;
  if (Array.isArray(side?.results) && side.results.length) out.results = side.results.map(mapHit);
  return out;
}

// One variety hit. The name is always present, even when it is blank.
function varietyHitJSON(hit) {
  const out = { name: hit?.name ?? "" };
  if (hit?.species) out.species = hit.species;
  if (typeof hit?.score === "number" && hit.score !== 0) out.score = hit.score;
  return out;
}

// Credits spent on this scan. remaining is omitted until we actually know the balance.
function quotaJSON(quota) {
  const out = {
    creditsUsed: quota?.creditsUsed ?? 0,
    cached: Boolean(quota?.cached),
    reserve: quota?.reserve ?? 0,
  };
  if (quota?.remaining != null) out.remaining = quota.remaining;
  return out;
}

/** Attaches enrichment onto a species-identify payload. bestMatch and results stay in place. */
// The scan handler calls this after the optional calls. Returns the JSON string that is stored and sent.
// A body that is not an object throws. Health, varieties, and quota are always written, even when empty.
export function merge(speciesBody, extra = {}) {
  let doc;
  try {
    doc = JSON.parse(asText(speciesBody));
  } catch (err) {
    throw new Error(err.message);
  }
  // The species payload must be an object. An array or a bare value cannot take the extra fields.
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("json: cannot unmarshal into Go value of type map[string]interface {}");
  }
  if (extra.flora) doc.flora = extra.flora;
  if (extra.species) doc.species = speciesJSON(extra.species);
  if (extra.origin) doc.origin = originJSON(extra.origin);
  if (extra.care && typeof extra.care === "object" && Object.keys(extra.care).length > 0) doc.care = extra.care;
  doc.health = sideJSON(extra.health, healthHitJSON);
  doc.varieties = sideJSON(extra.varieties, varietyHitJSON);
  doc.quota = quotaJSON(extra.quota);
  return goMarshal(doc);
}

/** Rewrites a stored scan so a replay reports that it spent nothing. */
// A cached scan is served again without calling Pl@ntNet. Returns the original text when it is not an object.
export function markCached(body) {
  const text = asText(body);
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return typeof body === "string" ? body : text;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return typeof body === "string" ? body : text;
  let quota = doc.quota;
  if (!quota || typeof quota !== "object" || Array.isArray(quota)) quota = {};
  // A replay did not spend a credit, even if the original scan did.
  quota.cached = true;
  quota.creditsUsed = 0;
  doc.quota = quota;
  return goMarshal(doc);
}

// Two-letter country codes, uppercased, de-duplicated, and sorted. Anything else is dropped.
function uniqueCodes(codes) {
  const seen = new Set();
  const out = [];
  for (const raw of codes ?? []) {
    const code = String(raw ?? "").trim().toUpperCase();
    // GBIF codes are two letters. Longer or shorter tokens are not countries.
    if (Buffer.byteLength(code) !== 2) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  out.sort();
  return out;
}

// The origin list the scan stores. Same rules as uniqueCodes.
export function cleanCountryCodes(codes) {
  return uniqueCodes(codes);
}

// One sentence for the plant's native range. More than eight countries are summarised so the card stays short.
// Returns "" when there are no codes.
export function nativeCountrySummary(codes) {
  const list = uniqueCodes(codes);
  if (list.length === 0) return "";
  if (list.length > 8) {
    return `GBIF native records in ${list.length} countries, including ${list.slice(0, 8).join(", ")}`;
  }
  return `GBIF native records: ${list.join(", ")}`;
}
