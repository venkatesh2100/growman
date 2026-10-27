/*
This file receives payment news from Razorpay.

Razorpay calls POST /webhooks/razorpay when a payment is captured, fails,
when a refund moves, or when a customer opens a dispute. We check Razorpay's
signature, ignore events that are too old or already seen, answer quickly,
and then update the order.

A captured payment marks the order paid. A failed payment puts the reserved
plants back in stock, unless the order was already paid. Refund events update
the refund row. A dispute opens a support ticket and alerts the shop.
*/

import { Op } from "sequelize";
import { json, error } from "../../pkg/httpjson/httpjson.js";
import { recordPaymentSignatureFailure } from "../metrics/prometheus.js";
import { Order, OrderItem, WebhookEvent, OrderSupportRequest } from "../models/index.js";
import { verifyRazorpayHMAC } from "./payments.js";

// Events older than 10 minutes are acknowledged and then skipped.
const maxWebhookAgeMs = 10 * 60 * 1000;

// True when Postgres rejected the insert because this event id was already saved.
// That is how we notice a duplicate webhook delivery.
function isUniqueViolation(err) {
  if (!err) return false;
  if (err.name === "SequelizeUniqueConstraintError") return true;
  const msg = String(err.message || err.parent?.message || "").toLowerCase();
  return msg.includes("duplicate key") || msg.includes("unique constraint") || msg.includes("23505") || err.parent?.code === "23505";
}

// Check that this body really came from Razorpay.
// Uses the webhook secret, which is different from the API key secret.
export function verifyWebhookSignature(body, signature) {
  return verifyRazorpayHMAC(this.cfg.razorpayWebhookSecret, body, signature);
}

// Save this event id the first time we see it.
// Returns false when the same event was already saved, so the caller can stop.
// Any other database error is thrown so Razorpay will retry.
export async function claimWebhookEvent(provider, eventId, eventType, body) {
  try {
    await WebhookEvent.create({
      provider,
      eventId,
      eventType,
      status: "received",
      payload: body,
    });
    return true;
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}

// Mark a saved webhook event as processed or failed.
// Called after we finish the order update, and also when that update throws.
// A failure here is only logged, because Razorpay has already been answered.
export async function finishWebhookEvent(eventId, status, cause) {
  const updates = { status, processedAt: new Date() };
  if (cause) updates.error = cause.message || String(cause);
  try {
    await WebhookEvent.update(updates, { where: { eventId }, silent: true });
  } catch (err) {
    console.log(`[WEBHOOK] update event status: ${err.message}`);
  }
}

// Pull one named object out of a Razorpay event body.
// Razorpay wraps each object as { entity: { ... } }. We want the inner object.
function webhookEntity(payload, name) {
  const wrapper = payload?.[name];
  if (!wrapper || typeof wrapper !== "object") throw new Error(`missing ${name} in payload`);
  const entity = wrapper.entity;
  if (!entity || typeof entity !== "object") throw new Error(`invalid ${name} entity`);
  return entity;
}

// Razorpay sends money in paise. Turn that into rupees.
// A missing or unreadable amount becomes 0.
function paiseToRupees(raw) {
  if (typeof raw === "number") return raw / 100;
  if (typeof raw === "string" && raw.trim() && !Number.isNaN(Number(raw))) return Number(raw) / 100;
  return 0;
}

// Read the refund id, payment id, and rupee amount from a refund event.
// Throws when the refund id is missing, because we cannot record the result without it.
function refundEventFields(payload) {
  const refundEntity = webhookEntity(payload, "refund");
  const refundId = refundEntity.id || "";
  const paymentId = refundEntity.payment_id || "";
  if (!refundId) throw new Error("refund event missing id");
  return { refundId, paymentId, amount: paiseToRupees(refundEntity.amount) };
}

// Razorpay's webhook entry point. POST /webhooks/razorpay.
// Proves the body with a signature, skips stale and duplicate events, answers 200,
// then updates the order in the background.
export async function razorpayWebhook(req, res) {
  // The raw body is what Razorpay signed. Stop if the server did not keep it.
  const raw = req.rawBody;
  if (!raw) {
    error(res, 400, "failed to read request body");
    return;
  }
  const body = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);

  // No signature header means we will not trust the body.
  const signature = req.get("X-Razorpay-Signature") || "";
  if (!signature) {
    error(res, 400, "missing signature");
    return;
  }

  // A bad signature is rejected. This usually means the webhook secret does not match the dashboard.
  if (!this.verifyWebhookSignature(body, signature)) {
    console.log("[WEBHOOK] invalid signature (check RAZORPAY_WEBHOOK_SECRET matches the dashboard webhook secret, not the API key secret)");
    recordPaymentSignatureFailure("webhook");
    error(res, 401, "invalid signature");
    return;
  }

  // The signature matched, so it is safe to read the JSON.
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    error(res, 400, "invalid payload");
    return;
  }

  // Drop events older than 10 minutes. We still answer 200 so Razorpay stops resending them.
  if (payload.created_at > 0) {
    const age = Date.now() - payload.created_at * 1000;
    if (age > maxWebhookAgeMs) {
      console.log(`[WEBHOOK] discarding stale event ${payload.event} (age ${Math.round(age / 1000)}s)`);
      json(res, 200, { success: true, skipped: "stale" });
      return;
    }
  }

  // Prefer Razorpay's event id. If the header is missing, build a stable id from the event name and time.
  let eventId = req.get("X-Razorpay-Event-Id") || "";
  if (!eventId) eventId = `derived:${payload.event}:${payload.created_at}`;

  // Save the event once. A duplicate delivery is acknowledged and not processed again.
  let claimed;
  try {
    claimed = await this.claimWebhookEvent("razorpay", eventId, payload.event, body);
  } catch (err) {
    console.log(`[WEBHOOK] claim event: ${err.message}`);
    error(res, 500, "failed to record event");
    return;
  }
  if (!claimed) {
    json(res, 200, { success: true, duplicate: true });
    return;
  }

  // Answer before the order update, emails, and stock changes. Razorpay retries if we are slow.
  json(res, 200, { success: true });
  this.processRazorpayEvent(eventId, payload).catch((err) => console.log(`[WEBHOOK] process: ${err.message}`));
}

