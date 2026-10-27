// This file is the customer's list of plants they own.
// They can add a plant, set watering and feeding reminders, mark a task done,
// and write a health note. Due reminders are written into the app inbox
// when they open the list.

import { decode, error, json } from "../../pkg/httpjson/httpjson.js";
import { requireUser } from "../auth/jwt.js";
import { isDue, nextDueAt, seasonFor } from "../care/season.js";
import { AppNotification, OwnedPlant, PlantHealthLog } from "../models/index.js";

const healthStatuses = new Set(["thriving", "healthy", "stressed", "yellowing", "pests", "wilting", "recovering"]);
const allowedRooms = new Set(["balcony", "living room", "bedroom", "office", "kitchen", "outdoor", "other"]);

// Splits a moment into India date and clock parts.
function istParts(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const bag = Object.fromEntries(fmt.formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return { year: Number(bag.year), month: Number(bag.month), day: Number(bag.day), hour: Number(bag.hour), minute: Number(bag.minute), second: Number(bag.second) };
}

// The same clock time written as if India local time were UTC, for reminder math.
function istStamp(date) {
  const p = istParts(date);
  // Writes a number as two digits, so 8 becomes 08.
  const pad = (n) => String(n).padStart(2, "0");
  return new Date(`${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}Z`);
}

// Today's date in India, as YYYY-MM-DD. Care reminders use this so one day means one notice.
function istYMD(date) {
  const p = istParts(date);
  // Writes a number as two digits, so 8 becomes 08.
  const pad = (n) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

// The ISO week number in India, used so the weekly care digest is sent once per week.
function isoWeekIST(date) {
  const [y, m, d] = istYMD(date).split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
  return { year: utc.getUTCFullYear(), week };
}

// Shortens text to a byte limit without splitting a multi-byte letter.
function clipBytes(s, max) {
  s = String(s ?? "");
  if (Buffer.byteLength(s) <= max) return s;
  let out = "";
  for (const ch of s) {
    if (Buffer.byteLength(out + ch) > max) break;
    out += ch;
  }
  return out;
}

// Checks a day-interval from the form. A missing value keeps the current interval.
function applyInterval(current, value, max) {
  if (value == null) return { ok: true, value: current };
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) return { ok: false, message: "That interval is outside the allowed range." };
  return { ok: true, value: n };
}

// Copies the form onto a plant: name, room, notes, and each care interval and reminder switch.
function applyPlantBody(plant, req) {
  let name = String(req.name ?? "").trim();
  if (!name) return { ok: false, message: "Enter a name for the plant." };
  if (name.length > 80) name = name.slice(0, 80);
  let location = String(req.location ?? "").trim();
  if (location.length > 80) location = location.slice(0, 80);
  let notes = String(req.notes ?? "").trim();
  if (notes.length > 1000) notes = notes.slice(0, 1000);
  const room = String(req.room ?? "").trim().toLowerCase();
  if (room && !allowedRooms.has(room)) {
    return { ok: false, message: "Choose a spot: balcony, living room, bedroom, office, kitchen, outdoor, or other." };
  }
  plant.name = name;
  plant.location = location;
  plant.notes = notes;
  plant.room = room;
  plant.photoUrl = this.clipText(req.photoUrl, 500);
  plant.productSlug = this.clipText(req.productSlug, 180);
  if (req.productId != null && Number(req.productId) !== 0) plant.productId = req.productId;
  if (req.waterEveryDays != null) {
    const n = Number(req.waterEveryDays);
    if (!Number.isInteger(n) || n < 0 || n > 60) return { ok: false, message: "Watering interval must be between 0 and 60 days." };
    plant.waterEveryDays = n;
  }
  if (req.fertilizeEveryDays != null) {
    const n = Number(req.fertilizeEveryDays);
    if (!Number.isInteger(n) || n < 0 || n > 180) return { ok: false, message: "Fertilizing interval must be between 0 and 180 days." };
    plant.fertilizeEveryDays = n;
  }
  if (req.waterReminder != null) plant.waterReminder = Boolean(req.waterReminder);
  if (req.fertilizeReminder != null) plant.fertilizeReminder = Boolean(req.fertilizeReminder);
  for (const [field, key, max] of [
    ["mistEveryDays", "mistEveryDays", 30],
    ["rotateEveryDays", "rotateEveryDays", 90],
    ["repotEveryDays", "repotEveryDays", 730],
    ["pruneEveryDays", "pruneEveryDays", 365],
  ]) {
    const applied = applyInterval(plant[field], req[key], max);
    if (!applied.ok) return applied;
    plant[field] = applied.value;
  }
  if (req.mistReminder != null) plant.mistReminder = Boolean(req.mistReminder);
  if (req.rotateReminder != null) plant.rotateReminder = Boolean(req.rotateReminder);
  if (req.repotReminder != null) plant.repotReminder = Boolean(req.repotReminder);
  if (req.pruneReminder != null) plant.pruneReminder = Boolean(req.pruneReminder);
  return { ok: true };
}

// The next reminder time when the switch is on, or null when the reminder is off.
function dueIf(on, from, every, hour) {
  if (!on) return null;
  return nextDueAt(from, every, hour);
}

// Keeps the current reminder time unless the customer changed the interval or turned it off.
function reschedule(current, on, every, prev, now, hour) {
  if (!on || every <= 0) return null;
  if (current == null || every !== prev) return nextDueAt(now, every, hour);
  return current;
}

// Uses the fallback day count when the plant has no positive interval of its own.
function positive(value, fallback) {
  return value > 0 ? value : fallback;
}

// The title and body of a care reminder, written for the plant's name and the kind of task.
function careCopy(name, kind) {
  switch (kind) {
    case "fertilizing":
      return ["Feed " + name, "A light feed is due. Skip it if the plant looks stressed or the soil is still wet."];
    case "mist":
      return ["Mist " + name, "A light mist helps if the air is dry. Skip it when the leaves are already wet."];
    case "rotate":
      return ["Rotate " + name, "Turn the pot a quarter turn so each side gets light."];
    case "repot":
      return ["Repot " + name, "Check whether roots are circling the pot. Mild weather is the easiest time."];
    case "prune":
      return ["Prune " + name, "Remove dead or crowded growth. Keep the shape open so air can move through."];
    default:
      return ["Water " + name, "Check the soil, then water if the top few centimetres are dry."];
  }
}

// The current India season and the care tasks that go with it.
export async function careSeason(req, res) {
  json(res, 200, seasonFor(new Date()));
}

// Adds the latest health note and which care tasks are due onto each plant the app will show.
export async function presentPlants(userId, plants) {
  const latest = new Map();
  if (plants.length) {
    const logs = await PlantHealthLog.findAll({ where: { userId }, order: [["recordedAt", "DESC"]] });
    for (const log of logs) {
      if (!latest.has(String(log.ownedPlantId))) latest.set(String(log.ownedPlantId), log.status);
    }
  }
  const now = new Date();
  return plants.map((plant) => {
    const view = plant.toJSON ? plant.toJSON() : { ...plant };
    const health = latest.get(String(plant.id));
    if (health) view.latestHealth = health;
    view.waterDue = Boolean(plant.waterReminder) && isDue(plant.waterNextAt, now);
    view.fertilizeDue = Boolean(plant.fertilizeReminder) && isDue(plant.fertilizeNextAt, now);
    view.mistDue = Boolean(plant.mistReminder) && isDue(plant.mistNextAt, now);
    view.rotateDue = Boolean(plant.rotateReminder) && isDue(plant.rotateNextAt, now);
    view.repotDue = Boolean(plant.repotReminder) && isDue(plant.repotNextAt, now);
    view.pruneDue = Boolean(plant.pruneReminder) && isDue(plant.pruneNextAt, now);
    return view;
  });
}

// Writes one care reminder into the inbox. The same plant, task, and day is not written twice.
export async function ensureCareNotification(userId, plant, kind, due) {
  if (!due) return;
  const day = istYMD(new Date(due));
  const key = `${userId}:${plant.id}:${kind}:${day}`;
  const [title, body] = careCopy(plant.name, kind);
  // A reminder the customer dismissed can be restored for this same due day.
  const existing = await AppNotification.findOne({ where: { dedupeKey: key }, paranoid: false });
  if (!existing) {
    try {
      await AppNotification.create({
        userId,
        kind,
        title,
        body,
        href: `/my-plants/${plant.id}`,
        ownedPlantId: plant.id,
        dedupeKey: key,
      });
    } catch (err) {
      console.log(`[PLANTS] reminder: ${err.message || err}`);
    }
    return;
  }
  if (existing.deletedAt) {
    try {
      await AppNotification.update(
        { deletedAt: null, readAt: null, title, body },
        { where: { id: existing.id }, paranoid: false },
      );
    } catch (err) {
      console.log(`[PLANTS] reminder restore: ${err.message || err}`);
    }
  }
}

// Once a week, tells the customer how many waterings and feeds are coming up, plus a seasonal note.
export async function recordCareDigest(userId, plants) {
  const now = new Date();
  const { year, week } = isoWeekIST(now);
  const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  let due = 0;
  for (const plant of plants) {
    if (plant.waterReminder && isDue(plant.waterNextAt, horizon)) due++;
    if (plant.fertilizeReminder && isDue(plant.fertilizeNextAt, horizon)) due++;
  }
  if (!due) return;
  await this.pushNotice(userId, "digest", "This week's plant care", `${due} watering or feeding tasks are coming up.`, "/my-plants/calendar", `digest:${year}-w${week}`, null, null, null);
  const advice = seasonFor(now);
  // Monsoon, winter, and the weeks after monsoon get an extra seasonal care note.
  if (advice.season === "monsoon" || advice.season === "winter" || advice.season === "post_monsoon") {
    await this.pushNotice(userId, "care", advice.title, advice.tasks[0], "/care-guides", `season:${advice.season}:${year}`, null, null, null);
  }
}

// Writes a reminder for every care task that is due now, when the customer still wants care reminders.
export async function recordDueReminders(userId, plants, req) {
  const prefs = await this.notificationPrefs(req, userId);
  if (!prefs.careReminders) return;
  const now = new Date();
  for (const plant of plants) {
    if (plant.waterReminder && isDue(plant.waterNextAt, now)) await this.ensureCareNotification(userId, plant, "watering", plant.waterNextAt);
    if (plant.fertilizeReminder && isDue(plant.fertilizeNextAt, now)) await this.ensureCareNotification(userId, plant, "fertilizing", plant.fertilizeNextAt);
    if (plant.mistReminder && isDue(plant.mistNextAt, now)) await this.ensureCareNotification(userId, plant, "mist", plant.mistNextAt);
    if (plant.rotateReminder && isDue(plant.rotateNextAt, now)) await this.ensureCareNotification(userId, plant, "rotate", plant.rotateNextAt);
    if (plant.repotReminder && isDue(plant.repotNextAt, now)) await this.ensureCareNotification(userId, plant, "repot", plant.repotNextAt);
    if (plant.pruneReminder && isDue(plant.pruneNextAt, now)) await this.ensureCareNotification(userId, plant, "prune", plant.pruneNextAt);
  }
  await this.recordCareDigest(userId, plants);
}

// Loads one plant that belongs to this customer. A missing or foreign plant is an error.
export async function ownedPlant(req, res, userId) {
  const raw = String(req.params?.id ?? "");
  if (!/^\d+$/.test(raw)) {
    error(res, 400, "invalid plant id");
    return null;
  }
  try {
    const plant = await OwnedPlant.findOne({ where: { id: raw, userId } });
    if (!plant) {
      error(res, 404, "plant not found");
      return null;
    }
    return plant;
  } catch (err) {
    console.log(`[PLANTS] load: ${err.message || err}`);
    error(res, 500, "failed to load plant");
    return null;
  }
}

// Lists the customer's plants, writes any due care reminders, and checks outdoor weather.
export async function listOwnedPlants(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  let plants;
  try {
    plants = await OwnedPlant.findAll({ where: { userId: claims.userId }, order: [["name", "ASC"]] });
  } catch (err) {
    console.log(`[PLANTS] list: ${err.message || err}`);
    error(res, 500, "failed to load your plants");
    return;
  }
  await this.recordDueReminders(claims.userId, plants, req);
  await this.checkWeather(claims.userId, plants);
  json(res, 200, {
    plants: await this.presentPlants(claims.userId, plants),
    season: seasonFor(new Date()),
  });
}

// Adds a plant and schedules the first reminder for each care task the customer turned on.
export async function createOwnedPlant(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const body = decode(req, res);
  if (!body) return;
  // A new plant starts with weekly watering and a feed about every six weeks.
  const plant = OwnedPlant.build({
    userId: claims.userId,
    waterEveryDays: 7,
    fertilizeEveryDays: 45,
    waterReminder: true,
    fertilizeReminder: true,
  });
  const applied = applyPlantBody.call(this, plant, body);
  if (!applied.ok) {
    error(res, 400, applied.message);
    return;
  }
  const hour = await this.reminderHour(claims.userId);
  const now = new Date();
  plant.waterNextAt = dueIf(plant.waterReminder, now, plant.waterEveryDays, hour);
  plant.fertilizeNextAt = dueIf(plant.fertilizeReminder, now, plant.fertilizeEveryDays, hour);
  plant.mistNextAt = dueIf(plant.mistReminder, now, plant.mistEveryDays, hour);
  plant.rotateNextAt = dueIf(plant.rotateReminder, now, plant.rotateEveryDays, hour);
  plant.repotNextAt = dueIf(plant.repotReminder, now, plant.repotEveryDays, hour);
  plant.pruneNextAt = dueIf(plant.pruneReminder, now, plant.pruneEveryDays, hour);
  try {
    await plant.save();
  } catch (err) {
    console.log(`[PLANTS] create: ${err.message || err}`);
    error(res, 500, "failed to save plant");
    return;
  }
  const [view] = await this.presentPlants(claims.userId, [plant]);
  json(res, 201, view);
}

// One plant plus its recent health notes.
export async function getOwnedPlant(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const plant = await this.ownedPlant(req, res, claims.userId);
  if (!plant) return;
  const logs = await PlantHealthLog.findAll({
    where: { ownedPlantId: plant.id, userId: claims.userId },
    order: [["recordedAt", "DESC"]],
    limit: 30,
  });
  const [view] = await this.presentPlants(claims.userId, [plant]);
  json(res, 200, { plant: view, health: logs });
}

// Updates a plant. A changed interval reschedules that reminder. An unchanged interval keeps its due time.
export async function updateOwnedPlant(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const plant = await this.ownedPlant(req, res, claims.userId);
  if (!plant) return;
  const body = decode(req, res);
  if (!body) return;
  const prev = {
    waterEveryDays: plant.waterEveryDays,
    fertilizeEveryDays: plant.fertilizeEveryDays,
    mistEveryDays: plant.mistEveryDays,
    rotateEveryDays: plant.rotateEveryDays,
    repotEveryDays: plant.repotEveryDays,
    pruneEveryDays: plant.pruneEveryDays,
  };
  const applied = applyPlantBody.call(this, plant, body);
  if (!applied.ok) {
    error(res, 400, applied.message);
    return;
  }
  const hour = await this.reminderHour(claims.userId);
  const now = new Date();
  plant.waterNextAt = reschedule(plant.waterNextAt, plant.waterReminder, plant.waterEveryDays, prev.waterEveryDays, now, hour);
  plant.fertilizeNextAt = reschedule(plant.fertilizeNextAt, plant.fertilizeReminder, plant.fertilizeEveryDays, prev.fertilizeEveryDays, now, hour);
  plant.mistNextAt = reschedule(plant.mistNextAt, plant.mistReminder, plant.mistEveryDays, prev.mistEveryDays, now, hour);
  plant.rotateNextAt = reschedule(plant.rotateNextAt, plant.rotateReminder, plant.rotateEveryDays, prev.rotateEveryDays, now, hour);
  plant.repotNextAt = reschedule(plant.repotNextAt, plant.repotReminder, plant.repotEveryDays, prev.repotEveryDays, now, hour);
  plant.pruneNextAt = reschedule(plant.pruneNextAt, plant.pruneReminder, plant.pruneEveryDays, prev.pruneEveryDays, now, hour);
  try {
    await plant.save();
  } catch (err) {
    console.log(`[PLANTS] update: ${err.message || err}`);
    error(res, 500, "failed to update plant");
    return;
  }
  const [view] = await this.presentPlants(claims.userId, [plant]);
  json(res, 200, view);
}

// Removes a plant, its health notes, and the reminders that pointed at it.
export async function deleteOwnedPlant(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const plant = await this.ownedPlant(req, res, claims.userId);
  if (!plant) return;
  try {
    await this.sequelize.transaction(async (tx) => {
      await PlantHealthLog.destroy({ where: { ownedPlantId: plant.id, userId: claims.userId }, transaction: tx });
      await AppNotification.destroy({ where: { ownedPlantId: plant.id, userId: claims.userId }, transaction: tx });
      await plant.destroy({ transaction: tx });
    });
  } catch (err) {
    console.log(`[PLANTS] delete: ${err.message || err}`);
    error(res, 500, "failed to remove plant");
    return;
  }
  json(res, 200, { success: true });
}

// Marks one care task done and sets the next reminder from today.
async function markPlantCare(req, res, kind) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const plant = await this.ownedPlant(req, res, claims.userId);
  if (!plant) return;
  const now = new Date();
  const hour = await this.reminderHour(claims.userId);
  switch (kind) {
    case "water":
      if (!(plant.waterEveryDays > 0)) {
        error(res, 400, "set how many days between waterings first");
        return;
      }
      plant.waterNextAt = nextDueAt(now, plant.waterEveryDays, hour);
      break;
    case "fertilize":
      if (!(plant.fertilizeEveryDays > 0)) {
        error(res, 400, "set how many days between feeds first");
        return;
      }
      plant.fertilizeNextAt = nextDueAt(now, plant.fertilizeEveryDays, hour);
      break;
    case "mist":
      plant.mistNextAt = nextDueAt(now, positive(plant.mistEveryDays, 2), hour);
      break;
    case "rotate":
      plant.rotateNextAt = nextDueAt(now, positive(plant.rotateEveryDays, 14), hour);
      break;
    case "repot":
      plant.repotNextAt = nextDueAt(now, positive(plant.repotEveryDays, 365), hour);
      break;
    case "prune":
      plant.pruneNextAt = nextDueAt(now, positive(plant.pruneEveryDays, 90), hour);
      break;
    default:
      error(res, 400, "unknown care task");
      return;
  }
  try {
    await plant.save();
  } catch (err) {
    console.log(`[PLANTS] mark ${kind}: ${err.message || err}`);
    error(res, 500, "failed to update the reminder");
    return;
  }
  const [view] = await this.presentPlants(claims.userId, [plant]);
  json(res, 200, view);
}

