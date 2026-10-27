// This file builds a bulk quotation and emails it to the store.
// A customer lists plants, quantities, and delivery details. Staff receive
// the estimate by email, and the customer gets the same estimate back as JSON.

import { Op } from "sequelize";
import { decode, error, json } from "../../pkg/httpjson/httpjson.js";
import { parseToken } from "../auth/jwt.js";
import { clientIP } from "../middlewares/ip.js";
import { tenDigitIN } from "../phoneutil/phone.js";
import { Product, ProductSize, User } from "../models/index.js";
import { newEmailService } from "../services/email.js";
import { finalize, formatQuantity, formatRupees, quotationItemCode } from "../services/quotation.js";

// A quotation cannot list more plants than this.
const maxQuotationLines = 200;
// One line cannot ask for more units than this.
const maxQuotationQuantity = 100000;
const quotationUnit = "Nos";
const pincodePattern = /^[1-9][0-9]{5}$/;
const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// Shortens text to a character limit.
function clip(s, max) {
  const text = String(s ?? "").trim();
  const runes = [...text];
  return runes.length > max ? runes.slice(0, max).join("") : text;
}

// Collapses extra spaces and shortens text so a field stays on one line.
function oneLine(s, max) {
  return clip(String(s ?? "").trim().split(/\s+/).filter(Boolean).join(" "), max);
}

// The current India date and time, split into parts for the estimate number.
function istParts(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23", weekday: "short",
  });
  return Object.fromEntries(fmt.formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
}

// The next estimate number for this month, such as GMQ-2610-0007.
// Redis counts them in order. Without Redis, the number uses the time of day.
export async function nextEstimateNo(req, now) {
  const p = istParts(now);
  const prefix = `GMQ-${String(p.year).slice(-2)}${p.month}`;
  if (this.redis) {
    try {
      const key = `quotation:seq:${p.year}${p.month}`;
      const n = await this.redis.incr(key);
      // The first number of the month starts a key that expires after about 40 days.
      if (n === 1) await this.redis.expire(key, 40 * 24 * 3600).catch(() => {});
      return `${prefix}-${String(n).padStart(4, "0")}`;
    } catch { /* time-based suffix */ }
  }
  return `${prefix}-${p.day}${p.hour}${p.minute}`;
}

// The signed-in customer's id, or blank when the quotation is from a guest.
function quotationUserID(req) {
  const auth = req.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return "";
  try {
    const claims = parseToken(this.cfg.jwtSecret, auth.slice("Bearer ".length));
    return claims?.userId ? String(claims.userId) : "";
  } catch {
    return "";
  }
}

// Yes or No for the delivery, loading, and plantation ticks on the email.
function yesNo(v) {
  return v ? "Yes" : "No";
}

// Pulls a plain email address out of text, including an address written as Name <email>.
function parseMailbox(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const angle = raw.match(/<([^<>]+)>/);
  const addr = (angle ? angle[1] : raw).trim();
  if (/\s/.test(addr)) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return null;
  return addr;
}

// Turns a browser user-agent string into a short line such as "Chrome on Android (Mobile)".
export function describeUserAgent(ua) {
  ua = String(ua || "");
  let os = "";
  if (ua.includes("Android")) os = "Android";
  else if (ua.includes("iPhone")) os = "iPhone";
  else if (ua.includes("iPad")) os = "iPad";
  else if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Mac OS X") || ua.includes("Macintosh")) os = "macOS";
  else if (ua.includes("CrOS")) os = "ChromeOS";
  else if (ua.includes("Linux")) os = "Linux";
  let browser = "";
  if (ua.includes("Edg/")) browser = "Edge";
  else if (ua.includes("OPR/") || ua.includes("Opera")) browser = "Opera";
  else if (ua.includes("SamsungBrowser")) browser = "Samsung Internet";
  else if (ua.includes("Firefox/") || ua.includes("FxiOS")) browser = "Firefox";
  else if (ua.includes("Chrome/") || ua.includes("CriOS")) browser = "Chrome";
  else if (ua.includes("Safari/")) browser = "Safari";
  let device = "Desktop";
  if (ua.includes("Mobile") || os === "Android" || os === "iPhone") device = "Mobile";
  if (os === "iPad" || (os === "Android" && !ua.includes("Mobile"))) device = "Tablet";
  if (browser && os) return `${browser} on ${os} (${device})`;
  if (os) return `${os} (${device})`;
  return browser;
}

