// This file covers extra account features for a signed-in customer.
// Invite credit, saved plants, payment methods, recent views, cart reminders,
// offers, reordering, delivery ratings, quotes, plant care plans, chat history,
// and outdoor weather alerts all live here.

import { randomBytes } from "node:crypto";
import multer from "multer";
import { Op, literal } from "sequelize";
import { decode, error, json } from "../../pkg/httpjson/httpjson.js";
import { isAdminRole, requireUser } from "../auth/jwt.js";
import { isDue, nextDueAt, seasonFor } from "../care/season.js";
import { generateImageKey } from "./images.js";
import {
  CartSnapshot,
  ChatTurn,
  Coupon,
  CreditEntry,
  Order,
  OwnedPlant,
  PlantHealthLog,
  Product,
  QuoteRequest,
  RecentView,
  RequestedProduct,
  SavedItem,
  SavedPaymentMethod,
  StoreCredit,
  User,
} from "../models/index.js";

// One customer photo, up to 8 MB, kept in memory until it is stored.
const uploadPhoto = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } }).single("image");
const healthStatuses = new Set(["thriving", "healthy", "stressed", "yellowing", "pests", "wilting", "recovering"]);
// Letters and digits that are hard to mix up, for invite codes.
const referralAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// Reads one query-string value. Repeated keys use the first value.
function qget(req, name) {
  const v = req.query?.[name];
  if (Array.isArray(v)) return v[0] == null ? "" : String(v[0]);
  return v == null ? "" : String(v);
}

// Local date and clock parts, used in notice keys so the same alert is not sent twice in one period.
function localParts(date = new Date()) {
  return {
    year: date.getFullYear(),
    month: String(date.getMonth() + 1).padStart(2, "0"),
    day: String(date.getDate()).padStart(2, "0"),
    hour: String(date.getHours()).padStart(2, "0"),
    minute: String(date.getMinutes()).padStart(2, "0"),
  };
}

// Today's local date, for once-a-day notices such as low stock and weather.
function localYMD(date = new Date()) {
  const p = localParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

// The current local hour, for a scan alert that should fire at most once an hour.
function localHour(date = new Date()) {
  const p = localParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}`;
}

// The current local minute. Kept for callers that key a notice to the minute.
function localMinute(date = new Date()) {
  const p = localParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// A UTC calendar day, used so an abandoned-cart notice is once per day of that cart.
function utcYMD(date) {
  return new Date(date).toISOString().slice(0, 10);
}

// India date and hour parts, for care follow-up notice keys.
function istParts(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  });
  return Object.fromEntries(fmt.formatToParts(new Date(date)).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
}

// A date in India as YYYY-MM-DD.
function istYMD(date) {
  const p = istParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

// A date and hour in India, so a care follow-up notice is unique to that hour.
function istHour(date) {
  const p = istParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}`;
}

// A short UTC date such as "26 Oct", shown when a coupon is about to expire.
function utcDayMon(date) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = new Date(date);
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

// True for the photo types a customer is allowed to upload.
function allowedImageMIME(ct) {
  const base = String(ct || "").toLowerCase().split(";")[0].trim();
  return base === "image/jpeg" || base === "image/png" || base === "image/gif" || base === "image/webp";
}

// Runs the single-photo upload parser.
function readUpload(req, res) {
  return new Promise((resolve, reject) => {
    uploadPhoto(req, res, (err) => (err ? reject(err) : resolve()));
  });
}

// The hour of day this customer wants care reminders. Missing or invalid hours become 8 in the morning.
export async function reminderHour(userId) {
  const hour = Number((await this.prefsFor(userId)).reminderHour);
  if (hour <= 0 || hour > 23) return 8;
  return hour;
}

// The customer's invite code and store-credit balance.
export async function getReferral(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const code = await this.ensureReferralCode(claims.userId);
  const credit = await StoreCredit.findOne({ where: { userId: claims.userId } });
  json(res, 200, {
    code,
    balance: credit ? Number(credit.balance) || 0 : 0,
    reward: "You and a friend each receive credit after their first paid order. Yours is ₹100, theirs is ₹50.",
  });
}

// Saves a friend's invite code on this account. It can be saved only once.
export async function claimReferral(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const body = decode(req, res);
  if (!body) return;
  const code = String(body.code || "").trim().toUpperCase();
  const owner = await User.findOne({ where: { referralCode: code } });
  if (!owner) {
    error(res, 404, "That invite code was not found.");
    return;
  }
  if (Number(owner.id) === Number(claims.userId)) {
    error(res, 400, "You cannot use your own invite code.");
    return;
  }
  try {
    const [count] = await User.update(
      { referredBy: owner.id },
      { where: { id: claims.userId, referredBy: null } },
    );
    if (!count) {
      error(res, 409, "An invite code is already saved on this account.");
      return;
    }
  } catch {
    error(res, 500, "Could not save the invite code.");
    return;
  }
  json(res, 200, { success: true });
}

