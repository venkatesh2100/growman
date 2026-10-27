// Shiprocket client. Serviceability fails soft behind a circuit breaker.
// Booking lives in shipments.js and does not use the breaker.
// Checkout calls checkServiceability before it offers courier. A missing setup returns null from createClient.
// Three failures in a row pause lookups for five minutes. That pause means "no answer", not "no courier".

import { createOrder, generateAWB, requestPickup, track } from "./shipments.js";

const DEFAULT_BASE_URL = "https://apiv2.shiprocket.in/v1/external";
const TOKEN_TTL_MS = 9 * 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 4 * 1000;
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 5 * 60 * 1000;

// A named error object so callers can tell "not configured" and "circuit open" from a transport failure.
function sentinel(message, code, name) {
  const err = new Error(message);
  err.name = name;
  err.code = code;
  return err;
}

/** No email/password pair and no JWT. Checkout should skip the lookup. */
export const ErrNotConfigured = sentinel(
  "shiprocket credentials not configured",
  "ERR_NOT_CONFIGURED",
  "ErrNotConfigured",
);

/** Lookups are paused after repeated failures. This is "no answer", not "no courier". */
export const ErrCircuitOpen = sentinel(
  "shiprocket: lookups paused after repeated failures",
  "ERR_CIRCUIT_OPEN",
  "ErrCircuitOpen",
);

