// Who is on the site, and whether that visit is a person worth alerting staff about.
// Request handlers call capture. The visitor alert calls lookupPlace, datacenter, and claimVisitor.
// Location lookups use ipwho.is, are cached for six hours, and stay quiet when the network is a datacenter.

import { isIP } from "node:net";
import { exactIP, isPublicIP } from "../middlewares/ip.js";
import { field, mapsURL } from "./discord.js";

const botUA =
  /(?:\bbot\b|\bcrawler\b|\bspider\b|crawling|facebookexternalhit|linkedinbot|twitterbot|slackbot|slack-imgproxy|discordbot|googlebot|bingbot|duckduckbot|baiduspider|yandexbot|applebot|wget\/|curl\/|python-requests|python-urllib|python-httpx|aiohttp|java\/|go-http-client|axios|node-fetch|okhttp|libwww|zgrab|nmap|nikto|nuclei|sqlmap|masscan|censys|shodan|gptbot|chatgpt-user|claudebot|anthropic-ai|amazonbot|perplexitybot|bytespider|petalbot|semrush|ahrefs|mj12bot|headless|phantomjs|puppeteer|playwright|scrapy|postmanruntime|insomnia|uptimerobot|pingdom|googlehc|kube-probe|datadogagent|newrelic)/i;

const placeTTLMs = 6 * 60 * 60 * 1000;
const placeFailTTLMs = 10 * 60 * 1000;
const placeCacheMax = 1024;
const visitorClaimTTLMs = 24 * 60 * 60 * 1000;
const visitorClaimMax = 4096;
const placeTimeoutMs = 1500;

const datacenterASN = new Set([
  16509, 14618, 15169, 396982, 8075, 8068, 14061, 16276, 24940, 213230, 63949, 20473, 51167, 9009,
  60068, 212238, 36352, 13335, 132203, 45090, 45102, 37963, 53667, 398101, 398722,
]);

const datacenterNames = [
  "amazon",
  "aws",
  "google cloud",
  "google llc",
  "microsoft azure",
  "azure",
  "digitalocean",
  "hetzner",
  "ovh sas",
  "ovhcloud",
  "linode",
  "oracle cloud",
  "cloudflare",
  "vultr",
  "choopa",
  "contabo",
  "datacamp",
  "m247",
  "colocrossing",
  "quadranet",
  "psychz",
  "leaseweb",
  "scaleway",
  "upcloud",
  "alibaba",
  "tencent cloud",
  "huawei cloud",
];

const placeCache = new Map();
const placeInflight = new Map();
const visitorSeen = new Map();

// Reads the browser headers we keep with an order or a visit. Screen fields stay empty until the client sends them.
// Returns a plain object. A missing request is a blank visit, not an error.
export function capture(req) {
  if (!req) return blankNet();
  return {
    ip: exactIP(req),
    userAgent: userAgent(req),
    language: headerValue(req, "Accept-Language"),
    platform: trimQuotes(headerValue(req, "Sec-CH-UA-Platform")),
    model: trimQuotes(headerValue(req, "Sec-CH-UA-Model")),
    secCHUA: headerValue(req, "Sec-CH-UA"),
    secFetchMode: headerValue(req, "Sec-Fetch-Mode"),
    referer: headerValue(req, "Referer"),
    forwardedFor: headerValue(req, "X-Forwarded-For"),
    screen: "",
    viewport: "",
    timezone: "",
    languages: "",
    cores: 0,
    touch: 0,
  };
}

// Short or scripted clients, and calls that did not come from a browser fetch.
// True for bots, short user agents, and requests that are not a normal page or fetch.
export function automatedVisitor(n) {
  const ua = String(n?.userAgent ?? "").trim();
  // A very short agent, or one that names a bot or a script, is not a shopper.
  if (ua.length < 20 || botUA.test(ua)) return true;
  switch (String(n?.secFetchMode ?? "").toLowerCase()) {
    case "cors":
    case "navigate":
    case "same-origin":
      break;
    default:
      // Missing or unusual fetch mode means the call did not come from a normal page load.
      return true;
  }
  // A browser always sends a language. An empty one is another sign this is not a person.
  return String(n?.language ?? "").trim() === "";
}

// "City, region PIN, country" for a location card. Empty parts are skipped.
export function label(place) {
  let locality = [place?.city, place?.region]
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join(", ");
  const pin = String(place?.postal ?? "").trim();
  if (pin && locality) locality += ` ${pin}`;
  else if (pin) locality = pin;
  let country = String(place?.country ?? "").trim();
  if (!country) country = String(place?.countryCode ?? "").trim();
  return [locality, country].filter(Boolean).join(", ");
}