// Returns the customer's invite code, creating one the first time they ask.
export async function ensureReferralCode(userId) {
  const user = await User.findByPk(userId, { attributes: ["id", "referralCode"] });
  if (!user) return "";
  if (user.referralCode) return user.referralCode;
  const buf = randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i++) code += referralAlphabet[buf[i] % referralAlphabet.length];
  // Only write the code if another request has not already saved one.
  await User.update(
    { referralCode: code },
    { where: { id: userId, [Op.or]: [{ referralCode: "" }, { referralCode: null }] } },
  ).catch(() => {});
  const again = await User.findByPk(userId, { attributes: ["referralCode"] });
  return again?.referralCode || code;
}

// Adds store credit and a ledger line. A failure is logged and does not stop the order.
export async function addCredit(userId, amount, reason, orderId) {
  if (!userId || Number(userId) === 0 || !amount) return;
  try {
    await this.sequelize.transaction(async (tx) => {
      const acct = await StoreCredit.findOne({ where: { userId }, transaction: tx });
      if (!acct) {
        await StoreCredit.create({ userId, balance: amount }, { transaction: tx });
      } else {
        await acct.increment("balance", { by: amount, transaction: tx });
      }
      await CreditEntry.create({ userId, amount, reason, orderId: orderId ?? null }, { transaction: tx });
    });
  } catch (err) {
    console.log(`[CREDIT] add: ${err.message || err}`);
  }
}

// Spends store credit inside an order transaction. Fails if the balance changed underneath us.
export async function spendCredit(tx, userId, amount, orderId) {
  const [count] = await StoreCredit.update(
    { balance: literal(`balance - ${Number(amount)}`) },
    { where: { userId, balance: { [Op.gte]: amount } }, transaction: tx },
  );
  if (!count) {
    const err = new Error("store credit changed");
    err.code = "CREDIT_CHANGED";
    throw err;
  }
  await CreditEntry.create(
    { userId, amount: -amount, reason: "order", orderId },
    { transaction: tx },
  );
}

// How much store credit this customer can spend. A missing or negative balance is zero.
export async function availableCredit(userId) {
  const acct = await StoreCredit.findOne({ where: { userId } });
  if (!acct || Number(acct.balance) < 0) return 0;
  return Number(acct.balance);
}

// On a customer's first paid order, credits the friend who invited them and the customer.
export async function grantFirstOrderReferral(order) {
  if (order?.userId == null) return;
  const user = await User.findByPk(order.userId);
  if (!user?.referredBy) return;
  const paid = await Order.count({ where: { userId: user.id, paymentStatus: "paid" } });
  if (paid !== 1) return;
  // The welcome credit for this order is given only once.
  const already = await CreditEntry.count({
    where: { userId: user.id, reason: "referral_welcome", orderId: order.id },
  });
  if (already > 0) return;
  await this.addCredit(user.referredBy, 100, "referral", order.id);
  await this.addCredit(user.id, 50, "referral_welcome", order.id);
  await this.pushNotice(
    user.referredBy, "offer", "Invite reward",
    "A friend placed their first order. ₹100 credit is on your account.",
    "/account", `referral:${order.id}`, order.id, null, null,
  );
}

// Plants the customer saved for later, with photos filled in.
export async function listSavedItems(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  try {
    const rows = await SavedItem.findAll({
      where: { userId: claims.userId },
      include: [{ association: "product", include: [{ association: "sizes" }] }],
      order: [["createdAt", "DESC"]],
    });
    const items = rows.map((row) => {
      const body = row.toJSON();
      if (row.product) body.product = this.resolveProductImageURLs(row.product);
      return body;
    });
    json(res, 200, { items });
  } catch {
    error(res, 500, "failed to load saved plants");
  }
}

// Saves a plant for later. Saving the same plant again updates the size, pot, and quantity.
export async function saveForLater(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const body = decode(req, res);
  if (!body) return;
  const productId = Number(body.productId) || 0;
  if (!productId) {
    error(res, 400, "Choose a plant to save.");
    return;
  }
  let quantity = Number(body.quantity) || 0;
  if (quantity <= 0) quantity = 1;
  const pot = this.clipText(body.pot, 80);
  const productSizeId = body.productSizeId == null || body.productSizeId === "" ? null : Number(body.productSizeId);
  try {
    await SavedItem.create({
      userId: claims.userId, productId, productSizeId, pot, quantity,
    });
  } catch (err) {
    if (this.isDuplicateKey(err)) {
      await SavedItem.update(
        { productSizeId, pot, quantity, deletedAt: null },
        { where: { userId: claims.userId, productId }, paranoid: false },
      );
    } else {
      error(res, 500, "Could not save this plant.");
      return;
    }
  }
  json(res, 200, { success: true });
}

// Removes one saved-for-later plant that belongs to this customer.
export async function removeSavedItem(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const id = Number(req.params?.id);
  await SavedItem.destroy({ where: { id, userId: claims.userId } });
  json(res, 200, { success: true });
}

// Saved UPI ids and card last-four digits, with the default method first.
export async function listPaymentMethods(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const rows = await SavedPaymentMethod.findAll({
    where: { userId: claims.userId },
    order: [["isDefault", "DESC"], ["createdAt", "DESC"]],
  });
  json(res, 200, { methods: rows });
}

