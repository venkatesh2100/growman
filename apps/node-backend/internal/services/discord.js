// Staff alerts posted to a Discord webhook. Email is the fallback when Discord rejects the post.
// Order, payment, and visitor handlers call postDiscord. field and mapsURL build the embed.
// The webhook URL is a secret. Errors never include it.

export const colorGreen = 0x1f7a4d;
export const colorOrange = 0xe67e22;
export const colorRed = 0xc0392b;
export const colorBlue = 0x1d6fbf;
export const colorPurple = 0x8e44ad;
export const colorSlate = 0x546e7a;

const discordTimeoutMs = 8000;

// Discord rejects empty values, so a blank value is shown as an em dash.
// Callers pass the label, the text, and whether the field sits beside the next one.
export function field(name, value, inline) {
  let text = String(value ?? "").trim();
  if (!text) text = "—";
  return { name, value: text, inline: Boolean(inline) };
}

// Google Maps search link for a coordinate pair, or a postal address when
// no coordinates were captured.
// Returns "" when there is neither a real coordinate nor an address.
export function mapsURL(lat, lng, address) {
  // 0,0 is not a captured location. Fall through to the street address when we have one.
  if (isCoord(lat) && isCoord(lng) && (lat !== 0 || lng !== 0)) {
    return (
      "https://www.google.com/maps/search/?api=1&query=" +
      formatCoord(lat) +
      "," +
      formatCoord(lng)
    );
  }
  const collapsed = String(address ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
  if (!collapsed) return "";
  return "https://www.google.com/maps/search/?api=1&query=" + queryEscape(collapsed);
}

// Embed colour from the subject line. Paid is green, cancel and abandon are orange, urgent is red.
// Anything else is blue. Browse is purple. Account erasure is slate.
export function colorFor(subject) {
  const s = String(subject ?? "").toLowerCase();
  if (s.includes("dispute") || s.includes("urgent")) return colorRed;
  if (s.includes("cancel") || s.includes("drop") || s.includes("abandon")) return colorOrange;
  if (s.includes("paid")) return colorGreen;
  if (s.includes("browse")) return colorPurple;
  if (s.includes("eras")) return colorSlate;
  return colorBlue;
}

// Plain text for the email fallback. Detail is Discord-only.
// Handlers call this when the webhook post fails and the same alert must go by email.
export function plain(msg) {
  let out = "";
  const text = String(msg?.description ?? "").trim();
  const fields = msg?.fields || [];
  if (text) {
    out += text;
    if (fields.length) out += "\n\n";
  }
  for (const row of fields) out += `${row.name}: ${row.value}\n`;
  if (msg?.url) out += `Map: ${msg.url}\n`;
  if (msg?.footer) out += `\n${msg.footer}\n`;
  return out;
}

// Errors never include the webhook URL; the URL is the credential.
// Posts one embed. Throws a short error on a bad URL or a non-2xx response. Returns nothing on success.
export async function postDiscord(webhook, msg, signal) {
  parseDiscordWebhook(webhook);
  const body = buildDiscordPayload(msg);
  try {
    await discordDeliver(webhook, body, signal);
  } catch (err) {
    if (err && Number.isInteger(err.statusCode)) {
      throw new Error(`discord webhook rejected the alert (HTTP ${err.statusCode})`);
    }
    throw new Error("discord webhook post failed");
  }
}

// Rejects anything that is not an https Discord webhook. A user or password in the URL is refused.
function parseDiscordWebhook(raw) {
  let u;
  try {
    u = new URL(String(raw ?? "").trim());
  } catch {
    throw new Error("discord webhook must be an https URL");
  }
  if (u.protocol !== "https:" || u.username || u.password) {
    throw new Error("discord webhook must be an https URL");
  }
  const host = u.hostname.toLowerCase();
  switch (host) {
    case "discord.com":
    case "discordapp.com":
    case "canary.discord.com":
    case "ptb.discord.com":
      break;
    default:
      throw new Error("discord webhook host is not Discord");
  }
  // Only a webhook path. A channel or guild URL is not a place this client can post.
  if (!u.pathname.startsWith("/api/webhooks/")) {
    throw new Error("discord webhook path is not a webhook");
  }
  return u;
}

// Builds the JSON body. Titles, descriptions, and fields are clipped to Discord's limits.
// At most 25 fields. Detail fields are kept in preference to older fields when both would overflow.
function buildDiscordPayload(msg) {
  const embed = {};
  const title = clipRunes(msg?.title || "", 256);
  const description = clipRunes(String(msg?.description ?? "").trim(), 4096);
  const url = String(msg?.url ?? "").trim();
  let color = Number(msg?.color) || 0;
  // A missing colour would render as black. Green is the shop default.
  if (color === 0) color = colorGreen;
  if (title) embed.title = title;
  if (description) embed.description = description;
  if (url) embed.url = url;
  embed.color = color;

  const detail = msg?.detail || [];
  let fields = [...(msg?.fields || []), ...detail];
  // Discord allows 25 fields. Detail is what staff need, so it is kept ahead of older fields.
  if (detail.length > 0 && fields.length > 25) {
    if (detail.length >= 25) fields = detail.slice(0, 25);
    else fields = [...(msg?.fields || []).slice(0, 25 - detail.length), ...detail];
  } else if (fields.length > 25) {
    fields = fields.slice(0, 25);
  }

  const wireFields = [];
  for (const row of fields) {
    let name = clipRunes(String(row?.name ?? "").trim(), 256);
    if (!name) name = "Detail";
    let value = clipRunes(String(row?.value ?? "").trim(), 1024);
    if (!value) value = "—";
    const wire = { name, value };
    if (row?.inline) wire.inline = true;
    wireFields.push(wire);
  }
  if (wireFields.length) embed.fields = wireFields;

  const footer = clipRunes(String(msg?.footer ?? "").trim(), 2048);
  if (footer) embed.footer = { text: footer };

  return Buffer.from(JSON.stringify({ username: "Growman", embeds: [embed] }) + "\n");
}

// Cuts a string to max characters and adds an ellipsis when it had to be cut.
function clipRunes(s, max) {
  if (max <= 0 || !s) return "";
  const runes = Array.from(s);
  if (runes.length <= max) return s;
  if (max === 1) return "…";
  return runes.slice(0, max - 1).join("") + "…";
}

// Posts the body. A status of 300 or more is a failure and keeps the status code on the error.
async function discordDeliver(webhook, body, signal) {
  const timeout = AbortSignal.timeout(discordTimeoutMs);
  const signals = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const resp = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: signals,
  });
  try {
    await discard(resp, 1024);
  } catch {
    /* response body is not part of the result */
  }
  if (resp.status >= 300) {
    const err = new Error(`discord status ${resp.status}`);
    err.statusCode = resp.status;
    throw err;
  }
}

// Reads and drops a little of the response so the connection can close. The body is not used.
async function discard(resp, max) {
  if (!resp.body) return;
  const reader = resp.body.getReader();
  let got = 0;
  try {
    while (got < max) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value?.length || 0;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

// A coordinate must be a finite number. NaN and missing values are not a place on the map.
function isCoord(n) {
  return typeof n === "number" && Number.isFinite(n);
}

// Six decimal places, about ten centimetres, which is enough for a map pin.
function formatCoord(n) {
  return n.toFixed(6);
}

// Query encoding for the maps link. Space becomes +.
function queryEscape(s) {
  const bytes = Buffer.from(s, "utf8");
  let out = "";
  for (const b of bytes) {
    if (b === 0x20) out += "+";
    else if (isUnreserved(b)) out += String.fromCharCode(b);
    else out += `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

// Letters, digits, hyphen, dot, and underscore stay as themselves in the maps query.
function isUnreserved(b) {
  return (
    (b >= 0x30 && b <= 0x39) ||
    (b >= 0x41 && b <= 0x5a) ||
    (b >= 0x61 && b <= 0x7a) ||
    b === 0x2d ||
    b === 0x2e ||
    b === 0x5f
  );
}
