/*
This file starts a Growman checkout and keeps store credit.

A guest proves their email with a code before they can place an order.
A signed-in customer skips that step. We then check the plants are in stock,
work out delivery, apply a coupon, and optionally spend store credit.
The amount that is left is sent to Razorpay, and we save the order while
holding the plants.

Store credit can also be added later, for example as a referral reward.
After a guest pays, createSoftAccount makes them a password-less account.
*/

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Op } from "sequelize";
import { json, error, decode } from "../../pkg/httpjson/httpjson.js";
import { recordInventoryConflict } from "../metrics/prometheus.js";
import { exactIP, clientIP } from "../middlewares/ip.js";
import { User, Order, OrderItem, StoreCredit, CreditEntry, strPtr } from "../models/index.js";
import { validateEmail, renderEmail, otpBlock } from "./auth.js";

const BCRYPT_COST = 10;
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.venky2100.growman";
// Indian pincode: 6 digits, not starting with 0. Mobile: 10 digits starting with 6-9.
const PINCODE = /^[1-9][0-9]{5}$/;
const PHONE = /^[6-9][0-9]{9}$/;

// Round a rupee amount to two decimal places (paise).
function round2(amount) {
  return Math.round(Number(amount) * 100) / 100;
}

// Shorten text to a maximum number of characters, counting letters rather than bytes.
function clipText(value, max) {
  const text = String(value ?? "").trim();
  const characters = [...text];
  if (characters.length <= max) return text;
  return characters.slice(0, max).join("").trim();
}

// Return the first value that is not empty. Used to pick the best client IP.
function firstNonEmpty(...values) {
  for (const candidate of values) if (candidate) return candidate;
  return "";
}

// Check the customer's pincode, phone, and email before we take payment.
// Returns an error string, or an empty string when the details are usable.
function validateCustomer(customer) {
  if (!PINCODE.test(String(customer?.pincode ?? ""))) return "invalid pincode format";
  if (!PHONE.test(String(customer?.phone ?? ""))) return "invalid phone number format";
  if (!validateEmail(customer?.email)) return "invalid email format";
  return "";
}

// Midnight UTC for a date, so delivery-date checks ignore the time of day.
function utcDay(date = new Date()) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

// Thrown when the customer's store credit changed between the quote and the save.
// Checkout turns this into a 409 so the customer can look at the new total.
export class CreditChangedError extends Error {
  // Marks the failure so checkout can tell the customer to look at the total again.
  constructor() {
    super("store credit changed");
    this.creditChanged = true;
  }
}

// How many rupees of store credit this customer can spend right now.
// A missing account, or a negative balance, counts as zero.
export async function availableCredit(userId) {
  const acct = await StoreCredit.findOne({ where: { userId } });
  if (!acct || acct.balance < 0) return 0;
  return Number(acct.balance);
}

// Take store credit off the customer's balance and write a ledger line for this order.
// Runs inside the checkout transaction. Throws CreditChangedError if the balance
// is no longer high enough, so the whole order save rolls back.
export async function spendCredit(tx, userId, amount, orderId) {
  const [updatedRows] = await StoreCredit.update(
    { balance: this.sequelize.literal(`balance - ${Number(amount)}`) },
    { where: { userId, balance: { [Op.gte]: amount } }, transaction: tx },
  );
  if (!updatedRows) throw new CreditChangedError();
  await CreditEntry.create(
    { userId, amount: -amount, reason: "order", orderId },
    { transaction: tx },
  );
}

// Add store credit to a customer and write a ledger line.
// Called for referral rewards. A missing account is created. Failures are logged
// and swallowed so a credit problem does not undo the payment.
export async function addCredit(userId, amount, reason, orderId) {
  if (!userId || !amount) return;
  try {
    await this.sequelize.transaction(async (tx) => {
      let acct = await StoreCredit.findOne({ where: { userId }, transaction: tx });
      if (!acct) {
        await StoreCredit.create({ userId, balance: amount }, { transaction: tx });
      } else {
        await acct.update({ balance: this.sequelize.literal(`balance + ${Number(amount)}`) }, { transaction: tx });
      }
      await CreditEntry.create({ userId, amount, reason, orderId: orderId ?? null }, { transaction: tx });
    });
  } catch (err) {
    console.log(`[CREDIT] add: ${err.message}`);
  }
}