// Saves a UPI id or the last four digits of a card. Full card numbers are not stored.
export async function savePaymentMethod(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const body = decode(req, res);
  if (!body) return;
  const kind = String(body.kind || "").trim().toLowerCase();
  let detail = String(body.detail || "").trim();
  if (kind === "card") {
    const digits = detail.replace(/\D/g, "");
    if (digits.length < 4) {
      error(res, 400, "Enter the last 4 digits of the card.");
      return;
    }
    detail = digits.slice(-4);
  } else if (kind === "upi") {
    if (!detail.includes("@") || detail.length > 80) {
      error(res, 400, "Enter a UPI ID such as name@upi.");
      return;
    }
  } else {
    error(res, 400, "Choose UPI or card.");
    return;
  }
  // A new default clears the previous default first.
  if (body.isDefault) {
    await SavedPaymentMethod.update({ isDefault: false }, { where: { userId: claims.userId } });
  }
  let label = this.clipText(body.label, 40);
  if (!label) label = kind.toUpperCase();
  try {
    const row = await SavedPaymentMethod.create({
      userId: claims.userId, kind, label, detail, isDefault: Boolean(body.isDefault),
    });
    json(res, 201, row);
  } catch {
    error(res, 500, "Could not save this payment method.");
  }
}

// Removes one saved payment method that belongs to this customer.
export async function deletePaymentMethod(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const id = Number(req.params?.id);
  await SavedPaymentMethod.destroy({ where: { id, userId: claims.userId } });
  json(res, 200, { success: true });
}

// Remembers that the customer looked at a plant, and may mention new arrivals in that category.
export async function recordRecentView(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const body = decode(req, res);
  if (!body) return;
  const productId = Number(body.productId) || 0;
  if (!productId) {
    error(res, 400, "productId is required");
    return;
  }
  const now = new Date();
  const existing = await RecentView.findOne({ where: { userId: claims.userId, productId } });
  if (!existing) {
    await RecentView.create({ userId: claims.userId, productId, viewedAt: now }).catch(() => {});
  } else {
    await existing.update({ viewedAt: now }).catch(() => {});
  }
  await this.notifyNewArrivals(claims.userId, productId);
  json(res, 200, { success: true });
}

// The plants this customer opened most recently, up to twelve.
export async function listRecentViews(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const rows = await RecentView.findAll({
    where: { userId: claims.userId },
    include: [{ association: "product" }],
    order: [["viewedAt", "DESC"]],
    limit: 12,
  });
  const products = [];
  for (const row of rows) {
    if (row.product && Number(row.product.id)) products.push(row.product);
  }
  json(res, 200, { products: this.resolveProductImageURLsSlice(products) });
}