// "lat, lng" with six decimals, or "" when the lookup had no coordinates.
export function coordText(place) {
  if (!place?.hasCoord) return "";
  return `${place.lat.toFixed(6)}, ${place.lng.toFixed(6)}`;
}

// A maps link, or "" when there is no coordinate to open.
export function mapsLink(place) {
  if (!place?.hasCoord) return "";
  return mapsURL(place.lat, place.lng, "");
}

// One line: ISP, ASN, organisation, and flags such as VPN or datacenter.
export function networkText(place) {
  const parts = [];
  const isp = String(place?.isp ?? "").trim();
  if (isp) parts.push(isp);
  if (place?.asn > 0) parts.push(`AS${place.asn}`);
  const org = String(place?.org ?? "").trim();
  if (org && org.toLowerCase() !== isp.toLowerCase()) parts.push(org);
  if (place?.hosting) parts.push("datacenter");
  if (place?.vpn) parts.push("VPN");
  if (place?.proxy) parts.push("proxy");
  if (place?.tor) parts.push("Tor");
  return parts.join(" · ");
}

// A VPN on a residential ISP is still a person. Hosting, Tor, and cloud ASNs are not.
// True when this network should not raise a visitor alert.
export function datacenter(place) {
  if (place?.hosting || place?.tor) return true;
  if (datacenterASN.has(Number(place?.asn) || 0)) return true;
  const blob = `${place?.org ?? ""} ${place?.isp ?? ""}`.toLowerCase();
  for (const needle of datacenterNames) {
    if (needle && blob.includes(needle)) return true;
  }
  return false;
}

// A visitor alert needs coordinates and a network that is not a datacenter.
// Lookup failures stay quiet.
// True only when we should post the alert.
export function allowVisitorAlert(place, err) {
  return !err && Boolean(place?.hasCoord) && !datacenter(place);
}

// Discord fields for where the visit came from. An empty place returns an empty list.
export function locationFields(place) {
  const out = [];
  const where = label(place);
  if (where) out.push(field("Location", where, true));
  if (place?.hasCoord) {
    out.push(field("Coordinates", coordText(place), true));
    out.push(field("Map", mapsLink(place), false));
  }
  const net = networkText(place);
  if (net) out.push(field("Network", net, false));
  const tz = String(place?.timezone ?? "").trim();
  if (tz) out.push(field("IP timezone", tz, true));
  return out;
}

// One line describing the browser, the device, and the screen. Used in the visitor alert.
export function deviceText(n) {
  const parsed = parseUA(n?.userAgent);
  let osName = parsed.osName;
  if (n?.platform) osName = n.platform;
  const parts = [];
  if (parsed.browser && osName) parts.push(`${parsed.browser} on ${osName}`);
  else if (parsed.browser) parts.push(parsed.browser);
  else if (osName) parts.push(osName);
  if (parsed.kind) parts.push(parsed.kind);
  const model = String(n?.model ?? "").trim();
  // Some clients send the single letter "k" as a placeholder model. It is not a device name.
  if (model && model.toLowerCase() !== "k") parts.push(model);
  const screen = String(n?.screen ?? "").trim();
  if (screen) parts.push(`screen ${screen}`);
  const viewport = String(n?.viewport ?? "").trim();
  if (viewport) parts.push(`window ${viewport}`);
  let lang = String(n?.languages ?? "").trim();
  if (!lang) lang = String(n?.language ?? "").trim();
  if (lang) parts.push(lang);
  const tz = String(n?.timezone ?? "").trim();
  if (tz) parts.push(tz);
  if (n?.cores > 0) parts.push(`${n.cores} cores`);
  if (n?.touch > 0) parts.push("touch");
  return parts.join(" · ");
}

// Reserves this IP for one visitor alert inside 24h. A full table returns false.
// False means we already alerted for this IP, or the table is full of live claims.
export function claimVisitor(ip) {
  ip = String(ip ?? "").trim();
  if (!ip) return false;
  const now = Date.now();
  const until = visitorSeen.get(ip);
  // This IP was already alerted and the day has not passed.
  if (until != null && now < until) return false;
  if (visitorSeen.size >= visitorClaimMax) {
    for (const [key, exp] of visitorSeen) {
      if (!(now < exp)) visitorSeen.delete(key);
    }
    if (visitorSeen.size >= visitorClaimMax) return false;
  }
  visitorSeen.set(ip, now + visitorClaimTTLMs);
  return true;
}