// Adds a titled block to the email only when at least one detail has a value.
function addSection(meta, title, details) {
  const kept = [];
  for (const d of details) {
    const value = String(d.value ?? "").trim();
    if (value) kept.push({ label: d.label, value });
  }
  if (kept.length) meta.sections.push({ title, details: kept });
}

// Joins address parts and cleans up extra commas from blank pieces.
function joinPlace(parts) {
  let addr = parts.join(", ");
  addr = addr.replace(/^[, ]+|[, ]+$/g, "");
  return addr.replaceAll(", , ", ", ");
}

// A date in India written as day-month-year for the account section of the email.
function formatDMY(date) {
  const p = istParts(new Date(date));
  return `${p.day}-${p.month}-${p.year}`;
}

// The moment the quotation was sent, written in India time for the email.
function formatSubmitted(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
  }).formatToParts(date);
  const g = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return `${g.weekday}, ${g.day} ${g.month} ${g.year} ${g.hour}:${g.minute}:${g.second} ${String(g.dayPeriod || "").toUpperCase()}`;
}

// Fills the quotation email with who asked, the estimate, the account, and the device.
export async function addQuotationDetails(req, meta, q, body) {
  const rq = q.requester;
  let requested = 0;
  for (const line of q.lines) if (line.requested) requested++;
  // Who the estimate is for, as they typed it on the form.
  addSection(meta, "Requester", [
    { label: "Name", value: rq.name },
    { label: "Company", value: rq.company },
    { label: "Mobile", value: "+91 " + rq.phone },
    { label: "Email", value: rq.email },
    { label: "Address", value: rq.address },
    { label: "City", value: rq.city },
    { label: "State", value: rq.state },
    { label: "Pincode", value: rq.pincode },
    { label: "GSTIN", value: rq.gstin },
    { label: "Required by", value: rq.requiredBy },
    { label: "Notes", value: rq.notes },
  ]);
  // The estimate number, totals, and which extra services they ticked.
  addSection(meta, "Enquiry", [
    { label: "Estimate No.", value: q.estimateNo },
    { label: "Submitted (IST)", value: formatSubmitted(meta.submitted) },
    { label: "Line items", value: `${q.lines.length} (${q.lines.length - requested} catalog, ${requested} requested)` },
    { label: "Total units", value: formatQuantity(q.totalUnits) },
    { label: "Estimated total", value: formatRupees(q.total) },
    { label: "Delivery", value: yesNo(body.services?.delivery) },
    { label: "Loading", value: yesNo(body.services?.loading) },
    { label: "Plantation", value: yesNo(body.services?.plantation) },
  ]);
  // A signed-in customer also gets their saved account details on the email.
  if (meta.userId) {
    const account = [{ label: "User ID", value: meta.userId }];
    const u = await User.findByPk(meta.userId);
    if (u) {
      let verified = "";
      if (u.phoneVerifiedAt) verified = `Phone verified ${formatDMY(u.phoneVerifiedAt)}`;
      if (u.emailVerified) verified = verified ? `${verified}, email verified` : "email verified";
      account.push(
        { label: "Name", value: u.name },
        { label: "Email", value: u.email || "" },
        { label: "Phone", value: u.phone || "" },
        { label: "Sign-in method", value: u.provider },
        { label: "Verified", value: verified },
        { label: "Saved address", value: joinPlace([u.addressLine, u.city, u.state, u.pincode, u.country].map((v) => v || "")) },
        { label: "Member since", value: formatDMY(u.createdAt) },
      );
      if (u.latitude != null && u.longitude != null) {
        account.push({ label: "Saved location", value: `${Number(u.latitude).toFixed(5)}, ${Number(u.longitude).toFixed(5)}` });
      }
    }
    addSection(meta, "Account (signed in)", account);
  } else {
    addSection(meta, "Account", [{ label: "Signed in", value: "No (guest)" }]);
  }
  // Network hints from Cloudflare and the request, so staff can see where it was sent from.
  const hdr = (name) => oneLine(req.get(name), 200);
  const location = joinPlace([hdr("CF-IPCity"), hdr("CF-Region"), hdr("CF-IPCountry")]);
  const lat = hdr("CF-IPLatitude");
  const lon = hdr("CF-IPLongitude");
  addSection(meta, "Network", [
    { label: "IP address", value: meta.ip },
    { label: "Forwarded for", value: hdr("X-Forwarded-For") },
    { label: "IP location", value: location },
    { label: "IP postal code", value: hdr("CF-Postal-Code") },
    { label: "IP coordinates", value: lat && lon ? `${lat}, ${lon}` : "" },
    { label: "IP timezone", value: hdr("CF-Timezone") },
    { label: "Cloudflare ray", value: hdr("CF-Ray") },
    { label: "Origin", value: hdr("Origin") },
    { label: "Referer", value: hdr("Referer") },
  ]);
  const c = body.client || {};
  let platform = hdr("Sec-CH-UA-Platform");
  if (!platform) platform = oneLine(c.platform, 60);
  const languages = oneLine(c.languages, 120) || hdr("Accept-Language");
  addSection(meta, "Device", [
    { label: "Device", value: describeUserAgent(meta.userAgent) },
    { label: "Platform", value: String(platform).replaceAll('"', "") },
    { label: "Screen", value: oneLine(c.screen, 40) },
    { label: "Window", value: oneLine(c.viewport, 40) },
    { label: "Language", value: languages },
    { label: "Device timezone", value: oneLine(c.timezone, 60) },
    { label: "Device time", value: oneLine(c.localTime, 60) },
    { label: "Page", value: oneLine(c.page, 300) },
    { label: "Came from", value: oneLine(c.referrer, 300) },
    { label: "User agent", value: meta.userAgent },
  ]);
}

