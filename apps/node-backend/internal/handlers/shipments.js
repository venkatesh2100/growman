// Courier shipping through Shiprocket.
//
// A paid order on the courier channel gets a Shiprocket shipment and an AWB
// tracking number, then the order is marked shipped. Admins can book a
// shipment or ask the courier to pick it up. Shiprocket tells us about
// movement through a webhook, and a background worker books anything still
// waiting and refreshes tracking. Store pickup and our own vehicle are not
// booked here.

import { Op, literal } from "sequelize";
import { json, error } from "../../pkg/httpjson/httpjson.js";
import { Order, OrderItem } from "../models/index.js";

// Thrown by the Shiprocket client when the shop has no courier login.
const NOT_CONFIGURED = "shiprocket credentials not configured";

// Order ids in the URL must be a plain positive integer.
function parseId(raw) {
  if (!/^\d+$/.test(String(raw ?? ""))) return null;
  const parsedId = Number(raw);
  if (!Number.isSafeInteger(parsedId)) return null;
  return parsedId;
}

// The courier client uses one message when credentials are missing. Callers turn that into "not configured".
function notConfigured(err) {
  return String(err?.message || "").includes(NOT_CONFIGURED);
}

// Shiprocket status text is compared in lower case with surrounding spaces removed.
function normalizeStatus(status) {
  return String(status ?? "").trim().toLowerCase();
}

// The parcel has reached the customer, including a return that was delivered back to us.
export function isDelivered(status) {
  const normalized = normalizeStatus(status);
  return normalized === "delivered" || normalized === "rto delivered";
}

// The parcel has left the nursery. Delivered counts as shipped so a late webhook still moves the order forward.
export function isShipped(status) {
  const normalized = normalizeStatus(status);
  return ["shipped", "in transit", "out for delivery", "picked up", "reached destination hub"].includes(normalized) || isDelivered(status);
}

// Shiprocket shipment ids are integers and may be negative in their API. Anything else is rejected.
function parseShipmentId(raw) {
  const text = String(raw ?? "").trim();
  if (!/^-?\d+$/.test(text)) return null;
  const parsedId = Number(text);
  if (!Number.isSafeInteger(parsedId)) return null;
  return parsedId;
}

// Each unit is booked as one kilogram. The courier quote uses the same rough weight.
function estimateLineWeight(item) {
  return Number(item.quantity || 0) * 1;
}

// Admin: book a courier shipment for one order.
// If an AWB is already stored, the same tracking details are returned and Shiprocket is not called again.
export async function createShipment(req, res) {
  const orderId = parseId(req.params.id);
  if (orderId == null) {
    error(res, 400, "invalid order ID");
    return;
  }
  let order;
  try {
    // Lines are required so the courier order lists every product.
    order = await Order.findOne({ where: { id: orderId }, include: [{ model: OrderItem, as: "items" }] });
  } catch {
    error(res, 404, "order not found");
    return;
  }
  if (!order) {
    error(res, 404, "order not found");
    return;
  }
  if (order.awbNumber) {
    json(res, 200, {
      success: true,
      alreadyDone: true,
      awbNumber: order.awbNumber,
      trackingUrl: order.trackingUrl,
    });
    return;
  }
  let awb;
  try {
    awb = await this.bookShipment(order);
  } catch (err) {
    if (notConfigured(err)) {
      error(res, 503, "courier integration is not configured");
      return;
    }
    console.log(`[SHIPMENT] book for order ${order.id}: ${err.message}`);
    error(res, 502, "failed to book shipment: " + err.message);
    return;
  }
  json(res, 200, {
    success: true,
    awbNumber: awb.awbCode,
    courier: awb.courierName,
    trackingUrl: awb.trackingUrl,
  });
}

