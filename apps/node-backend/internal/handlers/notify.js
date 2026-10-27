// This file tells staff and customers when something important happens.
// Paid orders, dropped checkouts, new accounts, disputes, and long browsing
// sessions go to Discord or to the store email. Customers also get shipped
// and cancelled order emails.

import { QueryTypes } from "sequelize";
import { parseToken } from "../auth/jwt.js";
import { recordPaymentOutcome } from "../metrics/prometheus.js";
import { Order, User } from "../models/index.js";
import { colorFor, field, mapsURL, postDiscord as sendDiscord } from "../services/discord.js";
import { newEmailService } from "../services/email.js";
import {
  allowVisitorAlert,
  automatedVisitor,
  capture,
  claimVisitor,
  deviceText,
  locationFields,
  lookupPlace,
} from "../services/visitor.js";

const colorGreen = 0x1f7a4d;
const colorOrange = 0xe67e22;
const colorBlue = 0x1d6fbf;
const colorPurple = 0x8e44ad;
// One sweep posts at most this many dropped-checkout alerts.
const maxAbandonedEmailsPerSweep = 8;
// A checkout older than this is no longer treated as a fresh drop-off.
const abandonedEmailWindowMs = 45 * 60 * 1000;

// Logged once when Discord is not configured, so the log is not flooded.
let discordUnsetLogged = false;
// The "today so far" line on staff alerts, reused for ten minutes.
let activityText = "";
let activityAt = 0;

// Splits a moment into India date and clock parts.
function istParts(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23", weekday: "short",
  });
  return Object.fromEntries(fmt.formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
}

// Midnight in India for the current day, used as the start of "today" in staff totals.
function istMidnight(now = new Date()) {
  const p = istParts(now);
  return new Date(`${p.year}-${p.month}-${p.day}T00:00:00+05:30`);
}

// A date written in India time for a staff alert.
function formatIST(date, withYear, withSeconds = false) {
  const p = istParts(new Date(date));
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mon = months[Number(p.month) - 1];
  const clock = withSeconds ? `${p.hour}:${p.minute}:${p.second}` : `${p.hour}:${p.minute}`;
  if (withYear) return `${p.day} ${mon} ${p.year} ${clock} IST`;
  return `${p.day} ${mon} ${clock} IST`;
}

// A dash when a staff-alert field would otherwise be blank.
function orDash(value) {
  return String(value || "").trim() ? String(value) : "—";
}

// The plain-text version of a staff alert, used when it is sent by email instead of Discord.
function plainMessage(msg) {
  if (typeof msg?.plain === "function") return msg.plain();
  let text = "";
  const desc = String(msg?.description || "").trim();
  if (desc) {
    text += desc;
    if (msg.fields?.length) text += "\n\n";
  }
  for (const f of msg.fields || []) text += `${f.name ?? f.Name}: ${f.value ?? f.Value}\n`;
  if (msg.url) text += `Map: ${msg.url}\n`;
  if (msg.footer) text += `\n${msg.footer}\n`;
  return text;
}

// A duration written like "1h2m3s", matching the style of the old alerts.
function goDuration(ms) {
  let seconds = Math.round(ms / 1000);
  if (seconds <= 0) return "0s";
  let out = "";
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;
  if (hours) out += `${hours}h`;
  if (hours || minutes) out += `${minutes}m`;
  out += `${seconds}s`;
  return out;
}

// Reads network details whether they were stored with camelCase or PascalCase names.
function netOf(raw) {
  const n = raw || {};
  return {
    ip: n.ip ?? n.IP ?? "",
    userAgent: n.userAgent ?? n.UserAgent ?? "",
    language: n.language ?? n.Language ?? "",
    platform: n.platform ?? n.Platform ?? "",
    model: n.model ?? n.Model ?? "",
    secCHUA: n.secCHUA ?? n.SecCHUA ?? "",
    secFetchMode: n.secFetchMode ?? n.SecFetchMode ?? "",
    referer: n.referer ?? n.Referer ?? "",
    forwardedFor: n.forwardedFor ?? n.ForwardedFor ?? "",
    screen: n.screen ?? n.Screen ?? "",
    viewport: n.viewport ?? n.Viewport ?? "",
    timezone: n.timezone ?? n.Timezone ?? "",
    languages: n.languages ?? n.Languages ?? "",
    cores: n.cores ?? n.Cores ?? 0,
    touch: n.touch ?? n.Touch ?? 0,
  };
}

