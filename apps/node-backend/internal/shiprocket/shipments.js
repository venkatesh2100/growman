// Booking, AWB, pickup, and tracking. These writes do not use the circuit breaker.
// The order handler calls them on the Shiprocket client (`this` is that client).
// createOrder and generateAWB return the ids Shiprocket assigned. requestPickup returns nothing.
// track returns the latest status. A missing client throws ErrNotConfigured.

import { ErrNotConfigured } from "./client.js";

// Status text Shiprocket sends. Delivered includes a return-to-origin that reached us.
const DELIVERED = new Set(["delivered", "rto delivered"]);
const SHIPPED = new Set(["shipped", "in transit", "out for delivery", "picked up", "reached destination hub"]);

// Formats a value the way the error strings expect, including maps and nil.
function goFmt(value) {
  if (value === null || value === undefined) return "<nil>";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Object.is(value, -0) ? "0" : String(value);
  if (Array.isArray(value)) return `[${value.map(goFmt).join(" ")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `map[${keys.map((key) => `${key}:${goFmt(value[key])}`).join(" ")}]`;
  }
  return String(value);
}

// Shiprocket wants "YYYY-MM-DD HH:MM". A string that already looks like that is trimmed to 16 characters.
// An unusable date becomes the zero date rather than today's date, so a bug is visible on the label.
function formatOrderDate(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)) return value.slice(0, 16);
  const date = value instanceof Date ? value : value == null || value === "" ? null : new Date(value);
  if (!date || Number.isNaN(date.getTime())) return "0001-01-01 00:00";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizeStatus(status) {
  return String(status ?? "").trim().toLowerCase();
}

// Order updates call this. True only for delivered and "rto delivered".
export function isDelivered(status) {
  return DELIVERED.has(normalizeStatus(status));
}

// True for in-transit statuses and for delivered. The order can move to shipped on any of these.
export function isShipped(status) {
  const normalized = normalizeStatus(status);
  return SHIPPED.has(normalized) || DELIVERED.has(normalized);
}

function goQuote(value) {
  return JSON.stringify(String(value));
}

/** Parses a shipment id echoed in a webhook or stored on the order. */
// Returns a number. Throws when the text is not an integer that fits in a 64-bit signed value.
export function parseShipmentID(raw) {
  const s = String(raw ?? "").trim();
  const quoted = goQuote(s);
  if (!/^[+-]?\d+$/.test(s)) {
    throw new Error(`strconv.ParseInt: parsing ${quoted}: invalid syntax`);
  }
  let bi;
  try {
    bi = BigInt(s);
  } catch {
    throw new Error(`strconv.ParseInt: parsing ${quoted}: invalid syntax`);
  }
  const max = 9223372036854775807n;
  const min = -9223372036854775808n;
  if (bi > max || bi < min) {
    throw new Error(`strconv.ParseInt: parsing ${quoted}: value out of range`);
  }
  return Number(bi);
}

// "YYYY-MM-DD HH:MM:SS" as UTC. An impossible calendar day (32 Jan) is null, not rolled into the next month.
function parseDateTime(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

// "YYYY-MM-DD" as UTC midnight. Same rejection of impossible days.
function parseDate(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

/**
 * Registers an order with Shiprocket.
 * @param {AbortSignal | { signal?: AbortSignal } | null} ctx
 */
// Called after payment when the channel is courier. Returns { orderId, shipmentId, status }.
// Throws when Shiprocket accepts the call but does not return a shipment id, because we cannot book a pickup without one.
export async function createOrder(ctx, req) {
  const client = this;
  if (client == null || typeof client.post !== "function") throw ErrNotConfigured;
  const order = req ?? {};
  // A line with no SKU still needs one. The name is prefixed so two plants do not collide on a blank sku.
  const items = (order.items ?? []).map((line) => {
    let sku = line?.sku ?? "";
    if (sku === "") sku = `GRW-${line?.name ?? ""}`;
    return {
      name: line?.name ?? "",
      sku,
      units: line?.quantity ?? 0,
      selling_price: line?.price ?? 0,
      hsn: line?.hsn ?? "",
    };
  });

  // Missing weight or box size would be rejected. One kilogram and a 20 cm cube are the stand-in.
  let weight = Number(order.weightKg);
  if (!(weight > 0)) weight = 1;
  const dims = [Number(order.lengthCm), Number(order.breadthCm), Number(order.heightCm)];
  for (let i = 0; i < dims.length; i += 1) {
    if (!(dims[i] > 0)) dims[i] = 20;
  }

  // Prepaid only. Shipping address is the billing address. Country is India.
  const payload = {
    order_id: order.orderId ?? "",
    order_date: formatOrderDate(order.orderDate),
    pickup_location: order.pickupName ?? "",
    billing_customer_name: order.customerName ?? "",
    billing_last_name: "",
    billing_address: order.addressLine ?? "",
    billing_city: order.city ?? "",
    billing_pincode: order.pincode ?? "",
    billing_state: order.state ?? "",
    billing_country: "India",
    billing_email: order.email ?? "",
    billing_phone: order.phone ?? "",
    shipping_is_billing: true,
    order_items: items,
    payment_method: "Prepaid",
    sub_total: order.subTotal ?? order.subtotal ?? 0,
    length: dims[0],
    breadth: dims[1],
    height: dims[2],
    weight,
  };

  const out = await client.post(ctx, "/orders/create/adhoc", payload);
  const shipmentId = Number(out?.shipment_id ?? 0);
  if (!shipmentId) {
    throw new Error(
      `shiprocket: order created without a shipment id (message: ${goFmt(out?.message)}, errors: ${goFmt(out?.errors)})`,
    );
  }
  return {
    orderId: Number(out?.order_id ?? 0),
    shipmentId,
    status: out?.status ?? "",
  };
}

/** courierId 0 lets Shiprocket pick from the account's priority rules. */
// Assigns the airway bill. Returns the code, the courier name, the shipment id, and a public tracking URL.
// Throws when the response has no AWB code.
export async function generateAWB(ctx, shipmentId, courierId = 0) {
  const client = this;
  if (client == null || typeof client.post !== "function") throw ErrNotConfigured;
  const payload = { shipment_id: shipmentId };
  // Omit courier_id when it is 0 so Shiprocket applies its own priority list.
  if (courierId > 0) payload.courier_id = courierId;
  const out = await client.post(ctx, "/courier/assign/awb", payload);
  const code = out?.response?.data?.awb_code ?? "";
  if (!code) {
    throw new Error(`shiprocket: no AWB assigned (message: ${goFmt(out?.message)})`);
  }
  return {
    awbCode: code,
    courierName: out.response?.data?.courier_name ?? "",
    shipmentId,
    trackingUrl: `https://shiprocket.co/tracking/${code}`,
  };
}

