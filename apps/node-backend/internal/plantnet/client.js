// Pl@ntNet v2 client. Identify routes spend the shared daily credit; GET routes do not.
// The scan handler calls identifySpecies, then optionally identifyDiseases and identifyVarieties.
// get is used for the flora list and the remaining-credit check, which do not spend a credit.
// Identify calls return the response text. A non-2xx status throws APIError.

const DEFAULT_BASE_URL = "https://my-api.plantnet.org";
const CLIENT_TIMEOUT_MS = 25 * 1000;
const GET_TIMEOUT_MS = 12 * 1000;
const IDENTIFY_TIMEOUT_MS = 22 * 1000;
const MAX_BODY = 8 << 20;

// A Pl@ntNet HTTP error. status is the code. body is a short clip of the response, safe to log.
export class APIError extends Error {
  constructor(status, body) {
    const text = body ?? "";
    super(text ? `plantnet status ${status}: ${text}` : `plantnet status ${status}`);
    this.name = "APIError";
    this.status = status;
    this.body = text;
  }
}

// Accepts a raw abort signal or an object that carries one.
function extractSignal(ctx) {
  if (!ctx || typeof ctx !== "object") return undefined;
  if (typeof ctx.aborted === "boolean" && typeof ctx.addEventListener === "function") return ctx;
  if (ctx.signal && typeof ctx.signal.aborted === "boolean" && typeof ctx.signal.addEventListener === "function") {
    return ctx.signal;
  }
  return undefined;
}

// Aborts on the caller's cancel or when the budget elapses. The budget never exceeds the client timeout.
function linkSignal(parent, ms) {
  const ctrl = new AbortController();
  let timer;
  const onParent = () => {
    if (ctrl.signal.aborted) return;
    ctrl.abort(parent.reason ?? new DOMException("This operation was aborted", "AbortError"));
  };
  if (parent) {
    if (parent.aborted) onParent();
    else parent.addEventListener("abort", onParent, { once: true });
  }
  const budget = Math.min(ms, CLIENT_TIMEOUT_MS);
  if (budget > 0 && !ctrl.signal.aborted) {
    timer = setTimeout(() => {
      if (!ctrl.signal.aborted) {
        ctrl.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
      }
    }, budget);
    timer.unref?.();
  }
  return {
    signal: ctrl.signal,
    cancel() {
      if (timer) clearTimeout(timer);
      if (parent) parent.removeEventListener("abort", onParent);
    },
  };
}

// Query encoding: space is +, other reserved bytes are percent-encoded.
function queryEscape(value) {
  let out = "";
  for (const byte of Buffer.from(String(value), "utf8")) {
    const unreserved =
      (byte >= 0x30 && byte <= 0x39) ||
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a) ||
      byte === 0x2d ||
      byte === 0x5f ||
      byte === 0x2e ||
      byte === 0x7e;
    if (unreserved) out += String.fromCharCode(byte);
    else if (byte === 0x20) out += "+";
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

// Path encoding. Space is percent-encoded here, not turned into +, because it sits in the URL path.
function pathEscape(value) {
  let out = "";
  for (const byte of Buffer.from(String(value), "utf8")) {
    const unreserved =
      (byte >= 0x30 && byte <= 0x39) ||
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a) ||
      byte === 0x2d ||
      byte === 0x5f ||
      byte === 0x2e ||
      byte === 0x7e;
    if (unreserved) out += String.fromCharCode(byte);
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

// Sorts query pairs so the URL is stable, then joins them.
function encodePairs(pairs) {
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return pairs.map(([key, value]) => `${queryEscape(key)}=${queryEscape(value)}`).join("&");
}

// Flattens a query object or URLSearchParams into pairs. Null values are skipped.
function collectPairs(query) {
  const pairs = [];
  if (!query) return pairs;
  if (query instanceof URLSearchParams) {
    for (const [key, value] of query.entries()) pairs.push([key, value]);
    return pairs;
  }
  if (typeof query === "object") {
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) {
        for (const item of value) if (item != null) pairs.push([key, String(item)]);
      } else if (value != null) pairs.push([key, String(value)]);
    }
  }
  return pairs;
}

// Builds the request URL and always appends the API key. A caller-supplied api-key is dropped so the secret is ours.
function buildURL(client, path, query) {
  const root = String(client.baseURL || "").replace(/\/+$/, "") || DEFAULT_BASE_URL;
  const pairs = collectPairs(query).filter(([key]) => key !== "api-key");
  pairs.push(["api-key", client.apiKey]);
  const full = `${root}${path}?${encodePairs(pairs)}`;
  try {
    // Reject a base that is not a URL. The string above is what is requested,
    // so a search-param rewrite cannot change the escaping.
    // eslint-disable-next-line no-new
    new URL(full);
  } catch (err) {
    throw err;
  }
  return full;
}