// The mailbox that receives store alerts when Discord is not set.
export function merchantEmail() {
  return String(this.cfg.merchantNotifyEmail || "").trim();
}

// The mail sender built from the store's SMTP settings.
export function emailService() {
  return newEmailService(this.cfg.smtpHost, this.cfg.smtpPort, this.cfg.smtpEmail, this.cfg.smtpPassword);
}

// Sends a short staff alert. Discord is preferred. Email is the fallback.
export function notifyMerchantAsync(subject, body) {
  this.dispatchMerchant({ title: subject, description: body, color: colorFor(subject) });
}

// Sends a staff alert to the store mailbox, or to Discord when that is configured.
export function dispatchMerchant(msg) {
  this.dispatchMerchantTo(this.merchantEmail(), msg, "");
}

// Posts a staff alert to Discord, or emails it when Discord is not configured.
// Visitor-only alerts are never emailed.
export function dispatchMerchantTo(emailTo, msg, footer = "") {
  const webhook = String(this.cfg.discordWebhookURL || "").trim();
  if (webhook) {
    void this.postDiscord(webhook, msg, footer).catch((err) => {
      console.log(`[DISCORD] ${thisClip(msg?.title, 80)}: ${err.message || err}`);
    });
    return;
  }
  // Browsing alerts are for Discord only. They are not emailed to the store.
  if (msg?.visitorsOnly) return;
  const body = plainMessage(msg);
  if (!emailTo || !body || !this.cfg.smtpEmail || !this.cfg.smtpPassword) return;
  const subject = msg.title;
  void this.emailService().sendMerchantAlert(emailTo, subject, body).catch((err) => {
    console.log(`[MERCHANT] email failed: ${err.message || err}`);
  });
}

// Posts one Discord alert, adding a map and place when the visitor IP can be located.
export async function postDiscord(webhook, msg, footer = "") {
  const network = netOf(msg.network);
  const ip = String(network.ip || "").trim();
  // A visitor alert with no IP address is not worth posting.
  if (msg.visitorsOnly && !ip) return;
  if (ip) {
    let place = null;
    let placeErr = null;
    try {
      // Give the place lookup a second and a half, then continue without a map.
      place = await Promise.race([
        lookupPlace(ip),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500)),
      ]);
    } catch (err) {
      placeErr = err;
    }
    // Some visitor alerts are skipped when the place looks like a bot or a data center.
    if (msg.visitorsOnly && !allowVisitorAlert(place || {}, placeErr)) return;
    const detail = [field("Exact IP", ip, true)];
    if (!placeErr && place) {
      const located = locationFields(place) || [];
      detail.push(...located);
      const hasCoord = place.hasCoord ?? place.has_coord;
      if (!String(msg.url || "").trim() && hasCoord) {
        msg.url = typeof place.mapsLink === "function" ? place.mapsLink() : mapsURL(place.lat, place.lng, "");
      }
    }
    if (msg.detail?.length) detail.push(...msg.detail);
    msg.detail = detail;
  }
  // The footer is today's signup and order totals, unless the caller already supplied one.
  if (!footer) footer = await this.activityFooter(!msg.visitorsOnly);
  msg.footer = footer;
  try {
    await Promise.race([
      sendDiscord(webhook, msg),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000)),
    ]);
  } catch (err) {
    console.log(`[DISCORD] ${thisClip(msg.title, 80)}: ${err.message || err}`);
  }
}

