/*
This file checks that a Growman payment really came from Razorpay, then
marks the order paid.

Checkout asks Razorpay for a payment order here. When the app comes back
from the payment sheet, verifyPayment checks the signature, saves the
payment, and keeps the plants off the shelf. The first time an order is
paid we email the customer, tell the shop, attach an invoice, and pay a
referral reward if this was the customer's first paid order.

In development and test we skip the signature check so local payments can
be tried without Razorpay's secret. getOrder lets a customer open an order
with a public token, or while signed in.
*/

import { createHmac, timingSafeEqual } from "node:crypto";
import { Op, QueryTypes } from "sequelize";
import { json, error, decode } from "../../pkg/httpjson/httpjson.js";
import { isAdminRole } from "../auth/jwt.js";
import { recordPaymentSignatureFailure, recordInventoryConflict } from "../metrics/prometheus.js";
import { Order, OrderItem, Product, ProductSize, User, CreditEntry } from "../models/index.js";
import { renderEmail, escapeHtml } from "./auth.js";
import { OutOfStockError } from "./inventory.js";

const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.venky2100.growman";

// Compare two strings without leaking which character differed.
// Used for payment signatures so an attacker cannot time the check.
function safeEqual(left, right) {
  const leftBytes = Buffer.from(String(left));
  const rightBytes = Buffer.from(String(right));
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

// Check a Razorpay signature against the message they signed.
// Razorpay may send the signature as hex or as base64. Either form is accepted.
export function verifyRazorpayHMAC(secret, message, signature) {
  if (!secret || !signature) return false;
  const sum = createHmac("sha256", secret).update(message).digest();
  if (safeEqual(String(signature).toLowerCase(), sum.toString("hex"))) return true;
  return safeEqual(signature, sum.toString("base64"));
}

// Turn the cart into order lines using the prices stored in the catalog.
// Called during checkout, before we create the Razorpay order.
// Client prices are ignored. A missing product or a size that does not belong
// to that product stops checkout.
export async function buildOrderItems(res, items) {
  if (!items || items.length === 0) {
    error(res, 400, "cart is empty");
    return null;
  }

  // Load every product in the cart in one query.
  const productIds = items.map((item) => item.productId);
  let products;
  try {
    products = await Product.findAll({
      attributes: ["id", "name", "imageKey", "price", "gstRate", "hsnCode"],
      where: { id: { [Op.in]: productIds } },
    });
  } catch (err) {
    console.log(`[DB] fetch products for order: ${err.message}`);
    error(res, 500, "failed to validate products");
    return null;
  }
  const productById = new Map(products.map((product) => [Number(product.id), product]));
  for (const item of items) {
    if (!productById.has(Number(item.productId))) {
      error(res, 400, `product with ID ${item.productId} not found`);
      return null;
    }
  }

  // Load sizes only when the cart picked a size. The size must belong to that product.
  const sizeIds = [];
  for (const item of items) if (item.productSizeId != null) sizeIds.push(item.productSizeId);
  const sizeById = new Map();
  if (sizeIds.length) {
    let sizes;
    try {
      sizes = await ProductSize.findAll({
        attributes: ["id", "productId", "label", "price"],
        where: { id: { [Op.in]: sizeIds }, productId: { [Op.in]: productIds } },
      });
    } catch (err) {
      console.log(`[DB] fetch product sizes for order: ${err.message}`);
      error(res, 500, "failed to validate product sizes");
      return null;
    }
    for (const size of sizes) sizeById.set(Number(size.id), size);
    for (const item of items) {
      if (item.productSizeId == null) continue;
      const size = sizeById.get(Number(item.productSizeId));
      if (!size || Number(size.productId) !== Number(item.productId)) {
        error(res, 400, `product size with ID ${item.productSizeId} not found for product ${item.productId}`);
        return null;
      }
    }
  }

  // The line price is the size price when a size was chosen, otherwise the product price.
  // The line name includes the size label, for example "Money plant (Medium)".
  return items.map((item) => {
    const product = productById.get(Number(item.productId));
    let name = product.name;
    let price = product.price;
    if (item.productSizeId != null) {
      const size = sizeById.get(Number(item.productSizeId));
      price = size.price;
      if (size.label) name = `${product.name} (${size.label})`;
    }
    return {
      productId: item.productId,
      productSizeId: item.productSizeId ?? null,
      quantity: item.quantity,
      price,
      name,
      imageKey: product.imageKey || "",
    };
  });
}

// Ask Razorpay to open an order for this many paise.
// Called from checkout and from payment retry. Throws if the keys are missing or Razorpay refuses.
export async function createRazorpayOrder(amountPaise, currency) {
  if (!this.cfg.razorpayKeyID || !this.cfg.razorpayKeySecret) {
    throw new Error("razorpay credentials not configured");
  }
  const auth = Buffer.from(`${this.cfg.razorpayKeyID}:${this.cfg.razorpayKeySecret}`).toString("base64");
  const resp = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Basic " + auth },
    body: JSON.stringify({ amount: amountPaise, currency }),
  });
  const body = await resp.text();
  if (resp.status !== 200) {
    console.log(`[RAZORPAY] error response: ${body}`);
    throw new Error(`razorpay API error: ${body}`);
  }
  return JSON.parse(body);
}