// Apply one saved Razorpay event to the order, then mark the event processed or failed.
// Runs after razorpayWebhook has already answered Razorpay.
export async function processRazorpayEvent(eventId, payload) {
  let err = null;
  try {
    switch (payload.event) {
      // Both events mean the customer's payment succeeded.
      case "payment.captured":
      case "order.paid":
        await this.handlePaymentCaptured(payload.payload);
        break;
      // The bank or wallet refused the payment.
      case "payment.failed":
        await this.handlePaymentFailed(payload.payload);
        break;
      // Razorpay accepted a refund request. The money may not have moved yet.
      case "refund.created":
        await this.handleRefundCreated(payload.payload);
        break;
      // The refund has been settled.
      case "refund.processed":
        await this.handleRefundProcessed(payload.payload);
        break;
      // Razorpay could not complete the refund.
      case "refund.failed":
        await this.handleRefundFailed(payload.payload);
        break;
      // The customer disputed the charge with their bank.
      case "payment.dispute.created":
        await this.handleDisputeCreated(payload.payload);
        break;
      // Events we do not act on are still marked processed so they are not retried as failures.
      default:
        await this.finishWebhookEvent(eventId, "processed", null);
        return;
    }
  } catch (cause) {
    err = cause;
  }

  // A thrown handler marks the event failed. A clean finish marks it processed.
  if (err) {
    console.log(`[WEBHOOK] ${payload.event}: ${err.message}`);
    await this.finishWebhookEvent(eventId, "failed", err);
    return;
  }
  await this.finishWebhookEvent(eventId, "processed", null);
}

// Mark the matching order paid after Razorpay says the payment was captured.
// Called for payment.captured and order.paid.
export async function handlePaymentCaptured(payload) {
  const paymentEntity = webhookEntity(payload, "payment");
  const razorpayPaymentId = paymentEntity.id;
  if (typeof razorpayPaymentId !== "string") throw new Error("invalid payment ID");

  // The payment usually carries the Razorpay order id. order.paid may put it on the order object instead.
  let razorpayOrderId = paymentEntity.order_id || "";
  if (!razorpayOrderId) {
    try {
      const orderEntity = webhookEntity(payload, "order");
      razorpayOrderId = orderEntity.id || "";
    } catch {
      /* payment.captured may omit the order entity */
    }
  }
  if (!razorpayOrderId) throw new Error("event carries no order reference");

  // Find the checkout order we created for this Razorpay order. Stop quietly if we never saved it.
  const order = await Order.findOne({
    where: { razorpayOrderId },
    include: [{ model: OrderItem, as: "items" }],
  });
  if (!order) {
    console.log(`[WEBHOOK] order not found: ${razorpayOrderId}`);
    return;
  }

  // Same path as the app's payment-verify call: save the payment, keep the stock, email the customer.
  const firstTimePaid = await this.markOrderPaid(order, razorpayPaymentId);
  await this.notifyOrderPaid(order, firstTimePaid);
}

