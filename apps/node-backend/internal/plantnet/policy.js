// Which Pl@ntNet identify credits a scan may spend. The species call is always required.
// The scan handler calls plan before the disease and variety calls, and pickFlora before the species call.
// Credits reset at UTC midnight. A reserve is kept so the last credits of the day are not spent on optional calls.

export const FocusSpecies = "species";
export const FocusHealth = "health";
export const FocusVariety = "variety";
export const FocusFull = "full";
export const FocusCare = "care";

// Why an optional call did not run. The scan response shows this so the app can explain a missing section.
export const SkipNotRequested = "not_requested";
export const SkipQuotaReserve = "quota_reserve";
export const SkipNotInCatalog = "not_in_catalog";
export const SkipFailed = "failed";
export const SkipNoSpecies = "no_species";

const FOCUSES = new Set([FocusSpecies, FocusHealth, FocusVariety, FocusFull, FocusCare]);

// The scan request's focus. An unknown or blank value becomes care, which asks for species plus the optional calls.
export function normalizeFocus(focus) {
  const normalized = String(focus ?? "").trim().toLowerCase();
  return FOCUSES.has(normalized) ? normalized : FocusCare;
}

/**
 * Decides the optional disease and variety calls.
 * `remaining` is the leftover identify credits after the species call.
 * `known` is false until a remaining count has been seen for the current UTC day.
 */
// Returns { disease, variety, diseaseSkip, varietySkip }. A true flag means "spend a credit on this call".
export function plan(focus, remaining, known, reserve) {
  if (reserve < 0) reserve = 0;
  focus = normalizeFocus(focus);
  // Care and full want both. Health wants only disease. Variety wants only variety. Species wants neither.
  const wantDisease = focus === FocusHealth || focus === FocusFull || focus === FocusCare;
  const wantVariety = focus === FocusVariety || focus === FocusFull || focus === FocusCare;
  const spend = { disease: false, variety: false, diseaseSkip: "", varietySkip: "" };
  if (!wantDisease) spend.diseaseSkip = SkipNotRequested;
  // Once we know the balance, keep `reserve` credits for later species scans instead of spending them here.
  else if (known && remaining <= reserve) spend.diseaseSkip = SkipQuotaReserve;
  else spend.disease = true;
  if (!wantVariety) spend.varietySkip = SkipNotRequested;
  else if (known && remaining <= reserve) spend.varietySkip = SkipQuotaReserve;
  else spend.variety = true;
  return spend;
}

// A flora project id: lowercase letters, digits, and hyphens, not starting with a hyphen, at most 64 bytes.
// Returns false for "all" only when the caller checks that separately. This function allows any matching id.
export function validProject(value) {
  const s = String(value ?? "");
  if (s === "" || Buffer.byteLength(s) > 64) return false;
  let byteIndex = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    const lower = cp >= 0x61 && cp <= 0x7a;
    const digit = cp >= 0x30 && cp <= 0x39;
    const hyphen = cp === 0x2d && byteIndex > 0;
    if (!(lower || digit || hyphen)) return false;
    byteIndex += Buffer.byteLength(ch);
  }
  return true;
}

// A language tag of 2 to 8 bytes, lowercase letters and hyphens only. Sent to Pl@ntNet as the result language.
export function validLang(value) {
  const s = String(value ?? "");
  const n = Buffer.byteLength(s);
  if (n < 2 || n > 8) return false;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (!((cp >= 0x61 && cp <= 0x7a) || cp === 0x2d)) return false;
  }
  return true;
}

// The organ the photo shows. "auto" lets Pl@ntNet decide. Anything else is rejected by the scan handler.
export function validOrgan(value) {
  switch (value) {
    case "auto":
    case "leaf":
    case "flower":
    case "fruit":
    case "bark":
      return true;
    default:
      return false;
  }
}

// Project rows from Pl@ntNet use either id or ID. Returns the trimmed id, or "".
function projectId(project) {
  return String(project?.id ?? project?.ID ?? "").trim();
}

/** Explicit project wins; otherwise the first valid Kew flora (`k-`); otherwise fallback or "all". */
// The species identify call needs a flora project. "all" means no project filter.
export function pickFlora(explicit, projects, fallback) {
  explicit = String(explicit ?? "").trim();
  if (explicit !== "" && explicit !== "all" && validProject(explicit)) return explicit;
  // Kew floras are the ones whose id starts with k-. Prefer the first valid one in the list.
  for (const project of projects ?? []) {
    const id = projectId(project);
    if (id.startsWith("k-") && validProject(id)) return id;
  }
  if (fallback && validProject(fallback)) return fallback;
  return "all";
}

/** `[n, ok]`. ok is false when remainingIdentificationRequests is absent or not an integer. */
// The quota response. ok false means "we do not know the balance", so plan will not hold credits back.
export function remainingIdentifications(body) {
  let doc;
  try {
    doc = JSON.parse(asText(body));
  } catch {
    return [0, false];
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || !Object.hasOwn(doc, "remainingIdentificationRequests")) {
    return [0, false];
  }
  const value = doc.remainingIdentificationRequests;
  if (typeof value !== "number" || !Number.isInteger(value)) return [0, false];
  return [value, true];
}

/** Milliseconds until the next 00:00 UTC, at least one minute. */
// The cached quota and flora list live until the credits reset. Never cache them for under a minute.
export function untilUTCMidnight(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  let delta = next - date.getTime();
  if (delta < 60_000) delta = 60_000;
  return delta;
}

// The genus plus species, lowercased. A hybrid marked with × keeps the next two words when they exist.
// Catalog matching uses this so "Ficus lyrata L." and "Ficus lyrata" are the same plant. Returns "" for a blank name.
export function binomial(name) {
  const fields = String(name ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (fields.length >= 2 && fields[0] === "\u00d7") {
    if (fields.length >= 3) return `${fields[0]} ${fields[1]} ${fields[2]}`;
    return fields.join(" ");
  }
  if (fields.length >= 2) return `${fields[0]} ${fields[1]}`;
  if (fields.length === 1) return fields[0];
  return "";
}

// String, buffer, or already-parsed JSON, as text for JSON.parse.
function asText(body) {
  if (typeof body === "string") return body;
  if (body == null) return "";
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  return JSON.stringify(body);
}