// Notices for plants added in the last two weeks in the same category as the one they just viewed.
export async function notifyNewArrivals(userId, productId) {
  const product = await Product.findByPk(productId, { attributes: ["id", "categoryId"] });
  if (!product) return;
  const fresh = await Product.findAll({
    attributes: ["id", "name", "slug"],
    where: {
      categoryId: product.categoryId,
      id: { [Op.ne]: productId },
      createdAt: { [Op.gt]: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
    },
    order: [["createdAt", "DESC"]],
    limit: 3,
  });
  for (const item of fresh) {
    await this.pushNotice(
      userId, "offer", "New in a category you browse", `${item.name} just arrived.`,
      `/product/${item.slug}`, `arrival:${item.id}`, null, item.id, null,
    );
  }
}

// Saves the current cart and, if it was left for more than two hours, sends a waiting-cart notice.
export async function syncCartSignals(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const body = decode(req, res);
  if (!body) return;
  const items = Array.isArray(body.items) ? body.items : null;
  const raw = JSON.stringify(items);
  let snap = await CartSnapshot.findOne({ where: { userId: claims.userId } });
  const abandoned = snap && Number(snap.itemCount) > 0 &&
    Date.now() - new Date(snap.updatedAt).getTime() > 2 * 60 * 60 * 1000 &&
    (!snap.notifiedAt || new Date(snap.notifiedAt).getTime() < new Date(snap.updatedAt).getTime());
  if (abandoned) {
    await this.pushNotice(
      claims.userId, "offer", "Your cart is still waiting",
      "The plants in your cart have not been checked out.",
      "/cart", `cart:${utcYMD(snap.updatedAt)}`, null, null, null,
    );
    snap.notifiedAt = new Date();
  }
  const itemCount = Array.isArray(items) ? items.length : 0;
  if (!snap) {
    await CartSnapshot.create({
      userId: claims.userId, itemsJson: raw, itemCount, notifiedAt: null,
    }).catch(() => {});
  } else {
    snap.userId = claims.userId;
    snap.itemsJson = raw;
    snap.itemCount = itemCount;
    await snap.save().catch(() => {});
  }
  await this.notifyLowStock(claims.userId, Array.isArray(items) ? items : []);
  await this.notifyExpiringCoupons(claims.userId, Number(body.subtotal) || 0);
  json(res, 200, { success: true });
}

// A notice when a plant in the cart is still in stock but down to the low-stock line.
export async function notifyLowStock(userId, items) {
  for (const item of items || []) {
    const product = await Product.findByPk(item.productId, {
      attributes: ["id", "name", "stock", "lowStockThreshold", "trackInventory"],
    });
    if (!product) continue;
    let threshold = Number(product.lowStockThreshold) || 0;
    if (threshold <= 0) threshold = 5;
    if (product.trackInventory && product.stock > 0 && product.stock <= threshold) {
      await this.pushNotice(
        userId, "offer", "Low stock in your cart",
        `${product.name} has only ${product.stock} left.`,
        "/cart", `low:${product.id}:${localYMD()}`, null, product.id, null,
      );
    }
  }
}

// Coupons the cart can use, plus a notice for any that expire within three days.
export async function listOffers(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const subtotal = Number(qget(req, "subtotal")) || 0;
  const offers = await this.qualifyingOffers(subtotal);
  await this.notifyExpiringCoupons(claims.userId, subtotal);
  json(res, 200, { offers });
}

// Active coupons that have started, have not expired, and have not hit their use limit.
export async function qualifyingOffers(subtotal) {
  const coupons = await Coupon.findAll({ where: { active: true } });
  const now = Date.now();
  const out = [];
  for (const coupon of coupons) {
    if (coupon.startsAt && now < new Date(coupon.startsAt).getTime()) continue;
    if (coupon.expiresAt && now > new Date(coupon.expiresAt).getTime()) continue;
    if (Number(coupon.usageLimit) > 0 && Number(coupon.usageCount) >= Number(coupon.usageLimit)) continue;
    const view = {
      code: coupon.code,
      description: coupon.description,
      type: coupon.type,
      qualified: subtotal >= (Number(coupon.minSubtotal) || 0),
      minSubtotal: Number(coupon.minSubtotal) || 0,
    };
    if (coupon.expiresAt) view.expiresAt = coupon.expiresAt;
    out.push(view);
  }
  return out;
}

// A notice for each coupon the cart already qualifies for that expires within 72 hours.
export async function notifyExpiringCoupons(userId, subtotal) {
  const soon = Date.now() + 72 * 60 * 60 * 1000;
  for (const offer of await this.qualifyingOffers(subtotal)) {
    if (!offer.qualified || !offer.expiresAt || new Date(offer.expiresAt).getTime() > soon) continue;
    await this.pushNotice(
      userId, "offer", "A code in your cart expires soon",
      `${offer.code} expires ${utcDayMon(offer.expiresAt)}.`,
      "/cart", `coupon:${offer.code}:${utcYMD(offer.expiresAt)}`, null, null, null,
    );
  }
}

// Pots, soil, and feed that can be shown next to a plant page.
export async function productCompanions(req, res) {
  const slug = req.params?.slug;
  const product = await Product.findOne({ where: { slug } });
  if (!product) {
    error(res, 404, "product not found");
    return;
  }
  const products = await Product.findAll({
    where: literal(`id <> ${Number(product.id)} AND (name ILIKE '%pot%' OR name ILIKE '%soil%' OR name ILIKE '%fertil%' OR name ILIKE '%manure%')`),
    order: [["featured", "DESC"], ["createdAt", "DESC"]],
    limit: 8,
  });
  json(res, 200, { products: this.resolveProductImageURLsSlice(products) });
}

// Matches a shop tag or a product attribute, such as light or pet-safe.
function tagClause(name, value) {
  const like = this.sequelize.escape(`%${value}%`);
  const nameLike = this.sequelize.escape(`%${name}%`);
  return `EXISTS (SELECT 1 FROM unnest("Product".tags) t WHERE t ILIKE ${like}) OR EXISTS (SELECT 1 FROM attributes a WHERE a.product_id = "Product".id AND (a.name ILIKE ${nameLike} OR a.value ILIKE ${like}))`;
}

// Filters the shop by light, pet-safe, beginner, indoor, and climate.
export async function filterProducts(req, res) {
  const clauses = [];
  const light = qget(req, "light").trim();
  if (light) clauses.push(literal(tagClause.call(this, "light", light)));
  if (qget(req, "petSafe") === "1") clauses.push(literal(tagClause.call(this, "pet", "pet")));
  if (qget(req, "beginner") === "1") clauses.push(literal(tagClause.call(this, "beginner", "beginner")));
  if (qget(req, "indoor") === "1") clauses.push(literal(tagClause.call(this, "indoor", "indoor")));
  const climate = qget(req, "climate").trim();
  if (climate) clauses.push(literal(tagClause.call(this, "climate", climate)));
  try {
    const products = await Product.findAll({
      where: clauses.length ? { [Op.and]: clauses } : undefined,
      include: [{ association: "sizes" }, { association: "category" }],
      order: [["featured", "DESC"], ["createdAt", "DESC"]],
      limit: 40,
    });
    json(res, 200, { products: this.resolveProductImageURLsSlice(products) });
  } catch {
    error(res, 500, "failed to filter products");
  }
}

// Loads one order that belongs to this customer, with its line items.
async function ownOrder(req, res, userId) {
  const raw = String(req.params?.id ?? "");
  if (!/^\d+$/.test(raw)) {
    error(res, 400, "invalid order id");
    return null;
  }
  try {
    const order = await Order.findOne({
      where: { id: raw, userId },
      include: [{ association: "items" }],
    });
    if (!order) {
      error(res, 404, "order not found");
      return null;
    }
    return order;
  } catch {
    error(res, 500, "failed to load order");
    return null;
  }
}

// The plants from a past order, ready to put back in the cart.
export async function reorder(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const order = await ownOrder(req, res, claims.userId);
  if (!order) return;
  const lines = (order.items || []).map((item) => {
    const resolved = this.resolveOrderItemImageURL(item);
    const line = {
      productId: item.productId,
      quantity: item.quantity,
      name: item.name,
      price: item.price,
    };
    if (item.productSizeId != null) line.productSizeId = item.productSizeId;
    if (resolved.imageUrl) line.imageUrl = resolved.imageUrl;
    return line;
  });
  json(res, 200, { items: lines });
}

// A 1-to-5 rating after a delivery has arrived.
export async function rateDelivery(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const order = await ownOrder(req, res, claims.userId);
  if (!order) return;
  if (order.status !== "delivered" && !order.deliveredAt) {
    error(res, 409, "You can rate a delivery after it arrives.");
    return;
  }
  const body = decode(req, res);
  if (!body) return;
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    error(res, 400, "Choose a rating from 1 to 5.");
    return;
  }
  try {
    await order.update({ deliveryRating: rating, deliveryFeedback: this.clipText(body.feedback, 500) });
  } catch {
    error(res, 500, "Could not save the rating.");
    return;
  }
  json(res, 200, { success: true });
}