// Looks up a public IP. Throws when the address is private or the lookup fails.
// A cached failure is thrown again so we do not hammer the provider. Concurrent lookups share one request.
export async function lookupPlace(ip, signal) {
  const canonical = canonicalIP(ip);
  if (!canonical || !isPublicIP(canonical)) {
    throw new Error("ip is not a public address");
  }
  const cached = cachedPlaceOf(canonical);
  if (cached.hit) {
    if (cached.err) throw new Error(cached.err);
    return cached.place;
  }
  const existing = placeInflight.get(canonical);
  if (existing) return existing;
  const flight = (async () => {
    const again = cachedPlaceOf(canonical);
    if (again.hit) {
      if (again.err) throw new Error(again.err);
      return again.place;
    }
    try {
      const place = await fetchPlace(canonical, signal);
      rememberPlace(canonical, place, null);
      return place;
    } catch (err) {
      rememberPlace(canonical, null, err);
      throw err;
    }
  })();
  placeInflight.set(canonical, flight);
  try {
    return await flight;
  } finally {
    if (placeInflight.get(canonical) === flight) placeInflight.delete(canonical);
  }
}

// A cached place, or a cached failure. hit false means look it up again.
function cachedPlaceOf(ip) {
  const row = placeCache.get(ip);
  if (!row || Date.now() > row.until) return { hit: false };
  if (row.err) return { hit: true, err: row.err };
  return { hit: true, place: row.place };
}

// Remembers a place for six hours, or a failure for ten minutes. A full cache that cannot evict skips the write.
function rememberPlace(ip, place, err) {
  const row = err
    ? { err: "lookup failed", until: Date.now() + placeFailTTLMs }
    : { place, until: Date.now() + placeTTLMs };
  if (placeCache.size >= placeCacheMax) {
    const now = Date.now();
    for (const [key, cached] of placeCache) {
      if (now > cached.until) placeCache.delete(key);
    }
    if (placeCache.size >= placeCacheMax) return;
  }
  placeCache.set(ip, row);
}

// Calls ipwho.is. Throws when the status is not 200 or the body says the lookup failed.
async function fetchPlace(ip, signal) {
  const timeout = AbortSignal.timeout(placeTimeoutMs);
  const signals = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const resp = await fetch(`https://ipwho.is/${ip}`, {
    method: "GET",
    headers: { Accept: "application/json", "User-Agent": "Growman/1.0" },
    redirect: "manual",
    signal: signals,
  });
  const body = await readLimited(resp, 1 << 15);
  if (resp.status !== 200) throw new Error(`ip location status ${resp.status}`);
  let raw;
  try {
    raw = JSON.parse(body.toString("utf8"));
  } catch (err) {
    throw err;
  }
  if (!raw?.success) throw new Error("ip location unavailable");
  const place = {
    city: String(raw.city ?? "").trim(),
    region: String(raw.region ?? "").trim(),
    country: String(raw.country ?? "").trim(),
    countryCode: String(raw.country_code ?? "").trim(),
    postal: String(raw.postal ?? "").trim(),
    timezone: String(raw.timezone?.id ?? "").trim(),
    lat: Number(raw.latitude) || 0,
    lng: Number(raw.longitude) || 0,
    hasCoord: false,
    isp: String(raw.connection?.isp ?? "").trim(),
    org: String(raw.connection?.org ?? "").trim(),
    asn: flexInt(raw.connection?.asn),
    hosting: Boolean(raw.security?.hosting),
    proxy: Boolean(raw.security?.proxy),
    vpn: Boolean(raw.security?.vpn),
    tor: Boolean(raw.security?.tor),
  };
  // A zero pair is not a real pin. Leave hasCoord false so the alert stays quiet.
  if (place.lat !== 0 || place.lng !== 0) place.hasCoord = true;
  return place;
}

// An ASN that may arrive as a number or a numeric string. Blank becomes 0. Non-digits throw.
function flexInt(v) {
  if (v == null || v === "") return 0;
  const s = String(v).trim();
  if (!s || s === "null") return 0;
  if (!/^-?\d+$/.test(s)) throw new Error("invalid asn");
  return Number.parseInt(s, 10);
}

// Reads at most max bytes from a response and cancels the rest.
async function readLimited(resp, max) {
  if (!resp.body) return Buffer.alloc(0);
  const reader = resp.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < max) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.length, max - total);
      chunks.push(Buffer.from(value.subarray(0, take)));
      total += take;
      if (take < value.length) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}