// Email a 6-digit code so a guest can prove they own the checkout email.
// POST /api/v1/checkout/send-email-otp. Refuses if that email already has an account.
export async function sendEmailOTP(req, res) {
  const body = decode(req, res);
  if (!body) return;

  // Stop if the address does not look like an email.
  if (!validateEmail(body.email)) {
    error(res, 400, "invalid email format");
    return;
  }

  // This path is for guests. An existing account should sign in instead.
  const existing = await User.findOne({ where: { email: body.email } });
  if (existing) {
    error(res, 409, "user_exists");
    return;
  }

  // Stop if the shop cannot send mail.
  if (!this.cfg.smtpEmail || !this.cfg.smtpPassword) {
    console.log("[EMAIL] SMTP credentials not configured");
    error(res, 503, "email_unavailable");
    return;
  }

  // One code per email per minute. Tell the app how long to wait.
  let gate;
  try {
    gate = await this.canResendEmailOTP(body.email);
  } catch (err) {
    console.log(`[OTP] cooldown check failed: ${err.message}`);
    error(res, 503, "otp_unavailable");
    return;
  }
  if (!gate.ok) {
    json(res, 429, { error: "otp_cooldown", retry_after: Math.trunc(gate.ttlMs / 1000) });
    return;
  }

  // Store a hash of a new code, then email the plain code. The hash is what we compare later.
  let otp;
  try {
    otp = await this.generateEmailOTP(body.email);
  } catch (err) {
    console.log(`[OTP] generate: ${err.message}`);
    error(res, 503, "otp_unavailable");
    return;
  }
  const text = `Your Growman verification code is ${otp}.\n\nValid for 5 minutes.\n\nIf you didn't request this, ignore this email.\n\nApp: ${PLAY_STORE_URL}`;
  const inner = `<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Verification code</h1>
<p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.5;">Enter this code to verify your email on Growman.</p>
${otpBlock(otp)}`;
  try {
    await this.sendTransactionalEmail(body.email, "Your Growman verification code", text, renderEmail("Your Growman verification code", inner));
  } catch (err) {
    console.log(`[EMAIL] send OTP: ${err.message}`);
    error(res, 502, "email_send_failed");
    return;
  }

  // The email went out, so start the one-minute wait before another code.
  await this.setEmailOTPCooldown(body.email);
  json(res, 200, { message: "OTP sent successfully", cooldown: 60 });
}

// Check the guest's email code and hand back a short-lived proof for checkout.
// POST /api/v1/checkout/verify-email-otp. The proof is used once when the order is created.
export async function verifyEmailOTP(req, res) {
  const body = decode(req, res);
  if (!body) return;
  if (!validateEmail(body.email)) {
    error(res, 400, "invalid email format");
    return;
  }

  // Compare the code with the stored hash. A wrong or expired code stops here.
  let valid;
  try {
    valid = await this.verifyEmailOTPCode(body.email, body.otp);
  } catch (err) {
    console.log(`[OTP] verify: ${err.message}`);
    error(res, 500, "failed to verify OTP");
    return;
  }
  if (!valid) {
    error(res, 400, "invalid or expired OTP");
    return;
  }

  // The code was correct and is now used up. Issue a proof the checkout call must send back.
  let proof;
  try {
    proof = await this.issueVerificationProof(body.email);
  } catch (err) {
    console.log(`[OTP] issue proof: ${err.message}`);
    error(res, 500, "failed to complete verification");
    return;
  }
  json(res, 200, {
    success: true,
    message: "OTP verified successfully",
    verificationToken: proof,
    expiresIn: this.verificationProofTTLSeconds(),
  });
}