// Starts a new payment for an order whose last payment failed, and reserves the plants again.
export async function retryPayment(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const order = await ownOrder(req, res, claims.userId);
  if (!order) return;
  if (order.paymentStatus !== "failed") {
    error(res, 409, "This order does not need a new payment attempt.");
    return;
  }
  let razorpayOrder;
  try {
    razorpayOrder = await this.createRazorpayOrder(Math.floor(Number(order.amount) * 100 + 0.5), order.currency);
  } catch {
    error(res, 500, "Could not start a new payment.");
    return;
  }
  try {
    await this.sequelize.transaction(async (tx) => {
      await Order.update(
        { razorpayOrderId: razorpayOrder.id, paymentStatus: "created", status: "pending" },
        { where: { id: order.id }, transaction: tx },
      );
      await this.reserveOrderInventory(tx, order.items);
    });
  } catch (err) {
    console.log(`[PAYMENT] retry order ${order.id}: ${err.message || err}`);
    error(res, 409, "Those plants are no longer available to reserve.");
    return;
  }
  json(res, 200, {
    id: razorpayOrder.id,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency,
    orderId: order.id,
  });
}

// Quotations this customer has already sent.
export async function listMyQuotes(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const rows = await QuoteRequest.findAll({
    where: { userId: claims.userId },
    order: [["createdAt", "DESC"]],
    limit: 30,
  });
  json(res, 200, { quotes: rows });
}

// Saves a quotation after its email was sent, and notifies the customer when they are signed in.
export async function saveQuoteRequest(req, name, phone, email, summary, estimate, amount) {
  const userId = req.user?.userId ?? null;
  try {
    await QuoteRequest.create({
      userId, estimateNo: estimate, name, phone, email,
      summary: this.clipText(summary, 300), amount, status: "sent",
    });
  } catch (err) {
    console.log(`[QUOTATION] save request: ${err.message || err}`);
    return;
  }
  if (userId != null) {
    await this.pushNotice(
      userId, "order", "Quotation sent", `We received ${estimate}.`,
      "/bulk", `quote:${estimate}`, null, null, null,
    );
  }
}

// Staff mark a quotation as sent, revised, or accepted, and the customer gets a notice.
export async function updateQuoteStatus(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  if (!isAdminRole(claims.role)) {
    error(res, 403, "admin access required");
    return;
  }
  const raw = String(req.params?.id ?? "");
  if (!/^\d+$/.test(raw)) {
    error(res, 400, "invalid quote id");
    return;
  }
  const body = decode(req, res);
  if (!body) return;
  const status = String(body.status || "").trim().toLowerCase();
  if (status !== "sent" && status !== "revised" && status !== "accepted") {
    error(res, 400, "status must be sent, revised, or accepted");
    return;
  }
  const quote = await QuoteRequest.findByPk(raw);
  if (!quote) {
    error(res, 404, "quote not found");
    return;
  }
  try {
    await quote.update({ status });
  } catch {
    error(res, 500, "failed to update quote");
    return;
  }
  await this.pushNotice(
    quote.userId, "order", `Quotation ${status}`, `${quote.estimateNo} is now ${status}.`,
    "/bulk", `quote:${quote.estimateNo}:${status}`, null, null, null,
  );
  json(res, 200, { success: true, status });
}