// Mark the order failed and give the reserved plants back.
// Called when Razorpay sends payment.failed. Does nothing if the order is already paid.
export async function handlePaymentFailed(payload) {
  const paymentEntity = webhookEntity(payload, "payment");
  const razorpayOrderId = paymentEntity.order_id || "";
  if (!razorpayOrderId) throw new Error("event carries no order reference");

  // No matching order means there is nothing to release.
  const order = await Order.findOne({
    where: { razorpayOrderId },
    include: [{ model: OrderItem, as: "items" }],
  });
  if (!order) return;

  // A late failure must not undo a payment that already succeeded.
  if (order.paymentStatus === "paid") return;

  // Mark failed only while the order is still unpaid, and put the plants back in stock.
  await this.sequelize.transaction(async (tx) => {
    await Order.update(
      { paymentStatus: "failed", status: "failed" },
      { where: { id: order.id, paymentStatus: { [Op.ne]: "paid" } }, transaction: tx },
    );
    await this.releaseOrderInventory(tx, order);
  });
  order.status = "failed";

  // Tell the customer they can try the payment again. A failed notice does not change the order.
  try {
    await this.notifyOrderEvent(order, "Payment failed", "The payment did not go through. You can try again from Orders.", "failed");
  } catch (err) {
    console.log(`[NOTIFY] payment failed: ${err.message}`);
  }
}

// Record that Razorpay accepted a refund and it is still pending.
// Called for refund.created.
export async function handleRefundCreated(payload) {
  const fields = refundEventFields(payload);
  await this.applyRefundOutcome(fields.refundId, fields.paymentId, fields.amount, "pending", "");
}

// Record that the refund money has been settled, then tell the customer.
// Called for refund.processed. The payment id is required so we can find the order.
export async function handleRefundProcessed(payload) {
  const fields = refundEventFields(payload);
  if (!fields.paymentId) throw new Error("refund event missing payment_id");
  await this.applyRefundOutcome(fields.refundId, fields.paymentId, fields.amount, "processed", "");

  // The in-app notice is best-effort. The refund row is already updated.
  const order = await Order.findOne({ where: { razorpayPaymentId: fields.paymentId } });
  if (order) {
    try {
      await this.notifyOrderEvent(order, "Refund completed", "The refund has been settled.", "refund-done");
    } catch (err) {
      console.log(`[NOTIFY] refund: ${err.message}`);
    }
  }
}

// Record that Razorpay could not complete the refund.
// Called for refund.failed. The amount is left unchanged.
export async function handleRefundFailed(payload) {
  const fields = refundEventFields(payload);
  await this.applyRefundOutcome(fields.refundId, fields.paymentId, 0, "failed", "provider reported refund failure");
}

// Open a support ticket when a customer disputes a payment with their bank.
// Called for payment.dispute.created. Also alerts the shop.
export async function handleDisputeCreated(payload) {
  const disputeEntity = webhookEntity(payload, "dispute");
  const paymentId = disputeEntity.payment_id || "";
  const reason = disputeEntity.reason_code || "";
  const amount = paiseToRupees(disputeEntity.amount);

  // Attach the ticket to our order when we can find the payment. A dispute with no local order is still saved.
  const order = await Order.findOne({ where: { razorpayPaymentId: paymentId } });
  const req = {
    issueType: "payment_dispute",
    priority: "urgent",
    status: "pending",
    source: "razorpay_webhook",
    userMessage: `Razorpay dispute opened on payment ${paymentId} (reason: ${reason}, amount: ${amount.toFixed(2)}). Respond before the provider deadline.`,
    orderAmount: amount,
  };
  if (order) {
    req.orderId = order.id;
    req.userId = order.userId;
    req.customerName = order.customerName;
    req.customerEmail = order.customerEmail;
    req.customerPhone = order.customerPhone;
    req.orderStatus = order.status;
    req.paymentStatus = order.paymentStatus;
  }
  await OrderSupportRequest.create(req);

  // Tell the shop about the dispute. A failed alert does not remove the ticket.
  try {
    await this.notifyMerchantDispute(paymentId, reason, amount);
  } catch (err) {
    console.log(`[NOTIFY] dispute: ${err.message}`);
  }
}
