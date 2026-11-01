// JSON shape shared by every model. Password hashes, soft-delete times, and
// a few internal columns never leave the process.

const HIDDEN = new Set([
  "passwordHash",
  "deletedAt",
  "inventoryReleased",
  "reviewRequestedAt",
  "itemsJson",
  "pushToken",
  "dedupeKey",
  "payload",
  "restockedInventory",
  "clientIp",
  "userAgent",
]);

export function present(value) {
  if (value == null) return value;
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map(present);
  if (value instanceof Date) return value.toISOString();
  const raw = typeof value?.get === "function" ? value.get({ plain: true }) : value;
  if (typeof raw !== "object") return raw;
  const out = {};
  for (const [key, item] of Object.entries(raw)) {
    if (HIDDEN.has(key) || typeof item === "function") continue;
    out[key] = present(item);
  }
  return out;
}

export function strPtr(value) {
  return value ? value : null;
}

export function emailOrEmpty(user) {
  return user?.email || "";
}

export function phoneOrEmpty(user) {
  return user?.phone || "";
}