// The newest order that is not delivered, cancelled, or failed.
export async function activeOrder(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  try {
    const order = await Order.findOne({
      where: { userId: claims.userId, status: { [Op.notIn]: ["delivered", "cancelled", "failed"] } },
      order: [["createdAt", "DESC"]],
    });
    json(res, 200, { order: order || null });
  } catch {
    error(res, 500, "failed to load orders");
  }
}

// Stores one photo for the signed-in customer and returns the link the app can save on a plant.
export async function uploadMyImage(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  if (!this.imageService) {
    error(res, 503, "Photo upload is not configured.");
    return;
  }
  try {
    await readUpload(req, res);
  } catch {
    error(res, 400, "Choose a photo under 8 MB.");
    return;
  }
  if (!req.file) {
    error(res, 400, "image file is required");
    return;
  }
  const imageKey = generateImageKey(`plants/${claims.userId}`, req.file.originalname);
  let contentType = req.file.mimetype;
  if (!allowedImageMIME(contentType)) contentType = "image/jpeg";
  try {
    await this.imageService.uploadImage(imageKey, req.file.buffer, contentType);
  } catch {
    error(res, 500, "Could not store the photo.");
    return;
  }
  json(res, 200, { imageKey, imageUrl: this.resolveImageURL(imageKey) });
}

// Care tasks due in the next seven days, for the plant calendar.
export async function plantCalendar(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const plants = await OwnedPlant.findAll({ where: { userId: claims.userId } });
  const end = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const tasks = [];
  // Adds one care task when the reminder is on and the due time is inside the next week.
  const add = (plant, kind, due, on) => {
    if (!on || !due) return;
    if (new Date(due).getTime() > end) return;
    tasks.push({ plantId: plant.id, plantName: plant.name, kind, due: istYMD(due) });
  };
  for (const plant of plants) {
    add(plant, "water", plant.waterNextAt, plant.waterReminder);
    add(plant, "fertilize", plant.fertilizeNextAt, plant.fertilizeReminder);
    add(plant, "mist", plant.mistNextAt, plant.mistReminder);
    add(plant, "rotate", plant.rotateNextAt, plant.rotateReminder);
    add(plant, "repot", plant.repotNextAt, plant.repotReminder);
    add(plant, "prune", plant.pruneNextAt, plant.pruneReminder);
  }
  json(res, 200, { tasks: tasks.length ? tasks : null });
}

// Pushes every care reminder that is due within a day out by one day.
export async function snoozePlant(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const plant = await this.ownedPlant(req, res, claims.userId);
  if (!plant) return;
  const hour = await this.reminderHour(claims.userId);
  const now = new Date();
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  // Moves a due reminder to tomorrow when it falls inside the next day.
  const shift = (due, on) => {
    if (!on || !due || !isDue(due, horizon)) return due;
    return nextDueAt(now, 1, hour);
  };
  plant.waterNextAt = shift(plant.waterNextAt, plant.waterReminder);
  plant.fertilizeNextAt = shift(plant.fertilizeNextAt, plant.fertilizeReminder);
  plant.mistNextAt = shift(plant.mistNextAt, plant.mistReminder);
  plant.rotateNextAt = shift(plant.rotateNextAt, plant.rotateReminder);
  plant.repotNextAt = shift(plant.repotNextAt, plant.repotReminder);
  plant.pruneNextAt = shift(plant.pruneNextAt, plant.pruneReminder);
  plant.snoozedUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  try {
    await plant.save();
  } catch {
    error(res, 500, "Could not snooze reminders.");
    return;
  }
  const views = await this.presentPlants(claims.userId, [plant]);
  json(res, 200, views[0]);
}

// True for pots, soil, feed, and other supplies that should not become an owned plant.
function supplyName(name) {
  const lower = String(name || "").toLowerCase();
  return ["pot", "soil", "fertil", "manure", "pebble", "tray", "stand", "spray"].some((word) => lower.includes(word));
}

// Turns paid order lines into owned plants, skipping supplies and names the customer already has.
export async function importPurchasedPlants(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const orders = await Order.findAll({
    where: { userId: claims.userId, paymentStatus: "paid" },
    include: [{ association: "items", include: [{ association: "product" }] }],
  });
  const existing = await OwnedPlant.findAll({ where: { userId: claims.userId } });
  const have = new Set(existing.map((plant) => String(plant.name || "").toLowerCase()));
  const hour = await this.reminderHour(claims.userId);
  let created = 0;
  for (const order of orders) {
    for (const item of order.items || []) {
      const name = String(item.name || "").trim();
      if (!name || supplyName(name) || have.has(name.toLowerCase())) continue;
      let slug = "";
      let productId = null;
      if (Number(item.productId)) {
        productId = item.productId;
        slug = item.product?.slug || "";
      }
      try {
        // New imported plants start with watering and feeding reminders.
        await OwnedPlant.create({
          userId: claims.userId,
          name: this.clipText(name, 80),
          productId,
          productSlug: slug,
          waterEveryDays: 7,
          fertilizeEveryDays: 45,
          waterReminder: true,
          fertilizeReminder: true,
          waterNextAt: nextDueAt(new Date(), 7, hour),
          fertilizeNextAt: nextDueAt(new Date(), 45, hour),
        });
        have.add(name.toLowerCase());
        created++;
      } catch { /* skip a row that cannot be saved */ }
    }
  }
  json(res, 200, { imported: created });
}