// Confirm a payment the app just finished in the Razorpay sheet.
// POST /api/v1/razorpay/verify. Checks the signature, marks the order paid,
// and sends the confirmation the first time we see this payment.
export async function verifyPayment(req, res) {
  const body = decode(req, res);
  if (!body) return;

  // We need Razorpay's payment id, and either our order id or Razorpay's order id.
  if (!body.razorpay_payment_id) {
    error(res, 400, "razorpay_payment_id is required");
    return;
  }
  if (!body.orderId && !body.razorpay_order_id) {
    error(res, 400, "orderId or razorpay_order_id is required");
    return;
  }

  // Prefer our order id. Fall back to the Razorpay order id from checkout.
  const where = body.orderId ? { id: body.orderId } : { razorpayOrderId: body.razorpay_order_id };
  let order;
  try {
    order = await Order.findOne({ where, include: [{ model: OrderItem, as: "items" }] });
  } catch (err) {
    console.log(`[PAYMENT] find order: ${err.message}`);
    error(res, 500, "failed to find order");
    return;
  }
  if (!order) {
    error(res, 404, "order not found");
    return;
  }

  // Outside development and test, the signature must match orderId|paymentId signed with our key secret.
  if (!this.skipSignatureChecks()) {
    if (!body.razorpay_signature) {
      error(res, 400, "razorpay_signature is required");
      return;
    }
    if (!this.verifyRazorpaySignature(order.razorpayOrderId, body.razorpay_payment_id, body.razorpay_signature)) {
      console.log(`[PAYMENT] signature verification FAILED for order ${order.id} (razorpay_order_id=${order.razorpayOrderId})`);
      recordPaymentSignatureFailure("verify");
      error(res, 400, "payment verification failed");
      return;
    }
  }

  // Save the payment. firstTimePaid is false when this payment was already recorded.
  let firstTimePaid;
  try {
    firstTimePaid = await this.markOrderPaid(order, body.razorpay_payment_id);
  } catch (err) {
    console.log(`[PAYMENT] mark paid: ${err.message}`);
    error(res, 500, "failed to update order");
    return;
  }

  // Emails, the shop alert, the invoice, and the referral reward run only on the first success.
  await this.notifyOrderPaid(order, firstTimePaid);
  json(res, 200, {
    success: true,
    message: "Payment verified successfully",
    orderId: Number(order.id),
    publicToken: order.publicToken,
  });
}

// Development, dev, and test skip Razorpay signature checks.
// Production always checks them.
export function skipSignatureChecks() {
  const env = String(this.cfg.appEnv ?? "").trim().toLowerCase();
  return env === "development" || env === "dev" || env === "test";
}

// Check the signature Razorpay returns to the app after a payment.
// The signed message is the Razorpay order id, a pipe, and the payment id.
export function verifyRazorpaySignature(orderId, paymentId, signature) {
  return verifyRazorpayHMAC(this.cfg.razorpayKeySecret, `${orderId}|${paymentId}`, signature);
}