// Today's signup, checkout, and revenue line, cached for ten minutes.
export async function activityFooter(query) {
  if (activityText && Date.now() - activityAt < 10 * 60 * 1000) return activityText;
  if (!query || !this.sequelize) return "";
  const start = istMidnight();
  try {
    const rows = await this.sequelize.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND created_at >= :start) AS signups,
        (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL AND created_at >= :start) AS checkouts,
        (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL AND status = 'abandoned' AND updated_at >= :start) AS dropped,
        (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL AND payment_status = 'paid' AND created_at >= :start) AS paid,
        (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL AND payment_status = 'failed' AND updated_at >= :start) AS failed,
        (SELECT COALESCE(SUM(amount), 0) FROM orders WHERE deleted_at IS NULL AND payment_status = 'paid' AND created_at >= :start) AS revenue
    `, { replacements: { start }, type: QueryTypes.SELECT });
    const row = rows[0] || {};
    const text = `Today (IST) · ${Number(row.signups) || 0} signups · ${Number(row.checkouts) || 0} checkouts · ${Number(row.dropped) || 0} dropped · ${Number(row.paid) || 0} paid · ${Number(row.failed) || 0} payment failed · ₹${Math.round(Number(row.revenue) || 0)} revenue`;
    activityText = text;
    activityAt = Date.now();
    return text;
  } catch (err) {
    console.log(`[DISCORD] activity snapshot: ${err.message || err}`);
    const text = "Today (IST) · activity unavailable";
    activityText = text;
    activityAt = Date.now();
    return text;
  }
}

// Emails a customer the plants they left in an unfinished checkout.
export async function deliverAbandonedCartEmail(order) {
  const items = order?.items || [];
  if (!order?.customerEmail || !items.length) return null;
  return this.emailService().sendAbandonedCartEmail(order.customerEmail, order.customerName, items.map((item) => item.name), "");
}

// Tells staff a payment dispute was opened, and counts it in the payment metrics.
export function notifyMerchantDispute(paymentID, reason, amount) {
  this.notifyMerchantAsync(
    `URGENT: payment dispute on ${paymentID}`,
    `A payment dispute was opened.

Payment ID: ${paymentID}
Reason: ${reason}
Amount: ₹${Number(amount).toFixed(2)}

Razorpay requires a response before their stated deadline, otherwise the
dispute is decided against us by default. Respond from the Razorpay
dashboard and update the support request raised alongside this alert.`,
  );
  recordPaymentOutcome("disputed");
}

// Emails the customer that an order was cancelled, and alerts staff with the reason.
export async function sendOrderCancelledEmail(order, reason) {
  if (!order?.customerEmail) return;
  const refunded = order.paymentStatus === "paid";
  try {
    await this.emailService().sendOrderCancelledEmail(order.customerEmail, order.customerName, order.id, order.amount, refunded);
  } catch (err) {
    console.log(`[EMAIL] order cancelled: ${err.message || err}`);
  }
  this.notifyMerchantAsync(
    `Order #${order.id} cancelled`,
    `Order #${order.id} (₹${Number(order.amount).toFixed(2)}) was cancelled.\n\nCustomer: ${order.customerName} <${order.customerEmail}>\nReason: ${reason}\nPayment status: ${order.paymentStatus}`,
  );
}

// Emails the customer the courier and tracking number after an order ships.
export async function sendOrderShippedEmail(order) {
  if (!order?.customerEmail || !order?.awbNumber) return;
  const courier = order.courierService || order.courierProvider;
  try {
    await this.emailService().sendOrderShippedEmail(
      order.customerEmail, order.customerName, order.id, courier, order.awbNumber, order.trackingUrl,
    );
  } catch (err) {
    console.log(`[EMAIL] order shipped: ${err.message || err}`);
  }
}