// A short text card of a plant's spot and care intervals, for sharing.
export async function plantCareCard(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const plant = await this.ownedPlant(req, res, claims.userId);
  if (!plant) return;
  let text = `${plant.name}\nSpot: ${plant.room || ""}\nWater every ${plant.waterEveryDays} days. Feed every ${plant.fertilizeEveryDays} days.`;
  if (plant.notes) text += `\n${plant.notes}`;
  json(res, 200, { text, name: plant.name });
}

// Guesses a health status from the words in a diagnosis note.
function diagnosisStatus(notes) {
  const lower = String(notes || "").toLowerCase();
  if (lower.includes("pest") || lower.includes("bug") || lower.includes("mite")) return "pests";
  if (lower.includes("yellow")) return "yellowing";
  if (lower.includes("wilt") || lower.includes("rot")) return "wilting";
  if (lower.includes("stress")) return "stressed";
  return "stressed";
}

// Saves a diagnosis and schedules a follow-up care notice.
export async function diagnosePlant(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const plant = await this.ownedPlant(req, res, claims.userId);
  if (!plant) return;
  const body = decode(req, res);
  if (!body) return;
  let status = String(body.status || "").trim().toLowerCase();
  if (!healthStatuses.has(status)) status = diagnosisStatus(body.notes);
  let followUpDays = Number(body.followUpDays) || 0;
  if (followUpDays <= 0) followUpDays = 3;
  const follow = nextDueAt(new Date(), followUpDays, await this.reminderHour(claims.userId));
  let entry;
  try {
    entry = await PlantHealthLog.create({
      ownedPlantId: plant.id,
      userId: claims.userId,
      status,
      notes: this.clipText(body.notes, 1000),
      photoUrl: this.clipText(body.photoUrl, 500),
      recordedAt: new Date(),
      followUpAt: follow,
    });
  } catch {
    error(res, 500, "Could not save the diagnosis.");
    return;
  }
  await this.pushNotice(
    claims.userId, "health", `Check ${plant.name}`,
    `Follow up on ${status} in ${followUpDays} days.`,
    `/my-plants/${plant.id}`,
    `health:${plant.id}:${istYMD(follow)}`,
    null, null, plant.id,
  );
  json(res, 201, { health: entry, followUpAt: follow });
}

// Starts a 30-day recovery plan: water every 3 days, mist every 2, and a first feed on day 21.
export async function startCarePlan(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const plant = await this.ownedPlant(req, res, claims.userId);
  if (!plant) return;
  const hour = await this.reminderHour(claims.userId);
  const now = new Date();
  plant.waterEveryDays = 3;
  plant.waterReminder = true;
  plant.waterNextAt = nextDueAt(now, 3, hour);
  plant.mistEveryDays = 2;
  plant.mistReminder = true;
  plant.mistNextAt = nextDueAt(now, 2, hour);
  plant.fertilizeEveryDays = 21;
  plant.fertilizeReminder = true;
  plant.fertilizeNextAt = nextDueAt(now, 21, hour);
  try {
    await plant.save();
  } catch {
    error(res, 500, "Could not start the care plan.");
    return;
  }
  const tasks = [
    "Days 1–7: keep it in bright indirect light and check the soil every third day.",
    "Mist the leaves every second day if the room is air-conditioned.",
    "Hold fertiliser until day 21, then give a light feed.",
    "After 30 days, switch back to the plant's normal interval.",
  ];
  await this.pushNotice(
    claims.userId, "dootha", `30-day plan for ${plant.name}`,
    "Watering, misting, and a first feed are scheduled.",
    `/my-plants/${plant.id}`, `plan:${plant.id}`, null, null, plant.id,
  );
  const views = await this.presentPlants(claims.userId, [plant]);
  json(res, 200, { tasks, plant: views[0] });
}

// A notice that a plant photo needs a person to look at it.
export async function scanAlert(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const body = decode(req, res);
  if (!body) return;
  const summary = this.clipText(body.summary, 240);
  if (!summary) {
    error(res, 400, "Describe what the photo showed.");
    return;
  }
  await this.pushNotice(
    claims.userId, "dootha", "This photo needs a look",
    summary, "/chat", `scan:${localHour()}`, null, null, null,
  );
  json(res, 200, { success: true });
}

// Schedules a care follow-up notice for the steps Dootha suggested.
export async function careFollowUp(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const body = decode(req, res);
  if (!body) return;
  let days = Number(body.days) || 0;
  if (days <= 0) days = 1;
  const due = nextDueAt(new Date(), days, await this.reminderHour(claims.userId));
  let note = this.clipText(body.note, 240);
  if (!note) note = "Follow the care steps Dootha suggested.";
  const plantId = body.plantId == null || body.plantId === "" ? null : body.plantId;
  await this.pushNotice(
    claims.userId, "care", "Care follow-up", note, "/chat",
    `follow:${istHour(due)}`, null, null, plantId,
  );
  json(res, 200, { due });
}

