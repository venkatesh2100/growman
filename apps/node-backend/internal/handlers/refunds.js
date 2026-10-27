/*
This file handles refunds and cancellations for Growman orders.

An admin can start a refund on a paid order. A customer, or an admin, can
cancel an order that has not shipped yet. If that cancelled order was already
paid, we ask Razorpay to send the money back.

When Razorpay later reports that a refund was created, finished, or failed,
we write that result onto the refund row and onto the order. If we sold stock
we do not have, or an automatic refund fails, we open a support ticket so the
shop can fix it by hand.
*/

import { json, error, decode } from "../../pkg/httpjson/httpjson.js";
import { requireUser, isAdminRole } from "../auth/jwt.js";
import { recordPaymentOutcome } from "../metrics/prometheus.js";
import { Order, OrderItem, Refund, OrderSupportRequest } from "../models/index.js";

// Reasons an admin is allowed to store on a refund.
const validRefundReasons = new Set([
  "customer_cancelled", "damaged", "wrong_item", "out_of_stock", "delivery_failed", "other",
]);

// Turn a URL id such as "42" into a number.
// A missing id, a word, or a number too big to store safely comes back as null.
function parseId(raw) {
  if (!/^\d+$/.test(String(raw ?? ""))) return null;
  const parsedId = Number(raw);
  if (!Number.isSafeInteger(parsedId)) return null;
  return parsedId;
}

// Build the error thrown when a refund must not start.
// The message always starts with "refund not allowed: " so the HTTP helper can
// tell a business rule apart from a crash.
function refundNotAllowed(msg) {
  const err = new Error(`refund not allowed: ${msg}`);
  err.refundNotAllowed = true;
  return err;
}

// Turn a refund error into the status and message we send back.
// A "refund not allowed" error is a conflict. Every other error is a server failure.
function refundErrorResponse(err) {
  const text = String(err?.message || "");
  const marker = "refund not allowed: ";
  if (text.includes(marker)) {
    const msg = text.slice(text.indexOf(marker) + marker.length);
    return { status: 409, msg };
  }
  return { status: 500, msg: "failed to process refund" };
}

// Start a refund for one order.
// An admin calls this from POST /api/v1/orders/:id/refund.
export async function createRefund(req, res) {
  // The caller must be signed in. requireUser already wrote the error if not.
  const claims = requireUser(req, res);
  if (!claims) return;

  // Only an admin may start a refund from this route.
  if (!isAdminRole(claims.role)) {
    error(res, 403, "admin access required");
    return;
  }

  // The order id is in the URL. Stop if it is not a plain number.
  const orderId = parseId(req.params.id);
  if (orderId == null) {
    error(res, 400, "invalid order ID");
    return;
  }

  // Read the JSON body. Stop if it is missing or not an object.
  const body = decode(req, res);
  if (!body) return;

  // "other" is the reason when the admin left it blank. Stop if the reason is unknown.
  let reason = body.reason || "other";
  if (!validRefundReasons.has(reason)) {
    error(res, 400, "invalid refund reason");
    return;
  }

  // Load the order and the plants on it. Stop if the database errors or the order is missing.
  let order;
  try {
    order = await Order.findOne({ where: { id: orderId }, include: [{ model: OrderItem, as: "items" }] });
  } catch {
    error(res, 500, "failed to load order");
    return;
  }
  if (!order) {
    error(res, 404, "order not found");
    return;
  }

  // Ask Razorpay for the money back and save the refund row.
  // amount 0 means "refund whatever is still left". restock puts the plants back on the shelf.
  let refund;
  try {
    refund = await this.initiateRefund(order, Number(body.amount || 0), reason, body.notes || "", claims.userId, Boolean(body.restock));
  } catch (err) {
    const mapped = refundErrorResponse(err);
    error(res, mapped.status, mapped.msg);
    return;
  }

  // Tell the admin the refund row we saved.
  json(res, 200, { success: true, refund: refund.toJSON ? refund.toJSON() : refund });

  // Tell the customer that a refund has started. A failed notice does not undo the refund.
  try {
    await this.notifyOrderEvent(order, "Refund started", "A refund has been started for this order.", "refund-started");
  } catch (err) {
    console.log(`[NOTIFY] refund started: ${err.message}`);
  }
}