// Shortens an error body so a huge HTML page is not stored on the error.
function clip(buf, limit) {
  let text = buf.toString("utf8").trim().replaceAll("\n", " ");
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length > limit) text = bytes.subarray(0, limit).toString("utf8");
  return text;
}

// Reads at most `limit` bytes. The rest of the body is cancelled.
async function readLimited(resp, limit) {
  if (!resp.body) return Buffer.alloc(0);
  const reader = resp.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.length) continue;
    const room = limit - total;
    if (value.length > room) {
      chunks.push(Buffer.from(value.subarray(0, room)));
      total += room;
      try {
        await reader.cancel();
      } catch {
        /* already closed */
      }
      break;
    }
    chunks.push(Buffer.from(value));
    total += value.length;
  }
  return Buffer.concat(chunks, total);
}

// One HTTP call. Returns the body text. A status outside 200–299 throws APIError with a clipped body.
async function doRequest(req, timeoutMs) {
  const linked = linkSignal(req.signal, timeoutMs);
  try {
    const resp = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: linked.signal,
    });
    const raw = await readLimited(resp, MAX_BODY);
    // Anything outside 2xx is an API error. The body is clipped so a long page is not thrown around.
    if (resp.status < 200 || resp.status >= 300) {
      throw new APIError(resp.status, clip(raw, 180));
    }
    return raw.toString("utf8");
  } finally {
    linked.cancel();
  }
}

// Stops the call when the API key was not configured. Identify and GET both require it.
function requireKey(client) {
  if (client == null || !client.apiKey) throw new Error("plantnet api key is empty");
}

// Posts the photos as multipart. Each photo gets an organ, defaulting to auto when the caller did not name one.
// Returns the response text. Throws when there are no photos.
async function identify(client, ctx, path, fileField, req, photos) {
  requireKey(client);
  if (!photos?.length) throw new Error("no photos");
  const form = new FormData();
  photos.forEach((photo, index) => {
    // A missing organ is "auto" so Pl@ntNet decides leaf, flower, fruit, or bark.
    let organ = "auto";
    const candidate = req.organs?.[index];
    if (typeof candidate === "string" && candidate !== "") organ = candidate;
    form.append("organs", organ);
    // Quotes and backslashes in a filename would break the multipart part.
    let filename = photo?.filename || "plant.jpg";
    filename = filename.replaceAll("\\", "").replaceAll('"', "");
    const contentType = photo?.contentType || "image/jpeg";
    const bytes = photo?.bytes == null ? new Uint8Array() : photo.bytes;
    form.append(fileField, new Blob([bytes], { type: contentType }), filename);
  });
  const query = {};
  if (req.lang) query.lang = req.lang;
  if (req.nbResults > 0) query["nb-results"] = String(req.nbResults);
  if (req.includeRelatedImages) query["include-related-images"] = "true";
  if (req.noReject) query["no-reject"] = "true";
  if (req.detailed) query.detailed = "true";
  const url = buildURL(client, path, query);
  return doRequest(
    {
      url,
      method: "POST",
      headers: { Accept: "application/json" },
      body: form,
      signal: extractSignal(ctx),
    },
    IDENTIFY_TIMEOUT_MS,
  );
}

// Species identify. This is the call that spends a credit. project defaults to "all".
// Returns the response text. The scan handler parses it with topSpecies.
export async function identifySpecies(ctx, req = {}, photos) {
  requireKey(this);
  const project = req.project || "all";
  return identify(this, ctx, `/v2/identify/${pathEscape(project)}`, "images", req, photos);
}

// Disease identify. Spends another credit. The file field name is "image", not "images".
export async function identifyDiseases(ctx, req = {}, photos) {
  return identify(this, ctx, "/v2/diseases/identify", "image", req, photos);
}

// Variety identify. Spends another credit. Returns the response text.
export async function identifyVarieties(ctx, req = {}, photos) {
  return identify(this, ctx, "/v2/varieties/identify", "images", req, photos);
}

// A GET that does not spend an identify credit. Flora list and quota use this. Returns the response text.
export async function get(ctx, path, query) {
  requireKey(this);
  const url = buildURL(this, path, query);
  return doRequest(
    {
      url,
      method: "GET",
      headers: { Accept: "application/json" },
      signal: extractSignal(ctx),
    },
    GET_TIMEOUT_MS,
  );
}

/** @param {string} [baseURL] overrides my-api.plantnet.org when set */
// Returns the client the scan handler keeps. An empty key still builds the client; the first call throws.
export function createClient(apiKey, baseURL = "") {
  const client = {
    apiKey: String(apiKey ?? "").trim(),
    baseURL: String(baseURL ?? "").trim(),
  };
  client.identifySpecies = identifySpecies;
  client.identifyDiseases = identifyDiseases;
  client.identifyVarieties = identifyVarieties;
  client.get = get;
  return client;
}