// A rough browser, operating system, and phone-or-desktop label from the user-agent string.
function parseUA(ua) {
  const u = String(ua ?? "").toLowerCase();
  let browser = "";
  let osName = "";
  let kind = "";
  if (u.includes("edg/")) browser = "Edge";
  else if (u.includes("opr/") || u.includes("opera")) browser = "Opera";
  else if (u.includes("samsungbrowser")) browser = "Samsung Internet";
  else if (u.includes("firefox/")) browser = "Firefox";
  else if (u.includes("chrome/") || u.includes("crios/")) browser = "Chrome";
  else if (u.includes("safari/") && !u.includes("chrome/")) browser = "Safari";

  if (u.includes("android")) osName = "Android";
  else if (u.includes("iphone") || u.includes("ipad")) osName = "iOS";
  else if (u.includes("mac os x") || u.includes("macintosh")) osName = "macOS";
  else if (u.includes("windows")) osName = "Windows";
  else if (u.includes("cros")) osName = "ChromeOS";
  else if (u.includes("linux")) osName = "Linux";

  if (u.includes("ipad") || u.includes("tablet")) kind = "tablet";
  else if (u.includes("mobile") || u.includes("iphone") || u.includes("android")) kind = "mobile";
  else if (browser || osName) kind = "desktop";
  return { browser, osName, kind };
}

// The empty visit used when there is no request to read.
function blankNet() {
  return {
    ip: "",
    userAgent: "",
    language: "",
    platform: "",
    model: "",
    secCHUA: "",
    secFetchMode: "",
    referer: "",
    forwardedFor: "",
    screen: "",
    viewport: "",
    timezone: "",
    languages: "",
    cores: 0,
    touch: 0,
  };
}

// One header, from Express or from a plain headers object. Returns a trimmed string.
function headerValue(req, name) {
  let raw = "";
  if (typeof req.get === "function") raw = req.get(name) || "";
  else if (req.headers) {
    const found = Object.keys(req.headers).find((k) => k.toLowerCase() === name.toLowerCase());
    raw = found ? req.headers[found] : "";
    if (Array.isArray(raw)) raw = raw[0] || "";
  }
  return String(raw ?? "").trim();
}

// The user-agent, including the case where the request is not an Express request.
function userAgent(req) {
  if (typeof req.get === "function") return String(req.get("User-Agent") || "");
  const headers = req.headers || {};
  const raw = headers["user-agent"] || headers["User-Agent"] || "";
  return Array.isArray(raw) ? String(raw[0] || "") : String(raw);
}

// Client hints sometimes arrive wrapped in quotes. Those quotes are not part of the value.
function trimQuotes(s) {
  return String(s ?? "")
    .trim()
    .replace(/^"+|"+$/g, "");
}

// A single canonical form of an IP so the cache key does not depend on brackets, a port, or leading zeros.
function canonicalIP(raw) {
  let s = String(raw ?? "")
    .trim()
    .replace(/^["[]+|["\]]+$/g, "");
  s = stripHostPort(s).trim();
  if (s.toLowerCase().startsWith("::ffff:")) {
    const v4 = s.slice(7);
    if (isV4(v4)) s = v4;
  }
  if (isV4(s)) return s.split(".").map((p) => String(Number(p))).join(".");
  if (isIP(s) === 6) return compressIPv6(s);
  return "";
}

// True for a dotted IPv4 address with no leading zeros.
function isV4(s) {
  const parts = String(s).split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d+$/.test(p) && p.length <= 3 && !(p.length > 1 && p.startsWith("0")) && Number(p) <= 255);
}

// Drops a trailing :port from an IPv4 host, and unwraps a bracketed IPv6 address.
function stripHostPort(s) {
  if (s.startsWith("[")) {
    const end = s.indexOf("]");
    if (end >= 0) return s.slice(1, end);
    return s;
  }
  const colon = s.lastIndexOf(":");
  if (colon > 0 && s.indexOf(":") === colon && /^\d+$/.test(s.slice(colon + 1)) && s.slice(0, colon).includes(".")) {
    return s.slice(0, colon);
  }
  return s;
}

// Shortens a run of zero groups in an IPv6 address so two spellings of the same address share a cache key.
function compressIPv6(ip) {
  let s = ip.toLowerCase();
  let groups;
  if (s.includes("::")) {
    const [a, b] = s.split("::");
    const left = a ? a.split(":") : [];
    const right = b ? b.split(":") : [];
    const missing = 8 - left.length - right.length;
    groups = [...left, ...Array(Math.max(0, missing)).fill("0"), ...right];
  } else {
    groups = s.split(":");
  }
  groups = groups.map((g) => g.replace(/^0+/, "") || "0");
  if (groups.length !== 8) return groups.join(":");
  let bestStart = -1;
  let bestLen = 0;
  let i = 0;
  while (i < groups.length) {
    if (groups[i] !== "0") {
      i++;
      continue;
    }
    let j = i;
    while (j < groups.length && groups[j] === "0") j++;
    if (j - i > bestLen) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  if (bestLen < 2) return groups.join(":");
  const left = groups.slice(0, bestStart).join(":");
  const right = groups.slice(bestStart + bestLen).join(":");
  return `${left}::${right}`;
}