// Cancel an order that has not shipped.
// The customer calls POST /api/v1/orders/:id/cancel. An admin can cancel any order.
export async function cancelOrder(req, res) {
  // The caller must be signed in.
  const claims = requireUser(req, res);
  if (!claims) return;

  // The order id is in the URL. Stop if it is not a plain number.
  const orderId = parseId(req.params.id);
  if (orderId == null) {
    error(res, 400, "invalid order ID");
    return;
  }

  // The reason is optional. An empty body is allowed.
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};

  // A customer may cancel only their own order. An admin may cancel any order.
  const where = { id: orderId };
  if (!isAdminRole(claims.role)) where.userId = claims.userId;

  // Load the order and its plants. Stop if the database errors or the order is not theirs.
  let order;
  try {
    order = await Order.findOne({ where, include: [{ model: OrderItem, as: "items" }] });
  } catch {
    error(res, 500, "failed to load order");
    return;
  }
  if (!order) {
    error(res, 404, "order not found");
    return;
  }

  // Stop if the order has already shipped, been handed to a courier, or been cancelled.
  if (typeof order.isCancellable === "function" ? !order.isCancellable() : !isCancellable(order)) {
    json(res, 409, {
      error: "not_cancellable",
      reason: "This order has already shipped or been cancelled. Contact support for a return.",
    });
    return;
  }

  // Mark the order cancelled and put the reserved plants back in stock, in one database transaction.
  const now = new Date();
  let reason = String(body.reason ?? "").trim();
  if (!reason) reason = "customer_cancelled";
  try {
    await this.sequelize.transaction(async (tx) => {
      await Order.update(
        { status: "cancelled", cancelledAt: now, cancelReason: reason },
        { where: { id: order.id }, transaction: tx },
      );
      await this.releaseOrderInventory(tx, order);
    });
  } catch (err) {
    console.log(`[REFUND] cancel order ${order.id}: ${err.message}`);
    error(res, 500, "failed to cancel order");
    return;
  }

  // If the customer already paid and we have not refunded the full amount, ask Razorpay for the money back.
  const response = { success: true, status: "cancelled" };
  if (order.paymentStatus === "paid" && Number(order.refundedAmount || 0) < Number(order.amount)) {
    try {
      const refund = await this.initiateRefund(order, 0, "customer_cancelled", reason, null, false);
      response.refund = refund.toJSON ? refund.toJSON() : refund;
      response.message = "Order cancelled. Your refund is on its way.";
    } catch (err) {
      // The order is already cancelled. If Razorpay refuses the refund, open a ticket so a person can send the money.
      console.log(`[REFUND] auto-refund for cancelled order ${order.id} failed: ${err.message}`);
      await this.raiseRefundSupportRequest(order, err);
      response.refund = "pending_manual";
      response.message = "Order cancelled. Our team will process your refund shortly.";
    }
  } else {
    // Unpaid orders, and orders already refunded in full, need no money movement.
    response.message = "Order cancelled.";
  }

  // Email the customer after we have answered. A mail failure must not change the cancel result.
  setImmediate(() => {
    Promise.resolve(this.sendOrderCancelledEmail(order, reason)).catch((err) => {
      console.log(`[EMAIL] order cancelled: ${err.message}`);
    });
  });

  // In-app notice for the new status. Then a second notice when an automatic refund actually started.
  order.status = "cancelled";
  await this.notifyStatus(order);
  if (response.refund != null && response.refund !== "pending_manual") {
    try {
      await this.notifyOrderEvent(order, "Refund started", "Your refund has been requested.", "refund-started");
    } catch (err) {
      console.log(`[NOTIFY] refund: ${err.message}`);
    }
  }
  json(res, 200, response);
}

// Decide whether this order can still be cancelled.
// A tracking number, a ship time, or a cancel time means it is too late.
// Only pending, paid, confirmed, and processing orders can be cancelled.
function isCancellable(order) {
  if (order.cancelledAt || order.awbNumber || order.shippedAt) return false;
  return ["pending", "paid", "confirmed", "processing"].includes(order.status);
}