// Asks the courier to collect the parcel. Called after the AWB exists. Returns nothing. Throws on a failed post.
export async function requestPickup(ctx, shipmentId) {
  const client = this;
  if (client == null || typeof client.post !== "function") throw ErrNotConfigured;
  await client.post(ctx, "/courier/generate/pickup", { shipment_id: [shipmentId] });
}

// Latest tracking for an AWB. The order poller calls this. Returns status, dates, and the activity list.
// Throws when Shiprocket has no track rows yet.
export async function track(ctx, awbCode) {
  const client = this;
  if (client == null || typeof client.get !== "function") throw ErrNotConfigured;
  const token = await client.authToken(ctx);
  const out = await client.get(ctx, token, `/courier/track/awb/${awbCode}`);
  const tracks = out?.tracking_data?.shipment_track;
  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw new Error(`shiprocket: no tracking data for AWB ${awbCode}`);
  }
  const row = tracks[0];
  const statusCode = typeof out.tracking_data?.shipment_status === "number" ? Math.trunc(out.tracking_data.shipment_status) : 0;
  const activities = Array.isArray(out.tracking_data?.shipment_track_activities)
    ? out.tracking_data.shipment_track_activities.map((activity) => ({
        date: activity?.date ?? "",
        activity: activity?.activity ?? "",
        location: activity?.location ?? "",
        "sr-status-label": activity?.["sr-status-label"] ?? "",
      }))
    : [];
  return {
    awbCode: row.awb_code ?? "",
    status: row.current_status ?? "",
    statusCode,
    courierName: row.courier_name ?? "",
    deliveredAt: parseDateTime(row.delivered_date),
    expectedDelivery: parseDate(row.edd),
    activities,
  };
}