// Tells staff a new account was created, with the address and device when we have them.
export function notifyMerchantNewUser(user, source, net) {
  const place = formatPlace(user.addressLine, user.city, user.state, user.pincode, user.country);
  const network = netOf(net);
  this.dispatchMerchant({
    title: `New user #${user.id} · ${orDash(user.name)}`,
    url: mapsURL(user.latitude, user.longitude, place),
    color: colorBlue,
    network,
    fields: [
      field("Name", user.name, true),
      field("Phone", user.phone || "", true),
      field("Email", user.email || "", true),
      field("Source", source, true),
      field("Provider", user.provider, true),
      field("Role", user.role, true),
      field("Address", place, false),
      field("Map", mapsURL(user.latitude, user.longitude, place), false),
      field("Device", deviceText(network), false),
      field("Signed up", formatIST(user.createdAt || new Date(), true), true),
    ],
    detail: networkExtra(network),
  });
}

// Tells staff a customer just paid for an order.
export function notifyMerchantPaidOrder(order) {
  const place = formatPlace(order.addressLine, order.city, order.state, order.pincode, "");
  const msg = orderAlert("Order paid", colorGreen, order, place);
  msg.network = { ip: order.clientIp || "", userAgent: order.userAgent || "" };
  this.dispatchMerchant(msg);
}