// True for the not-configured sentinel, including a copy that only shares the code.
function isNotConfigured(err) {
  return err === ErrNotConfigured || err?.code === ErrNotConfigured.code;
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

// Aborts on the caller's cancel or when ms elapses. Login uses a short budget. Booking uses a longer one.
function linkSignal(parent, ms) {
  const ctrl = new AbortController();
  let timer;
  const onParent = () => {
    if (ctrl.signal.aborted) return;
    const reason = parent.reason ?? new DOMException("This operation was aborted", "AbortError");
    ctrl.abort(reason);
  };
  if (parent) {
    if (parent.aborted) onParent();
    else parent.addEventListener("abort", onParent, { once: true });
  }
  if (ms > 0 && !ctrl.signal.aborted) {
    timer = setTimeout(() => {
      if (!ctrl.signal.aborted) {
        ctrl.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
      }
    }, ms);
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

// One login at a time. A second caller waits for the first so two requests do not both fetch a token.
function withLock(client, fn) {
  const prev = client._lock ?? Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  client._lock = gate;
  return prev.then(fn, fn).finally(() => release());
}

// Prefixes an error and keeps timeout and abort names so the caller can tell a slow Shiprocket from a bad payload.
function wrapErr(prefix, err) {
  const message = err?.message || String(err);
  const wrapped = new Error(`${prefix}${message}`);
  wrapped.cause = err;
  if (err?.name === "TimeoutError" || err?.name === "AbortError") wrapped.name = err.name;
  return wrapped;
}

// A short, single-line slice of a response, for error messages. Longer than 200 bytes is cut.
function snippet(raw) {
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw ?? "");
  const collapsed = text.trim() === "" ? "" : text.split(/\s+/).filter(Boolean).join(" ");
  const bytes = Buffer.from(collapsed, "utf8");
  if (bytes.length > 200) return `${bytes.subarray(0, 200).toString("utf8")}\u2026`;
  if (collapsed === "") return "(empty body)";
  return collapsed;
}

// Sorts object keys so the login and booking bodies are stable.
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

/** encoding/json default: sorted map keys and HTML escaping. */
// The body Shiprocket receives. <, >, and & are escaped the same way as the other encoder.
function goMarshal(value) {
  return JSON.stringify(sortKeys(value)).replace(/[&<>\u2028\u2029]/g, (ch) => {
    const hex = ch.codePointAt(0).toString(16).padStart(4, "0");
    return `\\u${hex}`;
  });
}

// Reads at most `limit` bytes and cancels the rest.
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

// A rate that may be a number or a numeric string. Junk becomes 0 so a bad row does not win as the cheapest.
function flexFloat(value) {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const s = String(value).trim().replaceAll('"', "");
  if (s === "" || s === "null") return 0;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

// Whole days. The fractional part of an estimated delivery is dropped.
function flexInt(value) {
  return Math.trunc(flexFloat(value));
}

// Query encoding for the serviceability URL.
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

// Weight and declared value with a fixed number of decimals, so 1 and 1.00 do not look like different weights.
function formatFixed(n, digits) {
  if (!Number.isFinite(n)) return (0).toFixed(digits);
  return n.toFixed(digits);
}

// True while lookups are paused. After the cooldown, one trial is allowed by dropping the count just under the threshold.
function breakerOpen(client) {
  if (client.failures < BREAKER_THRESHOLD) return false;
  if (Date.now() - client.openedAt >= BREAKER_COOLDOWN_MS) {
    client.failures = BREAKER_THRESHOLD - 1;
    return false;
  }
  return true;
}

// Counts a failed lookup. The third failure records when the pause started.
function recordFailure(client) {
  client.failures += 1;
  if (client.failures >= BREAKER_THRESHOLD) client.openedAt = Date.now();
}

// A successful lookup clears the failure count so one blip does not linger.
function recordSuccess(client) {
  client.failures = 0;
}

// Returns a bearer token. A cached token younger than nine days is reused.
// A configured static JWT is used as-is. Otherwise email and password are posted to /auth/login.
async function authToken(ctx) {
  const client = this;
  if (client == null) throw ErrNotConfigured;
  return withLock(client, async () => {
    if (client.token && Date.now() - client.tokenTime < TOKEN_TTL_MS) return client.token;
    // A JWT from config skips the login call until it is cleared by a 401.
    if (client.staticToken) {
      client.token = client.staticToken;
      client.tokenTime = Date.now();
      return client.token;
    }
    if (!client.email || !client.password) throw ErrNotConfigured;

    const payload = goMarshal({ email: client.email, password: client.password });
    const linked = linkSignal(extractSignal(ctx), DEFAULT_TIMEOUT_MS);
    let resp;
    let raw;
    try {
      try {
        resp = await fetch(`${client.baseURL}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal: linked.signal,
        });
      } catch (err) {
        throw wrapErr("shiprocket: login: ", err);
      }
      raw = await readLimited(resp, 1 << 20);
    } finally {
      linked.cancel();
    }
    if (resp.status !== 200) {
      throw new Error(`shiprocket: login returned ${resp.status}: ${snippet(raw)}`);
    }
    let out;
    try {
      out = JSON.parse(raw.toString("utf8"));
    } catch (err) {
      throw wrapErr("shiprocket: decode login: ", err);
    }
    if (!out || typeof out !== "object" || typeof out.token !== "string" || out.token === "") {
      throw new Error("shiprocket: login returned no token");
    }
    client.token = out.token;
    client.tokenTime = Date.now();
    return client.token;
  });
}

// Authenticated GET. A 401 clears the cached token so the next call logs in again.
// Returns the parsed object. A non-object body throws.
async function get(ctx, token, path) {
  const client = this;
  const linked = linkSignal(extractSignal(ctx), DEFAULT_TIMEOUT_MS);
  let resp;
  let raw;
  try {
    try {
      resp = await fetch(`${client.baseURL}${path}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        signal: linked.signal,
      });
    } catch (err) {
      throw wrapErr("shiprocket: request: ", err);
    }
    raw = await readLimited(resp, 4 << 20);
  } finally {
    linked.cancel();
  }
  if (resp.status === 401) {
    // The token is dead. Drop both the cached login and a static JWT so we do not keep sending it.
    client.token = "";
    client.staticToken = "";
    throw new Error(`shiprocket: unauthorized: ${snippet(raw)}`);
  }
  if (resp.status !== 200) {
    throw new Error(`shiprocket: returned ${resp.status}: ${snippet(raw)}`);
  }
  try {
    const parsed = JSON.parse(raw.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("json: cannot unmarshal into Go value");
    }
    return parsed;
  } catch (err) {
    if (String(err.message || "").startsWith("shiprocket:")) throw err;
    throw wrapErr("shiprocket: decode response: ", err);
  }
}

const BOOKING_TIMEOUT_MS = 25 * 1000;

// Authenticated POST used by booking. Logs in first, then posts. 200 and 201 are success.
// Returns the parsed object. Does not touch the circuit breaker.
async function post(ctx, path, payload) {
  const client = this;
  if (client == null) throw ErrNotConfigured;
  const linked = linkSignal(extractSignal(ctx), BOOKING_TIMEOUT_MS);
  try {
    const token = await client.authToken(linked.signal);
    const body = goMarshal(payload);
    let resp;
    let raw;
    try {
      resp = await fetch(`${client.baseURL}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body,
        signal: linked.signal,
      });
    } catch (err) {
      throw wrapErr("shiprocket: request: ", err);
    }
    raw = await readLimited(resp, 4 << 20);
    if (resp.status === 401) {
      client.token = "";
      client.staticToken = "";
      throw new Error(`shiprocket: unauthorized: ${snippet(raw)}`);
    }
    // Create-order answers 201. Other booking calls answer 200. Anything else is a failure.
    if (resp.status !== 200 && resp.status !== 201) {
      throw new Error(`shiprocket: ${path} returned ${resp.status}: ${snippet(raw)}`);
    }
    try {
      const parsed = JSON.parse(raw.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("json: cannot unmarshal into Go value");
      }
      return parsed;
    } catch (err) {
      if (String(err.message || "").startsWith("shiprocket:")) throw err;
      throw wrapErr(`shiprocket: decode ${path} response: `, err);
    }
  } finally {
    linked.cancel();
  }
}

/**
 * Cheapest courier for a shipment.
 * An empty courier list resolves `{ serviceable: false }` with no error.
 * Transport, auth, and decode problems throw.
 * @param {AbortSignal | { signal?: AbortSignal } | null} ctx
 * @param {{ pickupPincode: string, deliveryPincode: string, weightKg?: number, declaredValue?: number }} shipment
 */
// Checkout calls this. Cash on delivery is off. Weight defaults to half a kilogram.
// A missing pin throws. An open circuit throws ErrCircuitOpen without calling Shiprocket.
// Returns { serviceable, rateINR, courierName, estimatedDays }.
export async function checkServiceability(ctx, shipment) {
  const client = this;
  if (client == null || typeof client.authToken !== "function") throw ErrNotConfigured;
  const pickup = shipment?.pickupPincode ?? "";
  const delivery = shipment?.deliveryPincode ?? "";
  if (pickup === "" || delivery === "") {
    throw new Error("shiprocket: pickup and delivery pincodes are required");
  }
  // A missing weight would ask Shiprocket for a zero-kilo parcel. Half a kilo is the stand-in.
  let weightKg = Number(shipment?.weightKg);
  if (!(weightKg > 0)) weightKg = 0.5;
  if (breakerOpen(client)) throw ErrCircuitOpen;

  let token;
  try {
    token = await client.authToken(ctx);
  } catch (err) {
    // No credentials is not a Shiprocket outage, so it does not open the breaker.
    if (!isNotConfigured(err)) recordFailure(client);
    throw err;
  }

  const query = {
    // Prepaid only. COD serviceability is a different question and we do not offer it.
    cod: "0",
    delivery_postcode: delivery,
    pickup_postcode: pickup,
    weight: formatFixed(weightKg, 2),
  };
  const declared = Number(shipment?.declaredValue);
  if (declared > 0) query.declared_value = formatFixed(declared, 2);
  const keys = Object.keys(query).sort();
  const q = keys.map((key) => `${queryEscape(key)}=${queryEscape(query[key])}`).join("&");
  const path = `/courier/serviceability/?${q}`;

  let body;
  try {
    body = await client.get(ctx, token, path);
  } catch (err) {
    recordFailure(client);
    throw err;
  }
  recordSuccess(client);

  const couriers = body?.data?.available_courier_companies;
  // No companies means the pin is not served. That is an answer, not a failure, so the breaker stays closed.
  if (!Array.isArray(couriers) || couriers.length === 0) {
    return { serviceable: false, rateINR: 0, courierName: "", estimatedDays: 0 };
  }
  let best = couriers[0];
  // The shopper is quoted our zone fee. This rate is what the courier would charge us, so the cheapest one is kept.
  for (const courier of couriers.slice(1)) {
    if (flexFloat(courier?.rate) < flexFloat(best?.rate)) best = courier;
  }
  return {
    serviceable: true,
    rateINR: flexFloat(best?.rate),
    courierName: best?.courier_name ?? "",
    estimatedDays: flexInt(best?.estimated_delivery_days),
  };
}

/**
 * Returns a client, or null when there is neither a credential pair nor a usable JWT.
 * A token that does not start with "eyJ" is ignored (Shiprocket has no static API key).
 */
// Called at startup. Null means checkout skips the live courier check and still quotes from the zone table.
export function createClient(email, password, token) {
  email = String(email ?? "").trim();
  password = String(password ?? "").trim();
  token = String(token ?? "").trim();
  if (token.startsWith("Bearer ")) token = token.slice("Bearer ".length).trim();
  if (token !== "" && !token.startsWith("eyJ")) {
    const length = Buffer.byteLength(token);
    console.log(
      `[SHIPROCKET] ignoring SHIPROCKET_TOKEN: expected a JWT from /auth/login (one starts with "eyJ"), got ${length} characters. ` +
        "Shiprocket issues no static API key — set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD to a dedicated API user instead " +
        "(Settings → API → Configure → Create an API User)",
    );
    token = "";
  }
  const hasCredentials = email !== "" && password !== "";
  if (!hasCredentials && token === "") return null;

  const client = {
    email,
    password,
    staticToken: token,
    baseURL: DEFAULT_BASE_URL,
    token: "",
    tokenTime: 0,
    failures: 0,
    openedAt: 0,
    _lock: Promise.resolve(),
  };
  client.authToken = authToken;
  client.get = get;
  client.post = post;
  client.checkServiceability = checkServiceability;
  client.createOrder = createOrder;
  client.generateAWB = generateAWB;
  client.requestPickup = requestPickup;
  client.track = track;
  return client;
}