// Create the Shiprocket order, store the shipment id, then ask for an airway bill.
// The order must be paid, not cancelled, and on the courier channel.
export async function bookShipment(order) {
  if (!this.shiprocket) throw new Error(NOT_CONFIGURED);
  if (order.paymentStatus !== "paid") throw new Error("order is not paid");
  if (order.cancelledAt) throw new Error("order is cancelled");
  if (order.fulfillmentChannel !== "courier") {
    throw new Error(`order channel ${JSON.stringify(order.fulfillmentChannel)} is not shipped by courier`);
  }
  let weight = 0;
  // Each line becomes a courier item. The SKU ties the parcel back to the product and size.
  const lines = (order.items || []).map((item) => {
    weight += estimateLineWeight(item);
    const sizeId = item.productSizeId ?? 0;
    return {
      name: item.name,
      sku: `GRW-${item.productId}-${sizeId}`,
      quantity: item.quantity,
      price: item.price,
    };
  });
  const pickupName = String(this.cfg.shiprocketPickupLocation || "").trim() || "Primary";
  let created;
  try {
    created = await this.shiprocket.createOrder({
      orderId: `GRW-${order.id}`,
      orderDate: order.createdAt,
      pickupName,
      customerName: order.customerName,
      phone: order.customerPhone,
      email: order.customerEmail,
      addressLine: order.addressLine,
      city: order.city,
      state: order.state,
      pincode: order.pincode,
      items: lines,
      subTotal: order.subtotal,
      weightKg: weight,
    });
  } catch (err) {
    throw new Error(`create provider order: ${err.message}`);
  }
  // Shiprocket has used more than one field name for the shipment id.
  const shipmentId = created.shipmentId ?? created.shipmentID ?? created.ShipmentID;
  try {
    await Order.update({ shipmentId: String(shipmentId) }, { where: { id: order.id }, silent: true });
  } catch (err) {
    console.log(`[SHIPMENT] persist shipment id: ${err.message}`);
  }
  order.shipmentId = String(shipmentId);
  let awb;
  try {
    // Courier id 0 lets Shiprocket pick the service.
    awb = await this.shiprocket.generateAWB(Number(shipmentId), 0);
  } catch (err) {
    throw new Error(`assign AWB: ${err.message}`);
  }
  const awbCode = awb.awbCode ?? awb.AWBCode;
  const courierName = awb.courierName ?? awb.CourierName ?? "";
  const trackingUrl = awb.trackingUrl ?? awb.trackingURL ?? awb.TrackingURL ?? "";
  const now = new Date();
  // Saving the AWB also marks the shop order as shipped.
  try {
    await Order.update(
      {
        awbNumber: awbCode,
        courierService: courierName,
        trackingUrl,
        status: "shipped",
        shippedAt: now,
      },
      { where: { id: order.id } },
    );
  } catch (err) {
    throw new Error(`persist AWB: ${err.message}`);
  }
  order.awbNumber = awbCode;
  order.courierService = courierName;
  order.trackingUrl = trackingUrl;
  order.shippedAt = now;
  order.status = "shipped";
  // The shipped email goes out after this function returns, so a slow mailbox does not block booking.
  setImmediate(() => {
    Promise.resolve(this.sendOrderShippedEmail(order)).catch((err) => console.log(`[EMAIL] order shipped: ${err.message}`));
  });
  await this.invalidateOrderCaches();
  return { awbCode, courierName, trackingUrl };
}

// Admin: ask Shiprocket to collect a shipment that already has a shipment id.
export async function schedulePickup(req, res) {
  const orderId = parseId(req.params.id);
  if (orderId == null) {
    error(res, 400, "invalid order ID");
    return;
  }
  let order;
  try {
    order = await Order.findByPk(orderId);
  } catch {
    error(res, 404, "order not found");
    return;
  }
  if (!order) {
    error(res, 404, "order not found");
    return;
  }
  // Pickup is only meaningful after bookShipment has stored a Shiprocket shipment id.
  if (!order.shipmentId) {
    error(res, 409, "book a shipment for this order first");
    return;
  }
  if (!this.shiprocket) {
    error(res, 503, "courier integration is not configured");
    return;
  }
  const shipmentId = parseShipmentId(order.shipmentId);
  if (shipmentId == null) {
    error(res, 409, "stored shipment ID is not valid");
    return;
  }
  try {
    await this.shiprocket.requestPickup(shipmentId);
  } catch (err) {
    console.log(`[SHIPMENT] pickup for order ${order.id}: ${err.message}`);
    error(res, 502, "failed to schedule pickup: " + err.message);
    return;
  }
  const now = new Date();
  try {
    await Order.update({ pickupBookedAt: now }, { where: { id: order.id }, silent: true });
  } catch (err) {
    console.log(`[SHIPMENT] persist pickup time: ${err.message}`);
  }
  json(res, 200, { success: true, pickupBookedAt: now });
}

// Shiprocket posts tracking updates here.
// The shared secret is the x-api-key header. A repeated AWB plus status is acknowledged and ignored.
export async function shiprocketWebhook(req, res) {
  const expected = String(this.cfg.shiprocketWebhookToken || "").trim();
  if (!expected) {
    error(res, 503, "shipment webhooks are not configured");
    return;
  }
  const provided = String(req.get("x-api-key") || "").trim();
  if (!provided || provided !== expected) {
    console.log("[WEBHOOK] shiprocket: bad or missing x-api-key");
    error(res, 401, "invalid token");
    return;
  }
  const raw = req.rawBody;
  if (!raw) {
    error(res, 400, "failed to read request body");
    return;
  }
  // Only the first megabyte of the body is parsed.
  const body = (Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw))).subarray(0, 1 << 20).toString("utf8");
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    error(res, 400, "invalid payload");
    return;
  }
  if (!payload.awb) {
    error(res, 400, "awb is required");
    return;
  }
  // The same AWB and status posted twice is one event, so a retry cannot move the order twice.
  const eventId = `shiprocket:${payload.awb}:${payload.current_status}`;
  let claimed;
  try {
    claimed = await this.claimWebhookEvent("shiprocket", eventId, payload.current_status, body);
  } catch (err) {
    console.log(`[WEBHOOK] shiprocket claim: ${err.message}`);
    error(res, 500, "failed to record event");
    return;
  }
  if (!claimed) {
    json(res, 200, { success: true, duplicate: true });
    return;
  }
  // Reply first, then apply the status. Shiprocket does not wait on our database.
  json(res, 200, { success: true });
  this.applyShipmentStatus(payload.awb, payload.current_status, payload.courier_name)
    .then(() => this.finishWebhookEvent(eventId, "processed", null))
    .catch((err) => {
      console.log(`[WEBHOOK] shiprocket apply status: ${err.message}`);
      return this.finishWebhookEvent(eventId, "failed", err);
    });
}

