// Android Truecaller login. The app sends an authorization code and a PKCE verifier.
// Auth calls exchangeCode, then userInfo, and signs the shopper in from the phone number on the profile.
// exchangeCode returns an access token. userInfo returns the profile. A missing phone throws.

// Android Truecaller OAuth-with-PKCE code exchange.

const TOKEN_URL = "https://oauth-account-noneu.truecaller.com/v1/token";
const USER_INFO_URL = "https://oauth-account-noneu.truecaller.com/v1/userinfo";
const TIMEOUT_MS = 15 * 1000;

// Accepts a raw abort signal or an object that has one. Returns undefined when there is nothing to cancel on.
function extractSignal(ctx) {
  if (!ctx || typeof ctx !== "object") return undefined;
  if (typeof ctx.aborted === "boolean" && typeof ctx.addEventListener === "function") return ctx;
  if (ctx.signal && typeof ctx.signal.aborted === "boolean" && typeof ctx.signal.addEventListener === "function") {
    return ctx.signal;
  }
  return undefined;
}

// One signal that aborts on the caller's cancel or when ms elapses. cancel() clears the timer.
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

// Form encoding that matches the provider: space is +, and other bytes are percent-encoded in uppercase.
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

// Sorts the form fields so the body is stable. Empty values are sent as empty strings, not omitted.
function encodeQuery(entries) {
  const pairs = entries.map(([key, value]) => [key, value == null ? "" : String(value)]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return pairs.map(([key, value]) => `${queryEscape(key)}=${queryEscape(value)}`).join("&");
}

// Display name from the profile. Accepts either camelCase or the raw Truecaller field names.
// Returns "" when both parts are blank. Auth uses this when creating the user.
export function fullName(profile) {
  if (!profile) return "";
  const parts = [];
  const given = String(profile.givenName ?? profile.given_name ?? "").trim();
  const family = String(profile.familyName ?? profile.family_name ?? "").trim();
  if (given) parts.push(given);
  if (family) parts.push(family);
  return parts.join(" ").trim();
}

// True when this client was built with a client id. Auth skips Truecaller when this is false.
export function configured() {
  return this != null && this.clientID !== "";
}

// Trades the app's code and PKCE verifier for an access token. Called by the Truecaller login route.
// Returns the access token string. Throws when the client id is missing, the HTTP call fails, or no token comes back.
export async function exchangeCode(ctx, code, codeVerifier) {
  if (!configured.call(this)) throw new Error("truecaller client id not configured");
  const body = encodeQuery([
    ["grant_type", "authorization_code"],
    ["client_id", this.clientID],
    ["code", code],
    ["code_verifier", codeVerifier],
  ]);
  const linked = linkSignal(extractSignal(ctx), TIMEOUT_MS);
  try {
    const resp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
      signal: linked.signal,
    });
    const raw = Buffer.from(await resp.arrayBuffer()).toString("utf8");
    let out;
    try {
      out = JSON.parse(raw);
    } catch (err) {
      throw new Error(`truecaller token decode: ${err.message} (body=${raw})`);
    }
    const accessToken = out?.access_token ?? "";
    // A 200 with an empty token is the same failure as an error status. The shopper is not signed in.
    if (resp.status >= 300 || accessToken === "") {
      let msg = out?.error_description || out?.error || raw;
      if (msg == null) msg = raw;
      throw new Error(`truecaller token exchange failed (${resp.status}): ${msg}`);
    }
    return accessToken;
  } finally {
    linked.cancel();
  }
}

// Loads the Truecaller profile for that access token. Auth calls this right after exchangeCode.
// Returns the profile, including a fullName() helper. Throws when the phone number is missing,
// because the shop account is keyed by phone.
export async function userInfo(ctx, accessToken) {
  const linked = linkSignal(extractSignal(ctx), TIMEOUT_MS);
  try {
    const resp = await fetch(USER_INFO_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: linked.signal,
    });
    const raw = Buffer.from(await resp.arrayBuffer()).toString("utf8");
    if (resp.status >= 300) {
      throw new Error(`truecaller userinfo failed (${resp.status}): ${raw}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`truecaller userinfo decode: ${err.message} (body=${raw})`);
    }
    const profile = {
      sub: parsed?.sub ?? "",
      givenName: parsed?.given_name ?? "",
      familyName: parsed?.family_name ?? "",
      phoneNumber: parsed?.phone_number ?? "",
      email: parsed?.email ?? "",
      picture: parsed?.picture ?? "",
    };
    profile.fullName = () => fullName(profile);
    if (String(profile.phoneNumber).trim() === "") {
      throw new Error("truecaller userinfo missing phone_number");
    }
    return profile;
  } finally {
    linked.cancel();
  }
}

// Builds the client the auth handler keeps. Methods use `this.clientID`. Returns the client object.
export function createClient(clientID) {
  const client = { clientID: String(clientID ?? "").trim() };
  client.configured = configured;
  client.exchangeCode = exchangeCode;
  client.userInfo = userInfo;
  return client;
}
