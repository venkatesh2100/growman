// This file writes the notices a customer sees in the app inbox.
// It checks the customer's notification settings before saving a notice,
// so a watering reminder or an offer is skipped when they turned that kind off.

import { AppNotification, NotificationPreference } from "../models/index.js";

// Shortens text to a character limit without cutting a word in the middle of a letter.
export function clipText(s, max) {
  const text = String(s ?? "").trim();
  const runes = [...text];
  if (runes.length <= max) return text;
  return runes.slice(0, max).join("").trim();
}

// Says whether a database error means "this row already exists".
// A repeated notice uses the same key on purpose, so that error is expected.
export function isDuplicateKey(err) {
  if (!err) return false;
  const parts = [];
  let cur = err;
  // Walk the wrapped database errors and look for a unique-key failure.
  while (cur) {
    parts.push(String(cur.message || cur));
    cur = cur.parent || cur.original || (cur.cause !== cur ? cur.cause : null);
    if (parts.length > 6) break;
  }
  const s = parts.join(" ");
  return err.name === "SequelizeUniqueConstraintError" || s.includes("23505") || s.includes("duplicate key");
}

// Starting notification choices for a customer who has never saved any.
function defaultPrefs(userId) {
  return {
    userId,
    orderUpdates: true,
    promotions: false,
    careReminders: true,
    weatherAlerts: true,
    doothaAlerts: true,
    reminderHour: 8,
    quietStartHour: 22,
    quietEndHour: 7,
  };
}

// Decides if this kind of notice is allowed by the customer's settings.
function noticeAllowed(prefs, kind) {
  switch (kind) {
    case "offer": return Boolean(prefs.promotions);
    case "weather": return Boolean(prefs.weatherAlerts);
    case "dootha": return Boolean(prefs.doothaAlerts);
    case "order": return Boolean(prefs.orderUpdates);
    // Watering, feeding, and other plant care use the care-reminder switch.
    default: return Boolean(prefs.careReminders);
  }
}

// True when this notice is about plant care, so a vacation pause can skip it.
function careKind(kind) {
  switch (kind) {
    case "watering":
    case "fertilizing":
    case "mist":
    case "rotate":
    case "repot":
    case "prune":
    case "health":
    case "digest":
    case "weather":
    case "care":
      return true;
    default:
      return false;
  }
}

// Saves one inbox notice for a customer, after checking their settings and vacation pause.
export async function pushNotice(userId, kind, title, body, href, dedupe, orderId, productId, plantId) {
  // A notice needs a real customer and a key so the same event is not saved twice.
  if (userId == null || Number(userId) === 0 || !String(dedupe || "").trim()) return;
  const prefs = await this.prefsFor(userId);
  // Skip the notice when the customer turned off this kind of message.
  if (!noticeAllowed(prefs, kind)) return;
  // While they are on vacation, plant-care notices stay quiet.
  if (prefs.vacationUntil && new Date(prefs.vacationUntil).getTime() > Date.now() && careKind(kind)) return;
  // Keep titles, bodies, and links short enough for the inbox row.
  title = this.clipText(title, 140);
  body = this.clipText(body, 500);
  href = this.clipText(href, 200);
  dedupe = String(dedupe);
  if (dedupe.length > 120) dedupe = dedupe.slice(0, 120);
  try {
    await AppNotification.create({
      userId,
      kind,
      title,
      body,
      href,
      orderId: orderId ?? null,
      productId: productId ?? null,
      ownedPlantId: plantId ?? null,
      dedupeKey: dedupe,
    });
  } catch (err) {
    // The same key was already saved. That is the point of the key, so stop quietly.
    if (isDuplicateKey(err)) return;
    console.log(`[NOTIFY] inbox: ${err.message || err}`);
  }
}

// Loads a customer's notification settings, or creates the default set the first time.
export async function prefsFor(userId) {
  const existing = await NotificationPreference.findOne({ where: { userId } });
  if (existing) return existing;
  const prefs = defaultPrefs(userId);
  try {
    return await NotificationPreference.create(prefs);
  } catch (err) {
    // Another request may have created the row at the same moment. Read it again.
    if (!isDuplicateKey(err)) console.log(`[NOTIFY] create prefs: ${err.message || err}`);
    const again = await NotificationPreference.findOne({ where: { userId } });
    return again || NotificationPreference.build(prefs);
  }
}

// Writes an order update into the customer's inbox, such as shipped or cancelled.
export async function notifyOrderEvent(order, title, body, dedupeSuffix) {
  // Guest checkouts have no account inbox to write to.
  if (order?.userId == null) return;
  await this.pushNotice(
    order.userId,
    "order",
    title,
    body,
    "/orders",
    `order:${order.id}:${dedupeSuffix}`,
    order.id,
    null,
    null,
  );
}