// Create the refund row and ask Razorpay to send the money.
// Called by the admin refund route, and again when a paid order is cancelled.
// amount of 0 means refund whatever is still left on the order.
export async function initiateRefund(order, amount, reason, notes, initiatedBy, restock) {
  // A refund needs a captured payment. Stop before we talk to Razorpay if that is missing.
  if (order.paymentStatus !== "paid") throw refundNotAllowed("order is not paid");
  if (!order.razorpayPaymentId) throw refundNotAllowed("order has no captured payment to refund");

  // Work out how many rupees are still refundable.
  const remaining = Number(order.amount) - Number(order.refundedAmount || 0);
  if (remaining <= 0) throw refundNotAllowed("order is already fully refunded");

  // No positive amount means "refund the rest". Round to the nearest paisa.
  let refundAmount = amount;
  if (!(refundAmount > 0)) refundAmount = remaining;
  refundAmount = Math.trunc(refundAmount * 100 + 0.5) / 100;
  if (refundAmount > remaining + 0.01) {
    throw refundNotAllowed(`refund of ${refundAmount.toFixed(2)} exceeds the ${remaining.toFixed(2)} remaining`);
  }

  // Save a pending refund first, so we have a record even if Razorpay is slow.
  let refund = await Refund.create({
    orderId: order.id,
    razorpayPaymentId: order.razorpayPaymentId,
    amount: refundAmount,
    currency: order.currency || "INR",
    status: "pending",
    reason,
    notes: notes || "",
    initiatedBy: initiatedBy ?? null,
  });

  // Put the plants back on the shelf when the admin asked for a restock.
  // A stock error is logged and does not cancel the money refund.
  if (restock) {
    try {
      await this.sequelize.transaction(async (tx) => {
        await this.releaseOrderInventory(tx, order);
        await Refund.update({ restockedInventory: true }, { where: { id: refund.id }, silent: true, transaction: tx });
      });
    } catch (err) {
      console.log(`[REFUND] restock for order ${order.id}: ${err.message}`);
    }
  }

  // Ask Razorpay to refund this payment. If they refuse, mark our row failed and surface the error.
  let providerRefund;
  try {
    providerRefund = await this.createRazorpayRefund(order.razorpayPaymentId, refundAmount, reason, order.id);
  } catch (err) {
    const note = `${notes || ""} provider error: ${err.message}`.trim();
    try {
      await Refund.update({ status: "failed", notes: note }, { where: { id: refund.id } });
    } catch (dbErr) {
      console.log(`[REFUND] mark failed: ${dbErr.message}`);
    }
    refund.status = "failed";
    throw new Error(`provider refund failed: ${err.message}`);
  }

  // Remember Razorpay's refund id so later webhooks can find this row.
  refund.razorpayRefundId = providerRefund.id;
  try {
    await Refund.update({ razorpayRefundId: providerRefund.id }, { where: { id: refund.id }, silent: true });
  } catch (err) {
    console.log(`[REFUND] store provider refund id: ${err.message}`);
  }

  // Razorpay sometimes settles instantly. Apply that result now so the order shows the refund
  // before the webhook arrives. The webhook later sees the same status and does nothing.
  if (providerRefund.status === "processed") {
    try {
      await this.applyRefundOutcome(providerRefund.id, order.razorpayPaymentId, refundAmount, "processed", "");
    } catch (err) {
      console.log(`[REFUND] apply immediate outcome: ${err.message}`);
    }
  }
  recordPaymentOutcome("refunded");
  return refund;
}

// Write the latest refund result from Razorpay onto our refund row and the order.
// Called from the refund webhook, and again when Razorpay says the refund already settled.
// A refund created in the Razorpay dashboard (no row yet) is inserted here.
export async function applyRefundOutcome(providerRefundId, paymentId, amount, status, errMsg) {
  await this.sequelize.transaction(async (tx) => {
    // Find the refund we started. If this refund was made in the Razorpay dashboard, create the row now.
    let refund = await Refund.findOne({ where: { razorpayRefundId: providerRefundId }, transaction: tx });
    if (!refund) {
      const order = await Order.findOne({ where: { razorpayPaymentId: paymentId }, transaction: tx });
      refund = await Refund.create(
        {
          razorpayRefundId: providerRefundId,
          razorpayPaymentId: paymentId,
          amount,
          currency: "INR",
          status: "pending",
          reason: "other",
          notes: "created outside the application (dashboard refund)",
          orderId: order ? order.id : 0,
        },
        { transaction: tx },
      );
    }

    // The same status arrived twice. Nothing new to write.
    if (refund.status === status) return;

    // Money already sent cannot be walked back by a later "failed" or "pending" event.
    if (refund.status === "processed") {
      if (status !== "processed") {
        console.log(`[REFUND] ignoring ${status} for already-settled refund ${providerRefundId}`);
      }
      return;
    }

    // Save the new status. Keep Razorpay's amount when they sent one.
    const updates = { status, processedAt: new Date() };
    if (errMsg) updates.notes = `${refund.notes || ""} ${errMsg}`.trim();
    if (amount > 0) {
      updates.amount = amount;
      refund.amount = amount;
    }
    await Refund.update(updates, { where: { id: refund.id }, transaction: tx });

    // Only a finished refund changes how much the customer has been paid back.
    // The order becomes "refunded" when the running total covers the order, otherwise "partially_refunded".
    if (status !== "processed" || !refund.orderId) return;
    await this.sequelize.query(
      `UPDATE orders
       SET refunded_amount = LEAST(refunded_amount + $1, amount),
           payment_status = CASE
             WHEN refunded_amount + $1 >= amount - 0.01 THEN 'refunded'
             ELSE 'partially_refunded'
           END,
           updated_at = NOW()
       WHERE id = $2`,
      { bind: [refund.amount, refund.orderId], transaction: tx },
    );
  });
}

