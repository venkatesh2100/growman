// This file finds where a scanned plant is native and writes a short care guide.
// After a photo scan, the customer sees origin, light, water, soil, and pests
// without the app calling the identification service again for those facts.

import { binomial } from "../plantnet/policy.js";
import { cleanCountryCodes, nativeCountrySummary } from "../plantnet/scan.js";

// GBIF asks callers to send a name and a contact page with each lookup.
const gbifUserAgent = "Growman/1.0 (plant-care; +https://growman.live)";

// Shortens text to a character limit without splitting a letter.
export function clipText(s, max) {
  const text = String(s ?? "").trim();
  const runes = [...text];
  if (runes.length <= max) return text;
  return runes.slice(0, max).join("").trim();
}

// Keeps the first few short list items, such as pest names, and drops blanks.
function clipList(items, max) {
  const out = [];
  for (const item of items || []) {
    const text = clipText(item, 80);
    if (!text) continue;
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

// Pulls the JSON object out of a reply that may have extra words around it.
function extractJSONObject(s) {
  const text = String(s ?? "").trim();
  const i = text.indexOf("{");
  const j = text.lastIndexOf("}");
  if (i < 0 || j <= i) return "";
  return text.slice(i, j + 1);
}

// Looks up where a scanned species is native and returns a short summary.
export async function lookupOrigin(gbifID) {
  const id = String(gbifID || "").trim();
  if (!id) return null;
  const codes = await this.gbifNativeCountries(id);
  const summary = nativeCountrySummary(codes);
  if (!summary) return null;
  return { summary, nativeCountries: codes, source: "gbif" };
}

// Asks GBIF which countries list this species as native, and caches the answer for two weeks.
export async function gbifNativeCountries(gbifID) {
  const key = `plantnet:gbif:${gbifID}`;
  const now = new Date();
  // A repeat scan of the same species reuses the saved country list.
  const cached = await this.plantLoad(key, now);
  if (cached) {
    try {
      const codes = JSON.parse(cached.toString("utf8"));
      if (Array.isArray(codes)) return codes;
    } catch { /* look it up again */ }
  }
  try {
    // The distribution list is large, so the request stops after four seconds.
    const res = await fetch(`https://api.gbif.org/v1/species/${encodeURIComponent(gbifID)}/distributions?limit=300`, {
      headers: { "User-Agent": gbifUserAgent, Accept: "application/json" },
      signal: AbortSignal.timeout(4000),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    // Keep at most two megabytes of the reply.
    const body = buf.length > (2 << 20) ? buf.subarray(0, 2 << 20) : buf;
    if (res.status !== 200) return null;
    const doc = JSON.parse(body.toString("utf8"));
    // Only countries where the species is listed as native, not introduced.
    const codes = [];
    for (const row of doc.results || []) {
      if (String(row.establishmentMeans || "").toLowerCase() === "native") codes.push(row.country);
    }
    const cleaned = cleanCountryCodes(codes) || [];
    await this.plantSet(key, Buffer.from(JSON.stringify(cleaned)), 14 * 24 * 60 * 60 * 1000, now);
    return cleaned;
  } catch (err) {
    console.log(`[plants] gbif lookup failed: ${err.message || err}`);
    return null;
  }
}

// Builds a short care guide for the top species from a scan, and caches it for two weeks.
export async function careGuide(hit, lang, origin) {
  // Prefer the scientific name without the author, then the full scientific name.
  let name = hit?.scientificNameWithoutAuthor || "";
  if (!name) name = hit?.scientificName || "";
  if (!String(name).trim()) return null;
  const language = lang || "en";
  const key = `plantnet:care:v1:${language}:${binomial(name)}`;
  const now = new Date();
  // The same species in the same language reuses the saved guide.
  const cached = await this.plantLoad(key, now);
  if (cached) {
    try {
      const parsed = JSON.parse(cached.toString("utf8"));
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) return parsed;
    } catch { /* fetch a fresh guide */ }
  }
  // Without the advice service there is no guide to write.
  if (!String(this.cfg.ragServiceURL || "").trim()) return null;
  let raw;
  try {
    // Ask for light, water, soil, and related care, and stop after twelve seconds.
    raw = await this.askRAGCare({
      species: name,
      commonNames: hit.commonNames || undefined,
      family: hit.family || undefined,
      originCountries: origin?.nativeCountries || undefined,
      language,
    }, AbortSignal.timeout(12_000));
  } catch (err) {
    console.log(`[plants] care guide unavailable: ${err.message || err}`);
    return null;
  }
  let guide;
  try {
    guide = JSON.parse(extractJSONObject(raw.toString("utf8")));
  } catch {
    return null;
  }
  if (!guide || typeof guide !== "object") return null;
  // Keep each care line short enough to show under the scan result.
  const out = {};
  // Copies one care line only when it has text, and keeps it short.
  const put = (k, v) => {
    const text = clipText(v, 240);
    if (text) out[k] = text;
  };
  put("origin", guide.origin);
  put("light", guide.light);
  put("water", guide.water);
  put("soil", guide.soil);
  put("temperature", guide.temperature);
  put("fertilizer", guide.fertilizer);
  const pests = clipList(guide.pests, 4);
  if (pests.length) out.pests = pests;
  const diseases = clipList(guide.diseases, 4);
  if (diseases.length) out.diseases = diseases;
  if (Object.keys(out).length === 0) return null;
  out.source = "guidance";
  await this.plantSet(key, Buffer.from(JSON.stringify(out)), 14 * 24 * 60 * 60 * 1000, now);
  return out;
}