// Apply a coupon to the checkout total, if the customer entered one.
// Called from createCheckoutOrder before we talk to Razorpay.
// Free-shipping coupons replace the delivery fee. Other coupons subtract their discount.
// The order must stay at least ₹1 so Razorpay can create a payment.
export async function applyCheckoutCoupon(req, res, payload, items, delivery, claims, signedIn) {
  // No code means there is nothing to apply. Checkout continues at the full amount.
  if (!String(payload.couponCode ?? "").trim()) return { discount: null, ok: true };

  // Signed-in customers are checked by user id. Guests are checked by the email on the order.
  const userId = signedIn ? claims.userId : null;
  let discount;
  try {
    discount = await this.evaluateCoupon(payload.couponCode, delivery.subtotal, items, userId, payload.customer.email);
  } catch (err) {
    if (err.couponRejected) {
      json(res, 422, { error: "coupon_rejected", reason: err.reason });
      return { discount: null, ok: false };
    }
    console.log(`[COUPON] evaluate at checkout: ${err.message}`);
    error(res, 500, "failed to apply coupon");
    return { discount: null, ok: false };
  }

  // Free shipping removes the delivery fee. A money coupon removes its discount from the amount to pay.
  if (discount.freeShipping) {
    payload.amount -= delivery.fee;
    discount.amount = delivery.fee;
  } else {
    payload.amount -= discount.amount;
  }

  // Razorpay cannot charge less than ₹1. Stop and leave the coupon unused.
  if (payload.amount < 1) {
    json(res, 422, {
      error: "coupon_rejected",
      reason: "This code would bring the order below the ₹1 minimum. Please contact us to arrange it.",
    });
    return { discount: null, ok: false };
  }
  payload.amount = round2(payload.amount);
  return { discount, ok: true };
}