// Mark an order paid, store the payment row, and keep the plants reserved.
// Called from the app's verify call and from the Razorpay webhook.
// Returns true only the first time this order moves to paid.
export async function markOrderPaid(order, paymentID) {
  let oversold = null;
  let firstTimePaid = false;
  await this.sequelize.transaction(async (tx) => {
    // Update only if the order is not already paid. A second delivery of the same payment does not count.
    const [count] = await Order.update(
      { razorpayPaymentId: paymentID, paymentStatus: "paid", status: "paid" },
      { where: { id: order.id, paymentStatus: { [Op.ne]: "paid" } }, transaction: tx },
    );
    firstTimePaid = count === 1;
    order.razorpayPaymentId = paymentID;
    order.paymentStatus = "paid";
    order.status = "paid";

    // Upsert the payment row. The same Razorpay payment id updates the existing row instead of inserting twice.
    await this.sequelize.query(
      `INSERT INTO payments (order_id, razorpay_order_id, razorpay_payment_id, amount, currency, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'captured', NOW(), NOW())
       ON CONFLICT (razorpay_payment_id) DO UPDATE
       SET status = EXCLUDED.status, amount = EXCLUDED.amount, currency = EXCLUDED.currency, updated_at = NOW()`,
      {
        bind: [order.id, order.razorpayOrderId, paymentID, order.amount, order.currency],
        type: QueryTypes.INSERT,
        transaction: tx,
      },
    );

    // The first time we mark it paid, keep the stock hold (or take the plants if they were released)
    // and assign an invoice number.
    if (firstTimePaid) {
      try {
        await this.sequelize.transaction({ transaction: tx }, async (inner) => {
          await this.commitOrderInventory(inner, order);
        });
      } catch (commitErr) {
        // The customer paid, but the plants are gone. Remember that and keep the payment.
        if (!(commitErr instanceof OutOfStockError) && !commitErr.outOfStock) throw commitErr;
        oversold = commitErr;
      }
      await this.assignInvoiceNumber(tx, order);
    }
  });

  // Paid but out of stock: count it and open a support ticket so the shop can source plants or refund.
  if (oversold) {
    console.log(`[PAYMENT] order ${order.id} paid but stock unavailable: ${oversold.message}`);
    recordInventoryConflict();
    try {
      await this.raiseOversellSupportRequest(order, oversold);
    } catch (err) {
      console.log(`[INVENTORY] oversell support: ${err.message}`);
    }
  }

  // A guest checkout gets an account now, and the order is attached to it.
  // A failure here does not undo the payment.
  if (!order.userId && order.customerEmail) {
    try {
      const user = await this.createSoftAccount(order.customerEmail, order.customerPhone, order.customerName, order.clientIp, order.userAgent);
      if (user) {
        order.userId = user.id;
        await Order.update({ userId: user.id }, { where: { id: order.id } });
      }
    } catch (err) {
      console.log(`[PAYMENT] create soft account: ${err.message}`);
    }
  }
  return firstTimePaid;
}

// Turn order lines into the short list the confirmation email prints.
// The price on each row is the line total (unit price times quantity).
function lineItems(order) {
  return (order.items || []).map((item) => ({
    name: item.name,
    quantity: Number(item.quantity),
    price: Number(item.price) * Number(item.quantity),
  }));
}

// Tell the customer and the shop that this order was just paid.
// Called after markOrderPaid. Does nothing when the order was already paid.
export async function notifyOrderPaid(order, firstTimePaid) {
  if (!firstTimePaid) return;

  // Confirmation email first, then the invoice PDF on the same background turn.
  if (order.customerEmail) {
    const items = lineItems(order);
    const orderNumber = Number(order.id);
    setImmediate(() => {
      this.sendOrderConfirmation(order.customerEmail, order.customerName, orderNumber, order.amount, items)
        .catch((err) => console.log(`[EMAIL] order confirmation: ${err.message}`))
        .then(() => emailPaidOrderInvoice.call(this, order));
    });
  }

  // Tell the shop on Discord, even when the customer has no email.
  try {
    await this.notifyMerchantPaidOrder(order);
  } catch (err) {
    console.log(`[NOTIFY] paid order: ${err.message}`);
  }

  // In-app notices: payment received, invoice ready, and store pickup when that is the delivery method.
  try {
    await this.notifyOrderEvent(order, "Payment received", "Your payment is confirmed.", "paid");
    if (order.invoiceNumber) {
      await this.notifyOrderEvent(order, "Invoice ready", `Your invoice ${order.invoiceNumber} is ready to download.`, "invoice");
    }
    if (order.fulfillmentChannel === "store_pickup") {
      await this.notifyOrderEvent(order, "Store pickup", "We will tell you when this order is ready to collect.", "pickup-pending");
    }
  } catch (err) {
    console.log(`[NOTIFY] order paid events: ${err.message}`);
  }

  // Referral credit is separate. A failure there does not undo the payment notices.
  try {
    await this.grantFirstOrderReferral(order);
  } catch (err) {
    console.log(`[CREDIT] referral: ${err.message}`);
  }
}