// Accepts a bulk quotation, prices the catalog plants, and emails the estimate to the store.
export async function createQuotation(req, res) {
  const body = decode(req, res);
  if (!body) return;
  // A filled hidden website field means a bot. Real customers leave it blank.
  if (String(body.website || "").trim()) {
    error(res, 400, "invalid request");
    return;
  }
  const requester = {
    name: oneLine(body.name, 100),
    company: oneLine(body.company, 120),
    phone: tenDigitIN(body.phone),
    email: oneLine(body.email, 160),
    gstin: oneLine(body.gstin, 15).toUpperCase(),
    address: oneLine(body.address, 300),
    city: oneLine(body.city, 80),
    state: oneLine(body.state, 60),
    pincode: oneLine(body.pincode, 6),
    requiredBy: oneLine(body.requiredBy, 40),
    notes: clip(body.notes, 1500),
  };
  if ([...requester.name].length < 2) {
    error(res, 400, "Please enter your name.");
    return;
  }
  if (!requester.phone) {
    error(res, 400, "Please enter a valid 10-digit mobile number.");
    return;
  }
  if ([...requester.address].length < 5) {
    error(res, 400, "Please enter the delivery address.");
    return;
  }
  if (requester.pincode && !pincodePattern.test(requester.pincode)) {
    error(res, 400, "Please enter a valid 6-digit pincode.");
    return;
  }
  if (requester.gstin && !gstinPattern.test(requester.gstin)) {
    error(res, 400, "Please enter a valid 15-character GSTIN, or leave it blank.");
    return;
  }
  if (requester.email) {
    const parsed = parseMailbox(requester.email);
    if (!parsed) {
      error(res, 400, "Please enter a valid email address.");
      return;
    }
    requester.email = parsed;
  }
  // Catalog lines are grouped by plant and size so the same pair is not listed twice.
  const quantities = new Map();
  const order = [];
  for (const it of body.items || []) {
    const productId = Number(it?.productId) || 0;
    const quantity = Number(it?.quantity) || 0;
    if (!productId || quantity <= 0) continue;
    const sizeId = Number(it?.sizeId) || 0;
    const key = `${productId}:${sizeId}`;
    if (!quantities.has(key)) order.push({ productId, sizeId, key });
    quantities.set(key, Math.min((quantities.get(key) || 0) + quantity, maxQuotationQuantity));
  }
  // Custom lines are plants the customer typed that are not in the shop catalog.
  const custom = [];
  for (const it of body.customItems || []) {
    const name = oneLine(it?.name, 120);
    const quantity = Number(it?.quantity) || 0;
    if ([...name].length < 2 || quantity <= 0) continue;
    custom.push({
      name,
      size: oneLine(it?.size, 40),
      quantity: Math.min(quantity, maxQuotationQuantity),
      unit: quotationUnit,
      requested: true,
    });
  }
  if (order.length + custom.length === 0) {
    error(res, 400, "Add at least one plant with a quantity.");
    return;
  }
  if (order.length + custom.length > maxQuotationLines) {
    error(res, 400, `A quotation can include up to ${maxQuotationLines} plants.`);
    return;
  }
  // Load current names and prices so the email does not trust the prices the browser sent.
  const byID = new Map();
  if (order.length) {
    try {
      const products = await Product.findAll({
        attributes: ["id", "name", "price"],
        where: { id: { [Op.in]: order.map((k) => k.productId) } },
        include: [{ model: ProductSize, as: "sizes", attributes: ["id", "label", "price", "productId"] }],
        order: [[{ model: ProductSize, as: "sizes" }, "id", "ASC"]],
      });
      for (const p of products) byID.set(Number(p.id), p);
    } catch (err) {
      console.log(`[QUOTATION] product lookup failed: ${err.message || err}`);
      error(res, 500, "Could not prepare the quotation. Please try again.");
      return;
    }
  }
  const lines = [];
  for (const k of order) {
    const p = byID.get(k.productId);
    // A plant that left the catalog is dropped from the estimate.
    if (!p) continue;
    const line = {
      itemCode: quotationItemCode(p.id, k.sizeId),
      name: p.name,
      quantity: quantities.get(k.key),
      unit: quotationUnit,
      rate: p.price,
    };
    if (k.sizeId) {
      const size = (p.sizes || []).find((s) => Number(s.id) === k.sizeId);
      if (!size) continue;
      line.size = size.label;
      line.rate = size.price;
    }
    lines.push(line);
  }
  lines.push(...custom);
  if (!lines.length) {
    error(res, 400, "The selected plants are no longer available. Please refresh and try again.");
    return;
  }
  const now = new Date();
  let place = [requester.city, requester.state].filter(Boolean).join(", ");
  if (!place) place = requester.address;
  // Freight, loading, and plantation are requested services. Their amounts are filled in later by staff.
  let q = {
    estimateNo: await this.nextEstimateNo(req, now),
    date: (() => { const p = istParts(now); return `${p.day}-${p.month}-${p.year}`; })(),
    placeOfSupply: place,
    requester,
    lines,
    charges: [
      { label: "Freight Charges", requested: Boolean(body.services?.delivery), amount: null },
      { label: "Loading & Unloading", requested: Boolean(body.services?.loading), amount: null },
      { label: "Plantation Labour Charges", requested: Boolean(body.services?.plantation), amount: null },
    ],
  };
  const finished = finalize(q);
  if (finished) q = finished;
  // The quotation email cannot go out until the store mailbox and SMTP login are set.
  const to = String(this.cfg.quotationEmail || "").trim();
  if (!to || !this.cfg.smtpEmail || !this.cfg.smtpPassword) {
    console.log(`[QUOTATION] email not configured; enquiry ${q.estimateNo} from ${requester.phone} not sent`);
    error(res, 503, "Quotation email is unavailable right now. Please call the store.");
    return;
  }
  const meta = {
    userId: quotationUserID.call(this, req),
    ip: clientIP(req),
    userAgent: oneLine(req.get("User-Agent"), 300),
    submitted: now,
    sections: [],
  };
  await this.addQuotationDetails(req, meta, q, body);
  // Email the finished estimate to the store. The customer is told if that send fails.
  try {
    await this.emailService().sendQuotationEnquiry(to, q, meta);
  } catch (err) {
    console.log(`[QUOTATION] email failed for ${q.estimateNo}: ${err.message || err}`);
    error(res, 502, "We couldn't send your quotation. Please try again or call the store.");
    return;
  }
  // A short summary is saved on the account and a notice is sent when they are signed in.
  let summary = requester.name;
  if (q.lines.length) {
    summary = q.lines[0].name;
    if (q.lines.length > 1) summary = `${q.lines[0].name} and ${q.lines.length - 1} more`;
  }
  await this.saveQuoteRequest(req, requester.name, requester.phone, requester.email, summary, q.estimateNo, q.total);
  json(res, 201, q);
}