// Create the order the customer is about to pay for.
// POST /api/v1/checkout/create-order. Guests must send a fresh email proof.
// Signed-in customers are taken from the optional login token.
export async function createCheckoutOrder(req, res) {
  const payload = decode(req, res);
  if (!payload) return;

  // Stop if the pincode, phone, or email is not usable.
  const customerMsg = validateCustomer(payload.customer);
  if (customerMsg) {
    error(res, 400, customerMsg);
    return;
  }

  // The client sends the amount they expect to pay. It must be a positive number.
  if (!(payload.amount > 0)) {
    error(res, 400, "amount must be greater than 0");
    return;
  }
  if (!payload.currency) payload.currency = "INR";

  // A login token means this is a signed-in customer. Guests must spend their email proof.
  const claims = req.user || null;
  const signedIn = Boolean(claims);
  if (!signedIn) {
    let ok;
    try {
      ok = await this.consumeVerificationProof(payload.customer.email, payload.verificationToken);
    } catch (err) {
      console.log(`[OTP] consume proof: ${err.message}`);
      error(res, 500, "failed to verify your email");
      return;
    }
    // A missing, wrong, or already-used proof stops the order. The guest must verify again.
    if (!ok) {
      json(res, 403, {
        error: "email_not_verified",
        reason: "Please verify your email address before placing the order.",
      });
      return;
    }
  }

  // Replace client prices with the prices stored on the products. Stop if a product or size is unknown.
  const items = await this.buildOrderItems(res, payload.items);
  if (!items) return;

  // Stop if any tracked plant does not have enough stock for the requested quantity.
  if (!(await this.checkStockAvailability(req, res, payload.items))) return;

  // Work out delivery fee, zone, courier, and gift-wrap fee. Stop if the address cannot be served.
  const delivery = await this.resolveOrderFulfillment(req, res, payload);
  if (!delivery) return;

  // Subtract a coupon when one was entered. Stop if the coupon is rejected.
  const applied = await this.applyCheckoutCoupon(req, res, payload, items, delivery, claims, signedIn);
  if (!applied.ok) return;
  const discount = applied.discount;

  // A delivery slot is optional. When present it must be morning or evening.
  const slot = String(payload.deliverySlot ?? "").trim().toLowerCase();
  if (slot && slot !== "morning" && slot !== "evening") {
    error(res, 400, "Delivery slot must be morning or evening.");
    return;
  }

  // A preferred delivery date is optional. When present it must be today through the next 3 weeks.
  let preferred = null;
  const rawDate = String(payload.preferredDeliveryDate ?? "").trim();
  if (rawDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      error(res, 400, "preferredDeliveryDate must be YYYY-MM-DD");
      return;
    }
    const parsed = new Date(rawDate + "T00:00:00Z");
    if (Number.isNaN(parsed.getTime())) {
      error(res, 400, "preferredDeliveryDate must be YYYY-MM-DD");
      return;
    }
    const today = utcDay();
    const max = today + 21 * 24 * 60 * 60 * 1000;
    if (parsed.getTime() < today || parsed.getTime() > max) {
      error(res, 400, "Choose a delivery date within the next 3 weeks.");
      return;
    }
    preferred = parsed;
  }

  // Signed-in customers can spend store credit. We always leave at least ₹1 for Razorpay.
  let creditApplied = 0;
  if (signedIn && payload.useCredit) {
    const available = await this.availableCredit(claims.userId);
    if (available > 0) {
      creditApplied = available;
      if (creditApplied > payload.amount - 1) creditApplied = payload.amount - 1;
      creditApplied = round2(creditApplied);
      if (creditApplied > 0) payload.amount = round2(payload.amount - creditApplied);
    }
  }

  // Create the Razorpay order for the amount still to pay, in paise.
  let razorpayOrder;
  try {
    razorpayOrder = await this.createRazorpayOrder(Math.trunc(payload.amount * 100 + 0.5), payload.currency);
  } catch (err) {
    console.log(`[RAZORPAY] create order: ${err.message}`);
    error(res, 500, "failed to create Razorpay order");
    return;
  }

  // A public token lets the customer open this order later without signing in.
  let publicToken;
  try {
    publicToken = randomBytes(32).toString("hex");
  } catch (err) {
    console.log(`[CHECKOUT] mint order token: ${err.message}`);
    error(res, 500, "failed to save order");
    return;
  }

  // Everything we store on the order. Prices and names come from the catalog, not from the client.
  const orderFields = {
    razorpayOrderId: razorpayOrder.id,
    publicToken,
    paymentStatus: "created",
    status: "pending",
    amount: payload.amount,
    currency: payload.currency,
    customerName: payload.customer.name || "",
    customerEmail: payload.customer.email || "",
    customerPhone: payload.customer.phone || "",
    clientIp: firstNonEmpty(exactIP(req), clientIP(req)),
    userAgent: clipText(req.get("User-Agent") || "", 512),
    addressLine: payload.customer.addressLine || "",
    city: payload.customer.city || "",
    state: payload.customer.state || "",
    pincode: payload.customer.pincode || "",
    fulfillmentChannel: delivery.channel,
    fulfillmentZone: delivery.zone,
    subtotal: delivery.subtotal,
    deliveryFee: delivery.fee,
    deliveryFeeWaived: delivery.feeWaived,
    distanceKm: delivery.distanceKm,
    distanceSource: delivery.distanceSource,
    latitude: payload.latitude ?? null,
    longitude: payload.longitude ?? null,
    courierProvider: delivery.courierProvider,
    courierService: delivery.courierService,
    courierCost: delivery.courierCost,
    giftWrap: Boolean(payload.giftWrap),
    giftNote: clipText(payload.giftNote, 300),
    hidePrice: Boolean(payload.hidePrice),
    giftFee: delivery.giftFee,
    deliverySlot: slot,
    preferredDeliveryDate: preferred,
    creditApplied,
    userId: signedIn ? claims.userId : null,
    items: items.map((line) => ({
      productId: line.productId,
      productSizeId: line.productSizeId ?? null,
      quantity: line.quantity,
      price: line.price,
      name: line.name,
      imageKey: line.imageKey || "",
    })),
  };
  if (discount) {
    orderFields.couponId = discount.coupon.id;
    orderFields.couponCode = discount.code;
    orderFields.discountTotal = discount.amount;
  }

  // Save the order, spend the credit, hold the plants, and record the coupon in one transaction.
  // Any failure rolls all of that back.
  let order;
  try {
    order = await this.sequelize.transaction(async (tx) => {
      const created = await Order.create(orderFields, {
        include: [{ model: OrderItem, as: "items" }],
        transaction: tx,
      });
      if (creditApplied > 0 && created.userId) {
        await this.spendCredit(tx, created.userId, creditApplied, created.id);
      }
      await this.reserveOrderInventory(tx, created.items);
      await this.recordCouponRedemption(tx, discount, created);
      return created;
    });
  } catch (err) {
    // The credit balance moved while we were checking out. Ask the customer to review the total.
    if (err.creditChanged) {
      json(res, 409, {
        error: "credit_changed",
        reason: "Your store credit changed. Please review the total and try again.",
      });
      return;
    }
    // Another checkout took the last plants between the stock check and this save.
    if (err.outOfStock) {
      recordInventoryConflict();
      json(res, 409, { error: "out_of_stock", reason: err.message });
      return;
    }
    // The coupon became invalid while we were saving, for example a usage limit.
    if (err.couponRejected) {
      json(res, 422, { error: "coupon_rejected", reason: err.reason });
      return;
    }
    console.log(`[DB] create order: ${err.message}`);
    error(res, 500, "failed to save order");
    return;
  }

  // Hand the app the Razorpay order id so it can open the payment sheet.
  const response = {
    id: razorpayOrder.id,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency,
    status: razorpayOrder.status,
    orderId: Number(order.id),
    publicToken: order.publicToken,
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    fulfillmentChannel: order.fulfillmentChannel,
  };
  if (discount) {
    response.discount = order.discountTotal;
    response.couponCode = order.couponCode;
  }
  if (creditApplied > 0) response.creditApplied = creditApplied;

  // Tell the customer we have the order. Payment confirmation is a later step.
  try {
    await this.notifyOrderEvent(order, "Order placed", "We have your order and will update you as it moves.", "placed");
  } catch (err) {
    console.log(`[NOTIFY] order placed: ${err.message}`);
  }
  json(res, 200, response);
}