// Ask Razorpay to refund one captured payment.
// Called from initiateRefund after we have saved our own pending refund row.
export async function createRazorpayRefund(paymentId, amount, reason, orderId) {
  // Stop before the network call if the shop has no Razorpay keys.
  if (!this.cfg.razorpayKeyID || !this.cfg.razorpayKeySecret) {
    throw new Error("razorpay credentials not configured");
  }

  // Razorpay wants the amount in paise, not rupees.
  const paise = Math.trunc(amount * 100 + 0.5);
  const auth = Buffer.from(`${this.cfg.razorpayKeyID}:${this.cfg.razorpayKeySecret}`).toString("base64");
  const resp = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refund`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Basic " + auth },
    body: JSON.stringify({
      amount: paise,
      speed: "normal",
      notes: { reason, order_id: String(orderId) },
      receipt: `refund_${orderId}_${paise}`,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const raw = await resp.text();
  if (resp.status !== 200) {
    console.log(`[RAZORPAY] refund error response: ${raw}`);
    throw new Error(`razorpay refund API returned ${resp.status}`);
  }
  return JSON.parse(raw);
}

// List recent refunds for the admin screen.
// An admin calls GET /api/v1/refunds. Optional ?status= filters the list.
export async function listRefunds(req, res) {
  // The caller must be signed in, and must be an admin.
  const claims = requireUser(req, res);
  if (!claims) return;
  if (!isAdminRole(claims.role)) {
    error(res, 403, "admin access required");
    return;
  }

  // "all" or a blank status means every refund. Anything else is an exact status match.
  const where = {};
  const status = String(req.query?.status ?? "").trim();
  if (status && status !== "all") where.status = status;

  // Newest refunds first, capped so the admin page stays small.
  let refunds;
  try {
    refunds = await Refund.findAll({ where, order: [["createdAt", "DESC"]], limit: 200 });
  } catch (err) {
    console.log(`[REFUND] list: ${err.message}`);
    error(res, 500, "failed to load refunds");
    return;
  }
  json(res, 200, { refunds: refunds.map((refundRow) => refundRow.toJSON()), count: refunds.length });
}

// Open an urgent support ticket when a customer paid but we could not reserve the plants.
// Called from markOrderPaid after the payment is saved. The customer is not shown this ticket.
export async function raiseOversellSupportRequest(order, cause) {
  try {
    await OrderSupportRequest.create({
      orderId: order.id,
      userId: order.userId ?? null,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      customerPhone: order.customerPhone,
      issueType: "order_support",
      priority: "urgent",
      status: "pending",
      source: "system",
      userMessage: `Order #${order.id} was paid but its stock could not be reserved (${cause?.message || cause}). Source the stock or refund the customer.`,
      orderAmount: order.amount,
      orderStatus: order.status,
      paymentStatus: order.paymentStatus,
    });
  } catch (err) {
    console.log(`[INVENTORY] could not record oversell support request for order ${order.id}: ${err.message}`);
  }
}

// Open an urgent support ticket when cancelling a paid order could not start the refund.
// Called from cancelOrder so a person can send the money back by hand.
export async function raiseRefundSupportRequest(order, cause) {
  try {
    await OrderSupportRequest.create({
      orderId: order.id,
      userId: order.userId ?? null,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      customerPhone: order.customerPhone,
      issueType: "refund",
      priority: "urgent",
      status: "pending",
      source: "system",
      userMessage: `Automatic refund for cancelled order #${order.id} failed and needs manual processing: ${cause?.message || cause}`,
      orderAmount: order.amount,
      orderStatus: order.status,
      paymentStatus: order.paymentStatus,
    });
  } catch (err) {
    console.log(`[REFUND] raise support request: ${err.message}`);
  }
}