// Picks the newest dropped checkouts to alert on, one per email address.
function selectAbandonedAlerts(orders, now, limit) {
  if (limit <= 0 || !orders?.length) return [];
  const earliest = now.getTime() - abandonedEmailWindowMs;
  const sorted = [...orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const seen = new Set();
  const out = [];
  for (const order of sorted) {
    // Older than the window: skip it.
    if (new Date(order.createdAt).getTime() < earliest) continue;
    let key = String(order.customerEmail || "").trim().toLowerCase();
    // A checkout with no email is alerted on its own, by order number.
    if (!key.includes("@")) key = `#${order.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const copy = { ...order };
    if (key.includes("@")) copy.customerEmail = key;
    out.push(copy);
    if (out.length >= limit) break;
  }
  return out;
}

// Posts Discord alerts for checkouts the customer started and then left.
export async function notifyAbandonedCheckouts(claimed) {
  const picks = selectAbandonedAlerts(claimed, new Date(), maxAbandonedEmailsPerSweep);
  if (!picks.length) return;
  if (!String(this.cfg.discordWebhookURL || "").trim()) {
    if (!discordUnsetLogged) {
      discordUnsetLogged = true;
      console.log("[DISCORD] DISCORD_WEBHOOK_URL is empty; checkout drop-offs are not posted");
    }
    return;
  }
  const orders = await Order.findAll({ where: { id: picks.map((p) => p.id) }, include: [{ association: "items" }] }).catch((err) => {
    console.log(`[DISCORD] load dropped checkouts: ${err.message || err}`);
    return null;
  });
  if (!orders) return;
  const byID = new Map(orders.map((order) => [String(order.id), order]));
  const footer = await this.activityFooter(true);
  for (const pick of picks) {
    const order = byID.get(String(pick.id));
    if (!order) continue;
    const place = formatPlace(order.addressLine, order.city, order.state, order.pincode, "");
    const msg = orderAlert("Checkout dropped", colorOrange, order, place);
    msg.network = { ip: order.clientIp || "", userAgent: order.userAgent || "" };
    this.dispatchMerchantTo("", msg, footer);
  }
}

// The shared layout of a paid-order or dropped-checkout staff alert.
function orderAlert(kind, color, order, place) {
  const userID = order.userId != null ? String(order.userId) : "guest";
  const mapURL = mapsURL(order.latitude, order.longitude, place);
  const started = formatIST(order.createdAt, false);
  let when = `Placed ${started}`;
  if (kind === "Checkout dropped") {
    let age = Math.round((Date.now() - new Date(order.createdAt).getTime()) / 60000) * 60000;
    if (age < 60000) age = 60000;
    when = `Started ${started} · left after ${goDuration(age)}`;
  }
  const money = `₹${Math.round(Number(order.amount) || 0)} ${order.currency || ""} · ${orDash(order.paymentStatus)} · ${orDash(order.fulfillmentChannel)}`;
  return {
    title: `${kind} · #${order.id} · ${orDash(order.customerName)}`,
    url: mapURL,
    color,
    fields: [
      field("Name", order.customerName, true),
      field("Phone", order.customerPhone, true),
      field("Email", order.customerEmail, true),
      field("User", userID, true),
      field("Address", place, false),
      field("Map", mapURL, false),
      field("Amount", money, false),
      field("Items", orderItemsText(order.items || []), false),
      field("Delivery", formatDelivery(order), false),
      field("When", when, false),
      field("Device", thisClip(order.userAgent, 300), false),
      field("Razorpay", `${order.razorpayOrderId || ""} ${order.razorpayPaymentId || ""}`.trim(), false),
    ],
  };
}

// Shortens text to a character limit without splitting a letter.
function thisClip(s, max) {
  const text = String(s ?? "").trim();
  const runes = [...text];
  if (runes.length <= max) return text;
  return runes.slice(0, max).join("").trim();
}

// One line per plant on the order, for the staff alert.
function orderItemsText(items) {
  if (!items.length) return "";
  return items.map((item, i) => `${i + 1}. ${item.name} × ${item.quantity} · ₹${Math.round(Number(item.price) || 0)}`).join("\n");
}

// Delivery zone, distance, fee, coupon, and slot, joined for the staff alert.
function formatDelivery(order) {
  const parts = [];
  if (order.fulfillmentZone) parts.push(`zone ${order.fulfillmentZone}`);
  if (order.distanceKm != null) parts.push(`${Number(order.distanceKm).toFixed(1)} km`);
  if (Number(order.deliveryFee) > 0) parts.push(`fee ₹${Math.round(Number(order.deliveryFee))}`);
  else if (order.deliveryFeeWaived) parts.push("delivery fee waived");
  if (order.couponCode) parts.push(`coupon ${order.couponCode} −₹${Math.round(Number(order.discountTotal) || 0)}`);
  if (order.deliverySlot) parts.push(`${order.deliverySlot} slot`);
  if (order.latitude != null && order.longitude != null) {
    parts.push(`${Number(order.latitude).toFixed(5)}, ${Number(order.longitude).toFixed(5)}`);
  }
  return parts.join(" · ");
}

// An address written on a few lines for the staff alert.
function formatPlace(line, city, state, pincode, country) {
  const parts = [];
  if (String(line || "").trim()) parts.push(String(line).trim());
  let cityLine = [String(city || "").trim(), String(state || "").trim()].filter(Boolean).join(", ");
  const pin = String(pincode || "").trim();
  if (pin) cityLine = cityLine ? `${cityLine} ${pin}` : pin;
  if (cityLine) parts.push(cityLine);
  if (String(country || "").trim()) parts.push(String(country).trim());
  return parts.join("\n");
}

// Extra device lines, such as the raw user-agent and a forwarded IP that differs from the client IP.
export function networkExtra(net) {
  const detail = [];
  const ua = String(net?.userAgent || net?.UserAgent || "").trim();
  if (ua) detail.push(field("User-Agent", thisClip(ua, 400), false));
  const fwd = String(net?.forwardedFor || net?.ForwardedFor || "").trim();
  const ip = net?.ip || net?.IP || "";
  if (fwd && fwd !== ip) detail.push(field("Forwarded", thisClip(fwd, 200), false));
  return detail;
}

// A visitor who stays on the site for at least ten minutes can trigger a staff browsing alert.
export async function reportLongBrowse(req, res) {
  res.set("Cache-Control", "no-store");
  const body = req.body;
  // A bad body is ignored. The browser does not need an error for this beacon.
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    res.status(204).end();
    return;
  }
  const durationMin = Number(body.durationMin);
  if (!Number.isFinite(durationMin) || durationMin < 10 || durationMin > 24 * 60) {
    res.status(204).end();
    return;
  }
  const net = netOf(capture(req));
  net.screen = thisClip(body.screen, 40);
  net.viewport = thisClip(body.viewport, 40);
  net.timezone = thisClip(body.timezone, 60);
  net.languages = thisClip(body.languages, 120);
  const platform = thisClip(body.platform, 60);
  if (platform) net.platform = platform;
  if (body.cores > 0 && body.cores < 128) net.cores = body.cores;
  if (body.touch > 0 && body.touch < 32) net.touch = body.touch;
  // Bots and requests with no IP are not alerted.
  if (automatedVisitor(net) || !net.ip) {
    res.status(204).end();
    return;
  }
  if (!String(this.cfg.discordWebhookURL || "").trim()) {
    res.status(204).end();
    return;
  }
  // Only one in-process alert per IP, then at most one per day in Redis.
  if (!claimVisitor(net.ip)) {
    res.status(204).end();
    return;
  }
  if (this.redis) {
    try {
      const ok = await this.redis.set(`merchant:browse:${net.ip}`, "1", "EX", 24 * 3600, "NX");
      if (ok == null) {
        res.status(204).end();
        return;
      }
    } catch { /* a redis miss still alerts */ }
  }
  // Attach the signed-in account when the beacon included a login token.
  let user = User.build();
  const auth = req.get("Authorization") || "";
  if (auth.startsWith("Bearer ")) {
    try {
      const claims = parseToken(this.cfg.jwtSecret, auth.slice("Bearer ".length));
      if (claims?.userId) {
        const found = await User.findByPk(claims.userId);
        if (found) user = found;
      }
    } catch { /* guest */ }
  }
  const name = user.name || "";
  const page = thisClip(body.path, 300);
  let referrer = thisClip(body.referrer, 300);
  if (!referrer) referrer = thisClip(net.referer, 300);
  this.dispatchMerchant({
    title: `Browsing ${durationMin} min · ${orDash(name)}`,
    color: colorPurple,
    visitorsOnly: true,
    network: net,
    fields: [
      field("Name", name, true),
      field("Phone", user.phone || "", true),
      field("Email", user.email || "", true),
      field("Duration", `~${durationMin} minutes`, true),
      field("Page", page, false),
    ],
    detail: browseDetail(user, net, referrer, body.paths, page, body.sessionId),
  });
  res.status(204).end();
}