// Create an account for a guest after their payment succeeds.
// Called from markOrderPaid when the order has an email but no user id.
// If the email or phone already belongs to someone, that account is reused.
// The password is random. The welcome email points them at a password reset.
export async function createSoftAccount(email, phone, name, ip, userAgent) {
  const existing = await User.findOne({ where: { [Op.or]: [{ email }, { phone }] } });
  if (existing) return existing;

  const passwordHash = await bcrypt.hash(randomBytes(16).toString("hex"), BCRYPT_COST);
  const user = await User.create({
    name,
    email: strPtr(email),
    phone: strPtr(phone),
    passwordHash,
    emailVerified: true,
    provider: "local",
    role: "user",
  });

  // Tell the shop a checkout created an account. A failed notice does not undo the account.
  try {
    await this.notifyMerchantNewUser(user, "checkout-soft-account", { ip, userAgent });
  } catch (err) {
    console.log(`[AUTH] soft account notify: ${err.message}`);
  }

  // Email the customer after we return, so payment confirmation is not waiting on mail.
  const resetLink = "https://yourdomain.com/reset-password";
  const safeName = String(name ?? "");
  const text = `Hi ${safeName},\n\nYour Growman account is ready. Sign in with your email or phone.\n\nSet a password: ${resetLink}\n\nGet the app: ${PLAY_STORE_URL}\n\n— Growman`;
  const inner = `<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Welcome, ${safeName.replace(/[&<>"]/g, "")}</h1>
<p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">Your account is set up. You can sign in with your email or phone number.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#059669;">
<a href="${resetLink}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Set password</a>
</td></tr></table>`;
  setImmediate(() => {
    this.sendTransactionalEmail(email, "Your Growman account is ready", text, renderEmail("Your Growman account is ready", inner)).catch((err) => {
      console.log(`[EMAIL] account created: ${err.message}`);
    });
  });
  return user;
}