// Email the customer a receipt for the order they just paid.
// Called from notifyOrderPaid, in the background, before the invoice PDF.
export async function sendOrderConfirmation(to, name, orderId, amount, items) {
  const safeName = escapeHtml(name);
  let textItems = "";
  let htmlRows = "";
  for (const item of items) {
    textItems += `  · ${item.name} × ${Math.round(item.quantity)} — ₹${Number(item.price).toFixed(2)}\n`;
    htmlRows += `<tr>
<td style="padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#374151;">${escapeHtml(item.name)}</td>
<td style="padding:10px 8px;border-bottom:1px solid #f3f4f6;font-size:14px;color:#6b7280;text-align:center;">${Math.round(item.quantity)}</td>
<td style="padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#111827;text-align:right;font-weight:500;">₹${Number(item.price).toFixed(2)}</td>
</tr>`;
  }
  const text = `Hi ${name},\n\nOrder #${orderId} is confirmed.\nTotal: ₹${Number(amount).toFixed(2)}\n\nItems:\n${textItems}\nWe'll notify you when it ships.\n\nTrack orders in the app: ${PLAY_STORE_URL}\n\n— Growman`;
  const inner = `<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Order confirmed</h1>
<p style="margin:0 0 4px;font-size:15px;color:#374151;line-height:1.6;">Hi ${safeName} — we've received your order.</p>
<p style="margin:0 0 24px;font-size:13px;color:#6b7280;">Order <strong style="color:#111827;">#${orderId}</strong></p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
<tr style="background:#f9fafb;">
<th align="left" style="padding:8px 0;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Item</th>
<th align="center" style="padding:8px 8px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Qty</th>
<th align="right" style="padding:8px 0;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Amount</th>
</tr>
${htmlRows}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="padding-top:12px;font-size:15px;font-weight:600;color:#111827;">Total</td>
<td style="padding-top:12px;font-size:15px;font-weight:600;color:#047857;text-align:right;">₹${Number(amount).toFixed(2)}</td>
</tr></table>
<p style="margin:24px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">We'll send tracking details once your order ships. Track your order anytime in the <a href="${PLAY_STORE_URL}" style="color:#059669;text-decoration:none;">Growman app</a>.</p>`;
  await this.sendTransactionalEmail(
    to,
    `Order #${orderId} confirmed`,
    text,
    renderEmail(`Order #${orderId} confirmed — ₹${Number(amount).toFixed(2)}`, inner),
  );
}

// Email the invoice PDF once the order has an invoice number.
// Runs after the confirmation email. A missing invoice, or a failed PDF, is logged and skipped.
async function emailPaidOrderInvoice(order) {
  if (!order.invoiceNumber) return;
  let pdf;
  try {
    pdf = await this.buildInvoicePDF(order);
  } catch (err) {
    console.log(`[INVOICE] render for order ${order.id}: ${err.message}`);
    return;
  }
  try {
    await this.sendInvoiceEmail(order.customerEmail, order.customerName, Number(order.id), order.invoiceNumber, pdf);
  } catch (err) {
    console.log(`[EMAIL] invoice for order ${order.id}: ${err.message}`);
  }
}

// Load one order for the customer.
// GET /api/v1/order. A public token works without login. An id requires a login,
// and a non-admin only sees their own order.
export async function getOrder(req, res) {
  const token = String(req.query?.token ?? "").trim();
  const idParam = String(req.query?.id ?? "").trim();
  const include = [{ model: OrderItem, as: "items" }];
  let order;
  try {
    if (token) {
      // Tokens are 32 random bytes as hex, so anything shorter is rejected.
      if (token.length < 32) {
        error(res, 400, "invalid order token");
        return;
      }
      order = await Order.findOne({ where: { publicToken: token }, include });
    } else if (idParam) {
      // Looking up by id needs a login. Admins can open any order. Customers only their own.
      if (!req.user) {
        error(res, 401, "sign in to view this order");
        return;
      }
      const where = { id: idParam };
      if (!isAdminRole(req.user.role)) where.userId = req.user.userId;
      order = await Order.findOne({ where, include });
    } else {
      error(res, 400, "order token or ID is required");
      return;
    }
  } catch (err) {
    console.log(`[ORDER] fetch: ${err.message}`);
    error(res, 500, "failed to fetch order");
    return;
  }
  if (!order) {
    error(res, 404, "order not found");
    return;
  }
  const body = order.toJSON();
  body.items = this.resolveOrderItemImageURLsSlice(order.items || []);
  json(res, 200, body);
}

// Pay the referral reward when this is the customer's first paid order.
// The person who invited them gets ₹100. The customer gets ₹50.
// Called from notifyOrderPaid. Does nothing if there is no account or no inviter.
export async function grantFirstOrderReferral(order) {
  if (!order.userId) return;
  const user = await User.findByPk(order.userId);
  if (!user || !user.referredBy) return;

  // Count paid orders for this customer. The reward is only for the first one.
  const paidCount = await Order.count({ where: { userId: user.id, paymentStatus: "paid" } });
  if (paidCount !== 1) return;

  // The welcome credit is stored against this order, so a repeat call does not pay twice.
  const already = await CreditEntry.count({
    where: { userId: user.id, reason: "referral_welcome", orderId: order.id },
  });
  if (already > 0) return;

  await this.addCredit(user.referredBy, 100, "referral", order.id);
  await this.addCredit(user.id, 50, "referral_welcome", order.id);

  // Tell the inviter. A failed notice does not remove the credit.
  try {
    await this.pushNotice(
      user.referredBy,
      "offer",
      "Invite reward",
      "A friend placed their first order. ₹100 credit is on your account.",
      "/account",
      "referral:" + order.id,
      order.id,
      null,
      null,
    );
  } catch (err) {
    console.log(`[NOTIFY] referral: ${err.message}`);
  }
}
