// MSG91 phone OTP: widget flow (preferred) and template REST OTP.
// Phone login prefers the widget methods. sendOTP and verifyOTP are the older template flow.
// Widget send returns { reqId, accessToken }. Verify returns an access token. verifyAccessToken returns the phone or email.

const TIMEOUT_MS = 15 * 1000;

// Accepts a raw abort signal or an object that carries one.
function extractSignal(ctx) {
  if (!ctx || typeof ctx !== "object") return undefined;
  if (typeof ctx.aborted === "boolean" && typeof ctx.addEventListener === "function") return ctx;
  if (ctx.signal && typeof ctx.signal.aborted === "boolean" && typeof ctx.signal.addEventListener === "function") {
    return ctx.signal;
  }
  return undefined;
}

// Aborts when the caller cancels or when 15 seconds pass. cancel() clears the timer.
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

// Form encoding used by the access-token check. Space becomes +.
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

// Sorts form fields and joins them. A null value is sent as an empty string.
function encodeQuery(entries) {
  const pairs = entries.map(([key, value]) => [key, value == null ? "" : String(value)]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return pairs.map(([key, value]) => `${queryEscape(key)}=${queryEscape(value)}`).join("&");
}

// Sorts object keys so the JSON body matches the encoder the other service uses.
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

// JSON with sorted keys and <, >, and & escaped.
function goMarshal(value) {
  return JSON.stringify(sortKeys(value)).replace(/[&<>\u2028\u2029]/g, (ch) => {
    const hex = ch.codePointAt(0).toString(16).padStart(4, "0");
    return `\\u${hex}`;
  });
}

// MSG91 sometimes returns the error code as a number and sometimes as a string. Both become text.
function codeString(code) {
  if (code == null) return "";
  if (typeof code === "string") return code;
  if (typeof code === "number" && Number.isInteger(code)) return String(code);
  if (typeof code === "number") return String(code);
  const raw = JSON.stringify(code);
  return raw.replaceAll('"', "");
}

// Turns an MSG91 error object into a sentence. An IP block gets the dashboard hint, because a retry will not help.
function formatMsg91Error(out, raw) {
  const msg = String(out?.message ?? "").trim();
  const code = codeString(out?.code);
  if (msg.toLowerCase() === "ipblocked") {
    return "MSG91 blocked this server IP. In MSG91 dashboard → Authkey / IP security, allow your public IP (or disable IP restriction for this key), then retry.";
  }
  if (msg === "") return raw;
  if (code !== "") return `${msg} (code ${code})`;
  return msg;
}

// The template OTP flow needs both the auth key and a template id.
function configured(client) {
  return client != null && client.authKey !== "" && client.templateID !== "";
}

// The access-token check only needs the auth key.
function authConfigured(client) {
  return client != null && client.authKey !== "";
}

// The widget flow needs the widget id and the widget token, not the SMS template.
function widgetConfigured(client) {
  return client != null && client.widgetID !== "" && client.tokenAuth !== "";
}

// Reads the whole response body. An empty body is an empty buffer.
async function readBody(resp) {
  if (!resp.body) return Buffer.alloc(0);
  return Buffer.from(await resp.arrayBuffer());
}

// Posts JSON and parses an object. An array or a non-JSON body throws. Returns { out, raw, client }.
async function postJSON(ctx, endpoint, payload) {
  const client = this;
  const body = goMarshal(payload);
  const linked = linkSignal(extractSignal(ctx), TIMEOUT_MS);
  try {
    let resp;
    try {
      resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body,
        signal: linked.signal,
      });
    } catch (err) {
      throw err;
    }
    const rawBuf = await readBody(resp);
    const raw = rawBuf.toString("utf8");
    let out;
    try {
      out = JSON.parse(raw);
    } catch (err) {
      throw new Error(`msg91 decode: ${err.message} (body=${raw})`);
    }
    if (!out || typeof out !== "object" || Array.isArray(out)) {
      throw new Error(`msg91 decode: json: cannot unmarshal into Go value (body=${raw})`);
    }
    return { out, raw, client };
  } finally {
    linked.cancel();
  }
}