// The customer's saved Dootha chat, oldest first, up to forty turns.
export async function listChatHistory(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const turns = await ChatTurn.findAll({
    where: { userId: claims.userId },
    order: [["createdAt", "DESC"]],
    limit: 40,
  });
  turns.reverse();
  json(res, 200, { messages: turns });
}

// Saves one chat line. Blank text is skipped.
export async function saveChatTurn(userId, role, content) {
  content = this.clipText(content, 4000);
  if (!content) return;
  try {
    await ChatTurn.create({ userId, role, content });
  } catch (err) {
    console.log(`[CHAT] save: ${err.message || err}`);
  }
}

// The latest chat turns, oldest first, for the advice service to read as history.
export async function recentChat(userId) {
  const turns = await ChatTurn.findAll({
    where: { userId },
    order: [["createdAt", "DESC"]],
    limit: 8,
  });
  const out = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    let role = turns[i].role;
    if (role === "dootha") role = "assistant";
    out.push({ role, content: turns[i].content });
  }
  return out;
}

// A short account summary the advice service may use: city, plants, and recent orders.
export async function customerContext(userId) {
  const user = await User.findByPk(userId, { attributes: ["city", "state"] });
  const plants = await OwnedPlant.findAll({ where: { userId }, limit: 8 });
  const orders = await Order.findAll({
    attributes: ["id", "status", "city"],
    where: { userId },
    order: [["createdAt", "DESC"]],
    limit: 3,
  });
  let text = "\n\nAccount context (use it, do not invent beyond it):\n";
  if (user?.city) text += `City: ${user.city}, ${user.state || ""}\n`;
  if (!plants.length) text += "Plants: none saved yet.\n";
  for (const plant of plants) text += `- ${plant.name} in ${plant.room || ""} ${plant.location || ""}\n`;
  for (const order of orders) text += `- Order ${order.id} status ${order.status}\n`;
  return text;
}

// A weather notice for customers who keep a plant on a balcony, terrace, or outdoors.
export async function checkWeather(userId, plants) {
  let outdoor = false;
  for (const plant of plants || []) {
    const spot = `${plant.room || ""} ${plant.location || ""}`.toLowerCase();
    if (spot.includes("balcony") || spot.includes("outdoor") || spot.includes("terrace")) {
      outdoor = true;
      break;
    }
  }
  if (!outdoor) return;
  const user = await User.findByPk(userId, { attributes: ["latitude", "longitude"] });
  if (!user) return;
  let [title, body] = seasonWeather();
  // A saved location can replace the seasonal note with today's forecast.
  if (user.latitude != null && user.longitude != null) {
    const live = await liveWeather(Number(user.latitude), Number(user.longitude));
    if (live.ok) {
      title = live.title;
      body = live.body;
    }
  }
  if (!title) return;
  await this.pushNotice(
    userId, "weather", title, body, "/my-plants", `weather:${localYMD()}`, null, null, null,
  );
}

// A seasonal outdoor warning when there is no live forecast.
function seasonWeather() {
  switch (seasonFor(new Date()).season) {
    case "summer":
      return ["Heat alert for outdoor plants", "Shade balcony pots from afternoon sun and check soil before evening."];
    case "monsoon":
      return ["Heavy rain expected this season", "Empty saucers and skip watering outdoor pots after rain."];
    case "winter":
      return ["Cold nights for balcony plants", "Pull pots in from the wind and water in the morning."];
    default:
      return ["", ""];
  }
}

// Today's forecast: heat at 38°C or more, heavy rain, or a night at 12°C or below.
async function liveWeather(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=Asia%2FKolkata&forecast_days=1`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok) return { ok: false };
    const parsed = JSON.parse(buf.subarray(0, 1 << 20).toString("utf8"));
    const max = parsed?.daily?.temperature_2m_max;
    const min = parsed?.daily?.temperature_2m_min;
    const rain = parsed?.daily?.precipitation_sum;
    if (!Array.isArray(max) || !max.length) return { ok: false };
    if (max[0] >= 38) {
      return { ok: true, title: "Heat alert for outdoor plants", body: `Tomorrow reaches about ${Math.round(max[0])}°C. Shade balcony pots and water in the morning.` };
    }
    if (Array.isArray(rain) && rain[0] >= 20) {
      return { ok: true, title: "Heavy rain for outdoor plants", body: "A wet day is forecast. Empty saucers and hold off watering balcony pots." };
    }
    if (Array.isArray(min) && min[0] <= 12) {
      return { ok: true, title: "Cold alert for outdoor plants", body: `The night drops to about ${Math.round(min[0])}°C. Pull tender pots out of the wind.` };
    }
    return { ok: true, title: "", body: "" };
  } catch {
    return { ok: false };
  }
}