// Extra lines on a long-browse alert: account, address, pages walked, and device.
function browseDetail(user, net, referrer, paths, page, sessionID) {
  const detail = [];
  if (user?.id) {
    let account = `#${user.id} · ${orDash(user.role)} · ${orDash(user.provider)}`;
    if (user.createdAt) account += ` · since ${formatIST(user.createdAt, true).replace(/ \d{2}:\d{2} IST$/, "")}`;
    detail.push(field("Account", account, false));
    const place = formatPlace(user.addressLine, user.city, user.state, user.pincode, user.country);
    if (place) detail.push(field("Saved address", place, false));
    const link = mapsURL(user.latitude, user.longitude, "");
    if (link) detail.push(field("Saved map", link, false));
  }
  const device = deviceText(net);
  if (device) detail.push(field("Device", device, false));
  if (referrer) detail.push(field("Came from", referrer, false));
  const walked = browsePaths(paths, page);
  if (walked) detail.push(field("Pages", walked, false));
  if (sessionID) detail.push(field("Session", thisClip(sessionID, 80), true));
  detail.push(...networkExtra(net));
  return detail;
}

// Up to twelve pages the visitor opened, or just the current page when the list is empty.
function browsePaths(paths, page) {
  const lines = [];
  for (const path of paths || []) {
    const text = thisClip(path, 160);
    if (!text) continue;
    lines.push(text);
    if (lines.length === 12) break;
  }
  if (!lines.length) return page;
  return lines.join("\n");
}