// Sends a widget OTP to the phone. Returns { reqId, accessToken }.
// An invisible verification can return a token immediately, with no code for the shopper to type.
// Otherwise reqId is what verify and retry must send back.
export async function widgetSendOTP(ctx, phone) {
  if (!widgetConfigured(this)) throw new Error("msg91 widget not configured");
  const { out, raw } = await postJSON.call(
    this,
    ctx,
    "https://control.msg91.com/api/v5/widget/sendOtpMobile",
    { widgetId: this.widgetID, tokenAuth: this.tokenAuth, identifier: phone },
  );
  const accessToken = out["access-token"] ?? "";
  // Already verified (for example a trusted device). There is no code to type.
  if (accessToken !== "" || out.invisibleVerified) {
    return { reqId: "", accessToken: accessToken || String(out.message ?? "") };
  }
  if (out.type !== "success") {
    throw new Error(`msg91 widget send failed: ${formatMsg91Error(out, raw)}`);
  }
  if (String(out.message ?? "").trim() === "") {
    throw new Error(`msg91 widget send missing reqId (body=${raw})`);
  }
  return { reqId: out.message, accessToken: "" };
}

// Checks the code the shopper typed. Returns the access token used to read the phone number.
export async function widgetVerifyOTP(ctx, reqId, otp) {
  if (!widgetConfigured(this)) throw new Error("msg91 widget not configured");
  const { out, raw } = await postJSON.call(this, ctx, "https://control.msg91.com/api/v5/widget/verifyOtp", {
    widgetId: this.widgetID,
    tokenAuth: this.tokenAuth,
    reqId,
    otp,
  });
  const accessToken = out["access-token"] ?? "";
  if (out.type !== "success" && accessToken === "") {
    throw new Error(`msg91 widget verify failed: ${formatMsg91Error(out, raw)}`);
  }
  const token = accessToken || String(out.message ?? "");
  if (token === "") throw new Error(`msg91 widget verify missing access-token (body=${raw})`);
  return token;
}

// Asks MSG91 to send the same code again. channel 11 is SMS, 12 is WhatsApp, 4 is voice, 3 is email.
// 0 becomes SMS. Any other channel throws. Returns the new reqId, or the old one when the body has no message.
export async function widgetRetryOTP(ctx, reqId, channel) {
  if (!widgetConfigured(this)) throw new Error("msg91 widget not configured");
  switch (channel) {
    case 11:
    case 12:
    case 4:
    case 3:
      break;
    case 0:
      // The app sends 0 when it does not care. SMS is the default channel.
      channel = 11;
      break;
    default:
      throw new Error(`unsupported retry channel ${channel} (use 11=SMS, 12=WhatsApp, 4=Voice)`);
  }
  const { out, raw } = await postJSON.call(this, ctx, "https://control.msg91.com/api/v5/widget/retryOtp", {
    widgetId: this.widgetID,
    tokenAuth: this.tokenAuth,
    reqId,
    retryChannel: String(channel),
  });
  if (out.type !== "success") {
    throw new Error(`msg91 widget retry failed: ${formatMsg91Error(out, raw)}`);
  }
  if (String(out.message ?? "").trim() === "") return reqId;
  return out.message;
}

// True for an email, or for a string with at least 10 digits. Used to spot the phone inside a loose response.
function looksLikeIdentifier(value) {
  const s = String(value ?? "").trim();
  if (s.includes("@")) return true;
  let digits = 0;
  for (const ch of s) {
    if (ch >= "0" && ch <= "9") digits += 1;
  }
  return digits >= 10;
}

// First non-empty string among the listed keys. Returns "" when none of them are set.
function stringField(source, keys) {
  if (!source || typeof source !== "object") return "";
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return "";
}

// The phone or email MSG91 verified. It may sit on message, on message.mobile, on data, or on the root.
function extractIdentifier(raw) {
  if (typeof raw.message === "string" && looksLikeIdentifier(raw.message)) return raw.message;
  if (raw.message && typeof raw.message === "object") {
    const fromMessage = stringField(raw.message, ["mobile", "phone", "identifier", "email"]);
    if (fromMessage) return fromMessage;
  }
  const fromData = stringField(raw.data, ["mobile", "phone", "identifier", "email"]);
  if (fromData) return fromData;
  return stringField(raw, ["mobile", "phone", "identifier", "email"]);
}

