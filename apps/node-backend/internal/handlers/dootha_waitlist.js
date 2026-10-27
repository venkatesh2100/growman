// This file takes sign-ups for the Dootha Care waiting list.
// A visitor leaves a name and phone. Staff get an alert, and an admin
// can later open the list of people who are waiting.

import { decode, error, json } from "../../pkg/httpjson/httpjson.js";
import { isAdminRole, requireUser } from "../auth/jwt.js";
import { clientIP } from "../middlewares/ip.js";
import { tenDigitIN } from "../phoneutil/phone.js";
import { DoothaWaitlist } from "../models/index.js";
import { capture } from "../services/visitor.js";

// Shortens text to a character limit.
function clip(s, max) {
  const text = String(s ?? "").trim();
  const runes = [...text];
  return runes.length > max ? runes.slice(0, max).join("") : text;
}

// Collapses extra spaces and shortens text so a name stays on one line.
function oneLine(s, max) {
  return clip(String(s ?? "").trim().split(/\s+/).filter(Boolean).join(" "), max);
}

// Shows a dash when a field the staff alert would print is blank.
function orDash(value) {
  return String(value || "").trim() ? value : "—";
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

// The current time in India, written the way the staff alert shows it.
function istWhen(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const g = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return `${g.day}-${g.month}-${g.year} ${g.hour}:${g.minute} IST`;
}

// Saves a Dootha Care waiting-list sign-up. The same phone updates the existing row.
export async function joinDoothaWaitlist(req, res) {
  const body = decode(req, res);
  if (!body) return;
  // A filled hidden website field means a bot. Real visitors leave it blank.
  if (String(body.website || "").trim()) {
    error(res, 400, "invalid request");
    return;
  }
  const name = oneLine(body.name, 100);
  const phone = tenDigitIN(body.phone);
  let email = oneLine(body.email, 160);
  const address = clip(body.address, 300);
  if ([...name].length < 2) {
    error(res, 400, "Please enter your name.");
    return;
  }
  if (!phone) {
    error(res, 400, "Please enter a valid 10-digit mobile number.");
    return;
  }
  // Email is optional. When it is present it must be a real address.
  if (email) {
    const parsed = parseMailbox(email);
    if (!parsed) {
      error(res, 400, "Please enter a valid email address, or leave it blank.");
      return;
    }
    email = parsed;
  }
  let source = oneLine(body.source, 40).toLowerCase();
  if (!source) source = "homepage_popup";
  const userId = req.user?.userId ?? null;
  // Remember the visitor's network details so staff can see where the sign-up came from.
  const net = capture(req) || {};
  let ip = net.ip || net.IP || "";
  if (!ip) ip = clientIP(req);
  const entry = {
    name,
    phone,
    email,
    address,
    status: "pending",
    source,
    userId,
    ip,
    userAgent: oneLine(req.get("User-Agent"), 300),
    signups: 1,
  };
  // The same mobile number is one person. A second sign-up updates that row.
  const existing = await DoothaWaitlist.findOne({ where: { phone } });
  let saved;
  if (existing) {
    existing.name = name;
    if (email) existing.email = email;
    if (address) existing.address = address;
    if (userId != null) existing.userId = userId;
    existing.source = source;
    existing.ip = entry.ip;
    existing.userAgent = entry.userAgent;
    existing.signups = Number(existing.signups || 0) + 1;
    try {
      await existing.save();
    } catch (err) {
      console.log(`[WAITLIST] update failed for ${phone}: ${err.message || err}`);
      error(res, 500, "Could not save your details. Please try again.");
      return;
    }
    saved = existing;
  } else {
    try {
      saved = await DoothaWaitlist.create(entry);
    } catch (err) {
      console.log(`[WAITLIST] insert failed for ${phone}: ${err.message || err}`);
      error(res, 500, "Could not save your details. Please try again.");
      return;
    }
  }
  // Tell staff about the sign-up by Discord or email.
  this.notifyWaitlistSignup(saved, req.get("Referer") || "", net);
  json(res, 201, { id: saved.id, name: saved.name, phone: saved.phone, status: saved.status });
}

// Sends staff a Discord message, or an email, about a new waiting-list sign-up.
export function notifyWaitlistSignup(entry, referrer, net = {}) {
  let to = String(this.cfg.waitlistEmail || "").trim();
  if (!to) to = this.merchantEmail();
  // With neither Discord nor a working mailbox, the sign-up is saved but nobody is pinged.
  if (!String(this.cfg.discordWebhookURL || "").trim() && (!to || !this.cfg.smtpEmail || !this.cfg.smtpPassword)) {
    console.log(`[WAITLIST] alerts not configured; sign-up ${entry.id} not sent`);
    return;
  }
  const userID = entry.userId != null ? String(entry.userId) : "guest";
  const body = `Dootha Care waiting list sign-up

Name: ${entry.name}
Phone: ${entry.phone}
Email: ${orDash(entry.email)}
Address: ${orDash(entry.address)}

Entry ID: ${entry.id}
Signed up: ${entry.signups} time(s)
Source: ${entry.source}
User ID: ${userID}
IP: ${entry.ip}
Referrer: ${orDash(oneLine(referrer, 300))}
User-Agent: ${entry.userAgent}
Received: ${istWhen()}
`;
  const subject = `Dootha Care waitlist · ${entry.name}`;
  const network = { ...net };
  if (!network.ip && !network.IP) network.ip = entry.ip || "";
  if (!network.userAgent && !network.UserAgent) network.userAgent = entry.userAgent || "";
  this.dispatchMerchantTo(to, {
    title: subject,
    description: body,
    color: 0x1d6fbf,
    network,
    detail: this.networkExtra(network),
  }, "");
}

// Staff list of waiting-list rows, optionally filtered by status.
export async function listDoothaWaitlist(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  if (!isAdminRole(claims.role)) {
    error(res, 403, "admin access required");
    return;
  }
  const status = qStatus(req);
  const where = status ? { status } : undefined;
  try {
    const rows = await DoothaWaitlist.findAll({ where, order: [["createdAt", "DESC"]], limit: 500 });
    json(res, 200, rows);
  } catch {
    error(res, 500, "failed to fetch the waiting list");
  }
}

// Reads the optional status filter from the staff list request.
function qStatus(req) {
  const v = req.query?.status;
  const raw = Array.isArray(v) ? v[0] : v;
  return String(raw || "").trim().toLowerCase();
}