// Move the shop order that owns this AWB to shipped or delivered.
// Statuses we do not recognise are left alone.
export async function applyShipmentStatus(awb, status, courier) {
  const order = await Order.findOne({ where: { awbNumber: awb } });
  if (!order) {
    console.log(`[SHIPMENT] no order for AWB ${awb}`);
    return;
  }
  const updates = {};
  // The courier name is filled in once, the first time Shiprocket sends it.
  if (courier && !order.courierService) updates.courierService = courier;
  const now = new Date();
  if (isDelivered(status)) {
    if (!order.deliveredAt) updates.deliveredAt = now;
    updates.status = "delivered";
  } else if (isShipped(status)) {
    if (!order.shippedAt) updates.shippedAt = now;
    updates.status = "shipped";
  } else {
    return;
  }
  await Order.update(updates, { where: { id: order.id } });
  await this.invalidateOrderCaches();
}

// Ask Shiprocket for a fresh status on up to 50 open courier orders.
// Delivered and cancelled orders are skipped. The oldest shipped parcels are checked first.
export async function refreshShipmentTracking() {
  if (!this.shiprocket) return 0;
  const orders = await Order.findAll({
    where: {
      awbNumber: { [Op.ne]: "" },
      deliveredAt: null,
      cancelledAt: null,
    },
    order: [literal("shipped_at ASC NULLS FIRST")],
    limit: 50,
  });
  let updated = 0;
  for (const order of orders) {
    let status;
    try {
      status = await this.shiprocket.track(order.awbNumber);
    } catch (err) {
      console.log(`[SHIPMENT] track ${order.awbNumber}: ${err.message}`);
      continue;
    }
    try {
      await this.applyShipmentStatus(order.awbNumber, status.status ?? status.Status, status.courierName ?? status.CourierName);
      updated++;
    } catch (err) {
      console.log(`[SHIPMENT] apply tracked status: ${err.message}`);
    }
  }
  return updated;
}

// Background loop: book paid courier orders that still have no AWB, refresh tracking, then send review-request emails.
// The default gap is fifteen minutes. Stopping the server clears the timer.
export async function startShipmentWorker(signal, everyMs) {
  if (!this.shiprocket) return;
  let every = everyMs;
  if (!every || every <= 0) every = 15 * 60 * 1000;
  const tick = async () => {
    await this.bookPendingShipments();
    try {
      await this.refreshShipmentTracking();
    } catch (err) {
      console.log(`[SHIPMENT] refresh tracking: ${err.message}`);
    }
    try {
      await this.sendReviewRequests();
    } catch (err) {
      console.log(`[REVIEW] send requests: ${err.message}`);
    }
  };
  const timer = setInterval(() => {
    if (signal?.aborted) {
      clearInterval(timer);
      return;
    }
    tick().catch((err) => console.log(`[SHIPMENT] worker: ${err.message}`));
  }, every);
  signal?.addEventListener?.("abort", () => clearInterval(timer), { once: true });
}

// Book the next batch of paid courier orders that have an empty AWB and have not been cancelled.
export async function bookPendingShipments() {
  let orders;
  try {
    orders = await Order.findAll({
      where: {
        paymentStatus: "paid",
        fulfillmentChannel: "courier",
        awbNumber: "",
        cancelledAt: null,
      },
      include: [{ model: OrderItem, as: "items" }],
      limit: 20,
    });
  } catch (err) {
    console.log(`[SHIPMENT] load pending: ${err.message}`);
    return;
  }
  for (const order of orders) {
    try {
      await this.bookShipment(order);
    } catch (err) {
      // One failed booking is logged and the rest of the batch still runs.
      console.log(`[SHIPMENT] auto-book order ${order.id}: ${err.message}`);
    }
  }
}

// Drop cached order lists so the shop and the admin screen see the new shipped or delivered status.
export async function invalidateOrderCaches() {
  if (!this.cache) return;
  await this.cache.deletePattern("orders:*");
}