// Confirms an access token and returns the phone or email it belongs to.
// Auth calls this after the widget says the code was right, so we trust MSG91 for the number, not the app.
export async function verifyAccessToken(ctx, accessToken) {
  if (!authConfigured(this)) throw new Error("msg91 authkey not configured");
  const body = encodeQuery([
    ["authkey", this.authKey],
    ["access-token", accessToken],
  ]);
  const linked = linkSignal(extractSignal(ctx), TIMEOUT_MS);
  try {
    const resp = await fetch("https://control.msg91.com/api/v5/widget/verifyAccessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
      signal: linked.signal,
    });
    const raw = (await readBody(resp)).toString("utf8");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`msg91 widget verify decode: ${err.message} (body=${raw})`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`msg91 widget verify decode: json: cannot unmarshal into Go value (body=${raw})`);
    }
    const type = typeof parsed.type === "string" ? parsed.type : "";
    if (type !== "" && type !== "success") {
      const msg = typeof parsed.message === "string" && parsed.message !== "" ? parsed.message : raw;
      throw new Error(`access token verify failed: ${msg}`);
    }
    const id = extractIdentifier(parsed);
    // A success with no phone or email cannot create an account.
    if (id === "") throw new Error(`msg91 widget verify missing identifier (body=${raw})`);
    return id;
  } finally {
    linked.cancel();
  }
}

// Older template OTP. MSG91 generates the 6-digit code and texts it. The code expires in 10 minutes.
// Returns nothing. Throws when MSG91 does not report success.
export async function sendOTP(ctx, phone) {
  if (!configured(this)) throw new Error("msg91 not configured");
  const url = `https://control.msg91.com/api/v5/otp?${encodeQuery([
    ["template_id", this.templateID],
    ["mobile", phone],
    ["otp_length", "6"],
    ["otp_expiry", "10"],
  ])}`;
  const linked = linkSignal(extractSignal(ctx), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { authkey: this.authKey, "Content-Type": "application/json", Accept: "application/json" },
      signal: linked.signal,
    });
    const raw = (await readBody(resp)).toString("utf8");
    let out;
    try {
      out = JSON.parse(raw);
    } catch (err) {
      throw new Error(`msg91 send decode: ${err.message} (body=${raw})`);
    }
    if (!out || typeof out !== "object") throw new Error(`msg91 send decode: json: cannot unmarshal into Go value (body=${raw})`);
    if (out.type !== "success") throw new Error(`msg91 send failed: ${out.message ?? ""}`);
  } finally {
    linked.cancel();
  }
}

// Checks a template OTP. Returns nothing. Throws when the code is wrong or expired.
export async function verifyOTP(ctx, phone, otp) {
  if (!configured(this)) throw new Error("msg91 not configured");
  const url = `https://control.msg91.com/api/v5/otp/verify?${encodeQuery([
    ["mobile", phone],
    ["otp", otp],
  ])}`;
  const linked = linkSignal(extractSignal(ctx), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { authkey: this.authKey, Accept: "application/json" },
      signal: linked.signal,
    });
    const raw = (await readBody(resp)).toString("utf8");
    let out;
    try {
      out = JSON.parse(raw);
    } catch (err) {
      throw new Error(`msg91 verify decode: ${err.message} (body=${raw})`);
    }
    if (!out || typeof out !== "object") throw new Error(`msg91 verify decode: json: cannot unmarshal into Go value (body=${raw})`);
    if (out.type !== "success") throw new Error(`otp verify failed: ${out.message ?? ""}`);
  } finally {
    linked.cancel();
  }
}

// Attaches the methods so they see this client's keys.
function bind(client) {
  client.widgetSendOTP = widgetSendOTP;
  client.widgetVerifyOTP = widgetVerifyOTP;
  client.widgetRetryOTP = widgetRetryOTP;
  client.verifyAccessToken = verifyAccessToken;
  client.sendOTP = sendOTP;
  client.verifyOTP = verifyOTP;
  return client;
}

// Template-flow client. Widget fields stay empty, so the widget methods refuse to run.
export function createClient(authKey, templateID) {
  return bind({
    authKey: authKey ?? "",
    templateID: templateID ?? "",
    widgetID: "",
    tokenAuth: "",
  });
}

// Widget-flow client. templateID stays empty, so the older sendOTP refuses to run.
export function createWidgetClient(authKey, widgetID, tokenAuth) {
  return bind({
    authKey: authKey ?? "",
    templateID: "",
    widgetID: widgetID ?? "",
    tokenAuth: tokenAuth ?? "",
  });
}