// The customer watered this plant. The next watering reminder moves forward.
export async function markPlantWatered(req, res) {
  await markPlantCare.call(this, req, res, "water");
}

// The customer fed this plant. The next feeding reminder moves forward.
export async function markPlantFertilized(req, res) {
  await markPlantCare.call(this, req, res, "fertilize");
}

// Marks mist, rotate, repot, prune, or another named care task done.
export async function markPlantTask(req, res) {
  const body = decode(req, res);
  if (!body) return;
  await markPlantCare.call(this, req, res, String(body.kind || "").trim().toLowerCase());
}

// Saves a health note. A stressed, yellowing, pest, or wilting plant gets a check-in reminder in a week.
export async function addPlantHealth(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const plant = await this.ownedPlant(req, res, claims.userId);
  if (!plant) return;
  const body = decode(req, res);
  if (!body) return;
  const status = String(body.status || "").trim().toLowerCase();
  if (!healthStatuses.has(status)) {
    error(res, 400, "choose a health status");
    return;
  }
  let notes = String(body.notes || "").trim();
  if (Buffer.byteLength(notes) > 1000) notes = clipBytes(notes, 1000);
  const entry = PlantHealthLog.build({
    ownedPlantId: plant.id,
    userId: claims.userId,
    status,
    notes,
    photoUrl: this.clipText(body.photoUrl, 500),
    recordedAt: new Date(),
  });
  if (["stressed", "yellowing", "pests", "wilting"].includes(status)) {
    const follow = nextDueAt(new Date(), 7, await this.reminderHour(claims.userId));
    entry.followUpAt = follow;
    await this.pushNotice(
      claims.userId,
      "health",
      `Check on ${plant.name}`,
      `It was logged as ${status}. Look again in a week.`,
      `/my-plants/${plant.id}`,
      `health:${plant.id}:${istYMD(follow)}`,
      null,
      null,
      plant.id,
    );
  }
  try {
    await entry.save();
  } catch (err) {
    console.log(`[PLANTS] health: ${err.message || err}`);
    error(res, 500, "failed to save the health note");
    return;
  }
  json(res, 201, entry);
}

export { istStamp, istYMD, healthStatuses };
