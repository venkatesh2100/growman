// This file lets a customer read and change the notices in their app inbox.
// They can turn order updates, offers, care reminders, weather, and Dootha
// messages on or off, set a quiet hour, pause for a vacation, and mark notices read.

import { Op } from "sequelize";
import { decode, error, json } from "../../pkg/httpjson/httpjson.js";
import { requireUser } from "../auth/jwt.js";
import { AppNotification, NotificationPreference } from "../models/index.js";

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

// Loads this customer's notification settings, and saves the defaults the first time.
export async function notificationPrefs(req, userId) {
  const existing = await NotificationPreference.findOne({ where: { userId } });
  if (existing) return existing;
  const prefs = NotificationPreference.build(defaultPrefs(userId));
  try {
    await prefs.save();
  } catch (err) {
    console.log(`[NOTIFY] create prefs: ${err.message || err}`);
  }
  return prefs;
}

// The settings the app is allowed to see. The push token itself stays on the server.
function prefsView(prefs) {
  let hour = prefs.reminderHour;
  if (!hour) hour = 8;
  return {
    orderUpdates: Boolean(prefs.orderUpdates),
    promotions: Boolean(prefs.promotions),
    careReminders: Boolean(prefs.careReminders),
    weatherAlerts: Boolean(prefs.weatherAlerts),
    doothaAlerts: Boolean(prefs.doothaAlerts),
    reminderHour: hour,
    quietStartHour: prefs.quietStartHour,
    quietEndHour: prefs.quietEndHour,
    vacationUntil: prefs.vacationUntil || null,
    pushRegistered: Boolean(prefs.pushToken),
  };
}

// Returns the signed-in customer's notification settings.
export async function getNotificationPreferences(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const prefs = await this.notificationPrefs(req, claims.userId);
  json(res, 200, prefsView(prefs));
}

// Saves the switches the customer changed: offers, care reminders, quiet hours, vacation, and push.
export async function updateNotificationPreferences(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const body = decode(req, res);
  if (!body) return;
  const prefs = await this.notificationPrefs(req, claims.userId);
  // Only fields the customer sent are changed. Missing fields stay as they were.
  if (body.orderUpdates != null) prefs.orderUpdates = Boolean(body.orderUpdates);
  if (body.promotions != null) prefs.promotions = Boolean(body.promotions);
  if (body.careReminders != null) prefs.careReminders = Boolean(body.careReminders);
  if (body.weatherAlerts != null) prefs.weatherAlerts = Boolean(body.weatherAlerts);
  if (body.doothaAlerts != null) prefs.doothaAlerts = Boolean(body.doothaAlerts);
  // Hour 0 is treated as the default morning reminder at 8.
  if (body.reminderHour != null) {
    const hour = Number(body.reminderHour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      error(res, 400, "reminder hour must be between 0 and 23");
      return;
    }
    prefs.reminderHour = hour === 0 ? 8 : hour;
  }
  if (body.quietStartHour != null) {
    const hour = Number(body.quietStartHour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      error(res, 400, "quiet hours must be between 0 and 23");
      return;
    }
    prefs.quietStartHour = hour;
  }
  if (body.quietEndHour != null) {
    const hour = Number(body.quietEndHour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      error(res, 400, "quiet hours must be between 0 and 23");
      return;
    }
    prefs.quietEndHour = hour;
  }
  // Clearing vacation turns plant-care notices back on right away.
  if (body.clearVacation) prefs.vacationUntil = null;
  if (body.vacationUntil != null && String(body.vacationUntil).trim() !== "") {
    const text = String(body.vacationUntil).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      error(res, 400, "vacationUntil must be YYYY-MM-DD");
      return;
    }
    const parsed = new Date(`${text}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) {
      error(res, 400, "vacationUntil must be YYYY-MM-DD");
      return;
    }
    // Vacation lasts through the end of that calendar day.
    prefs.vacationUntil = new Date(parsed.getTime() + (23 * 60 + 59) * 60 * 1000);
  }
  if (body.pushToken != null) {
    let token = String(body.pushToken).trim();
    if (token.length > 255) token = token.slice(0, 255);
    prefs.pushToken = token;
  }
  try {
    await prefs.save();
  } catch (err) {
    console.log(`[NOTIFY] save prefs: ${err.message || err}`);
    error(res, 500, "failed to save notification settings");
    return;
  }
  json(res, 200, prefsView(prefs));
}

// Lists the customer's newest inbox notices and how many are still unread.
export async function listAppNotifications(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  let notes;
  try {
    notes = await AppNotification.findAll({
      where: { userId: claims.userId },
      order: [["createdAt", "DESC"]],
      limit: 50,
    });
  } catch (err) {
    console.log(`[NOTIFY] list: ${err.message || err}`);
    error(res, 500, "failed to load notifications");
    return;
  }
  const unread = await AppNotification.count({ where: { userId: claims.userId, readAt: { [Op.is]: null } } });
  json(res, 200, { notifications: notes, unread });
}

// Marks one of the customer's notices as read. Someone else's notice is left alone.
export async function markNotificationRead(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const raw = String(req.params?.id ?? "");
  if (!/^\d+$/.test(raw)) {
    error(res, 400, "invalid notification id");
    return;
  }
  try {
    await AppNotification.update(
      { readAt: new Date() },
      { where: { id: raw, userId: claims.userId, readAt: { [Op.is]: null } } },
    );
  } catch {
    error(res, 500, "failed to update notification");
    return;
  }
  json(res, 200, { success: true });
}

// Marks every unread notice in this customer's inbox as read.
export async function markAllNotificationsRead(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  try {
    await AppNotification.update(
      { readAt: new Date() },
      { where: { userId: claims.userId, readAt: { [Op.is]: null } } },
    );
  } catch {
    error(res, 500, "failed to update notifications");
    return;
  }
  json(res, 200, { success: true });
}
