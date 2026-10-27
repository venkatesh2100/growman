// Discount codes for the shop.
//
// A code can take a percentage off, a fixed rupee amount off, or make shipping free.
// It can be limited by dates, a global use count, a per-customer use count, a minimum
// cart value, the first paid order only, and a list of products or categories.
// The public validate route tells the cart whether a code applies. Admins create,
// edit, and delete codes. Recording a redemption happens when an order is placed.

import { Op } from "sequelize";
import { json, error, decode } from "../../pkg/httpjson/httpjson.js";
import { Coupon, CouponRedemption, Order, Product } from "../models/index.js";

// A code the customer typed that we will not apply. The reason is shown on the cart.
export class CouponRejectedError extends Error {
  constructor(reason) {
    super(reason);
    this.couponRejected = true;
    this.reason = reason;
  }
}

// Discount amounts are rounded to paise.
function round2(amount) {
  return Math.round(Number(amount) * 100) / 100;
}

// The "add this much more" message uses a whole-rupee figure.
function formatRupees(amount) {
  return `₹${Math.round(Number(amount))}`;
}

// Postgres unique violations arrive under a few different error shapes.
function isUniqueViolation(err) {
  if (!err) return false;
  if (err.name === "SequelizeUniqueConstraintError") return true;
  const msg = String(err.message || err.parent?.message || "").toLowerCase();
  return msg.includes("duplicate key") || msg.includes("unique constraint") || msg.includes("23505") || err.parent?.code === "23505";
}

// Coupon ids in the URL must be a plain positive integer.
function parseId(raw) {
  if (!/^\d+$/.test(String(raw ?? ""))) return null;
  const parsedId = Number(raw);
  if (!Number.isSafeInteger(parsedId)) return null;
  return parsedId;
}

// Product and category id lists on a coupon are stored as strings. This keeps the numeric ones.
function idSet(values) {
  const set = new Set();
  for (const raw of values || []) {
    if (/^\d+$/.test(String(raw))) set.add(Number(raw));
  }
  return set;
}

// Decide whether this code applies to the cart and how many rupees it takes off.
// Throws CouponRejectedError with a sentence the shopper can read.
export async function evaluateCoupon(code, subtotal, items, userId, email) {
  const normalized = String(code ?? "").trim().toUpperCase();
  if (!normalized) throw new CouponRejectedError("Enter a coupon code.");
  let coupon;
  try {
    coupon = await Coupon.findOne({ where: { code: normalized } });
  } catch (err) {
    throw err;
  }
  if (!coupon) throw new CouponRejectedError("That code isn't valid.");
  const now = new Date();
  if (!coupon.active) throw new CouponRejectedError("That code is no longer active.");
  if (coupon.startsAt && now < new Date(coupon.startsAt)) throw new CouponRejectedError("That code isn't active yet.");
  if (coupon.expiresAt && now > new Date(coupon.expiresAt)) throw new CouponRejectedError("That code has expired.");
  if (coupon.usageLimit > 0 && coupon.usageCount >= coupon.usageLimit) {
    throw new CouponRejectedError("That code has been fully redeemed.");
  }
  // A code aimed at certain products or categories only discounts those lines.
  let eligible = subtotal;
  if ((coupon.categoryIds || []).length || (coupon.productIds || []).length) {
    eligible = await this.eligibleSubtotal(coupon, items);
    if (eligible <= 0) throw new CouponRejectedError("That code doesn't apply to anything in your cart.");
  }
  if (coupon.minSubtotal > 0 && eligible < coupon.minSubtotal) {
    throw new CouponRejectedError(`Add ${formatRupees(coupon.minSubtotal - eligible)} more to use this code.`);
  }
  await this.checkCouponUsage(null, coupon, userId, email);
  const out = {
    coupon,
    code: coupon.code,
    type: coupon.type,
    amount: 0,
    freeShipping: false,
    description: coupon.description || "",
  };
  if (coupon.type === "percentage") {
    out.amount = (eligible * coupon.value) / 100;
    // A percentage code can be capped so a large cart does not take more than maxDiscount off.
    if (coupon.maxDiscount > 0 && out.amount > coupon.maxDiscount) out.amount = coupon.maxDiscount;
  } else if (coupon.type === "fixed") {
    out.amount = coupon.value;
  } else if (coupon.type === "free_shipping") {
    out.freeShipping = true;
  } else {
    throw new CouponRejectedError("That code isn't valid.");
  }
  // The discount never exceeds the eligible goods total. Shipping is unchanged here.
  if (out.amount > eligible) out.amount = eligible;
  out.amount = round2(out.amount);
  return out;
}

// Sum of price times quantity for lines the coupon is allowed to touch.
export async function eligibleSubtotal(coupon, items) {
  const allowedProducts = idSet(coupon.productIds);
  const allowedCategories = idSet(coupon.categoryIds);
  const categoryByProduct = new Map();
  if (allowedCategories.size) {
    // Category restrictions need each product's category, which is not stored on the cart line.
    const productIds = (items || []).map((item) => item.productId);
    const products = await Product.findAll({
      attributes: ["id", "categoryId"],
      where: { id: { [Op.in]: productIds.length ? productIds : [0] } },
    });
    for (const product of products) categoryByProduct.set(Number(product.id), Number(product.categoryId));
  }
  let total = 0;
  for (const item of items || []) {
    const pid = Number(item.productId);
    if (allowedProducts.has(pid) || allowedCategories.has(categoryByProduct.get(pid))) {
      total += Number(item.price) * Number(item.quantity);
    }
  }
  return total;
}

// Per-customer limit, and the "first paid order only" rule.
// A signed-in shopper is matched by user id. A guest is matched by lower-case email.
export async function checkCouponUsage(tx, coupon, userId, email) {
  const opts = tx ? { transaction: tx } : {};
  if (coupon.perUserLimit > 0 && (userId != null || email)) {
    const where = { couponId: coupon.id };
    if (userId != null) where.userId = userId;
    else where.email = String(email).toLowerCase();
    const used = await CouponRedemption.count({ where, ...opts });
    if (used >= Number(coupon.perUserLimit)) throw new CouponRejectedError("You've already used this code.");
  }
  if (!coupon.firstOrderOnly || (userId == null && !email)) return;
  if (userId != null) {
    const orders = await Order.count({ where: { paymentStatus: "paid", userId }, ...opts });
    if (orders > 0) throw new CouponRejectedError("That code is for first orders only.");
    return;
  }
  const orders = await Order.count({
    where: {
      [Op.and]: [
        { paymentStatus: "paid" },
        this.sequelize.where(this.sequelize.fn("LOWER", this.sequelize.col("customer_email")), String(email).toLowerCase()),
      ],
    },
    ...opts,
  });
  if (orders > 0) throw new CouponRejectedError("That code is for first orders only.");
}

// Count one successful use of the code against the order, inside the order's transaction.
// The coupon row is locked so two checkouts cannot slip past a usage limit together.
export async function recordCouponRedemption(tx, discount, order) {
  if (!discount || !discount.coupon) return;
  const coupon = await Coupon.findOne({
    where: { id: discount.coupon.id },
    transaction: tx,
    lock: tx.LOCK.UPDATE,
  });
  if (!coupon) throw new Error("coupon not found");
  await this.checkCouponUsage(tx, coupon, order.userId, order.customerEmail);
  if (coupon.usageLimit > 0) {
    // The update only lands while usage is still under the cap.
    const [n] = await Coupon.update(
      { usageCount: this.sequelize.literal("usage_count + 1") },
      {
        where: { id: coupon.id, usageCount: { [Op.lt]: coupon.usageLimit } },
        transaction: tx,
        silent: true,
      },
    );
    if (!n) throw new CouponRejectedError("That code has just been fully redeemed.");
  } else {
    await Coupon.update(
      { usageCount: this.sequelize.literal("usage_count + 1") },
      { where: { id: coupon.id }, transaction: tx, silent: true },
    );
  }
  await CouponRedemption.create(
    {
      couponId: coupon.id,
      userId: order.userId ?? null,
      email: String(order.customerEmail || "").toLowerCase(),
      orderId: order.id,
      amount: discount.amount,
    },
    { transaction: tx },
  );
}

// Cart: check a code against the current lines and return the new goods total.
export async function validateCoupon(req, res) {
  const body = decode(req, res);
  if (!body) return;
  // Lines are rebuilt from the catalog so the client cannot invent prices.
  const items = await this.buildOrderItems(res, body.items);
  if (!items) return;
  let subtotal = 0;
  for (const item of items) subtotal += Number(item.price) * Number(item.quantity);
  const userId = req.user ? req.user.userId : null;
  let discount;
  try {
    discount = await this.evaluateCoupon(body.code, subtotal, items, userId, body.email);
  } catch (err) {
    if (err.couponRejected) {
      json(res, 422, { error: "coupon_rejected", reason: err.reason });
      return;
    }
    console.log(`[COUPON] validate: ${err.message}`);
    error(res, 500, "failed to validate coupon");
    return;
  }
  const view = {
    code: discount.code,
    type: discount.type,
    amount: discount.amount,
    freeShipping: discount.freeShipping,
  };
  if (discount.description) view.description = discount.description;
  json(res, 200, { valid: true, discount: view, subtotal: round2(subtotal), newTotal: round2(subtotal - discount.amount) });
}

// Copy the admin form into coupon columns. A bad start or expiry date fails the whole body.
function couponFromBody(body) {
  const coupon = {
    code: body.code || "",
    description: body.description || "",
    type: body.type || "",
    value: Number(body.value || 0),
    maxDiscount: Number(body.maxDiscount || 0),
    minSubtotal: Number(body.minSubtotal || 0),
    usageLimit: Number(body.usageLimit || 0),
    perUserLimit: body.perUserLimit == null ? 0 : Number(body.perUserLimit),
    categoryIds: Array.isArray(body.categoryIds) ? body.categoryIds.map(String) : [],
    productIds: Array.isArray(body.productIds) ? body.productIds.map(String) : [],
    firstOrderOnly: Boolean(body.firstOrderOnly),
    startsAt: null,
    expiresAt: null,
    active: Boolean(body.active),
  };
  if (body.startsAt) {
    const d = new Date(body.startsAt);
    if (Number.isNaN(d.getTime())) return { error: "invalid request body" };
    coupon.startsAt = d;
  }
  if (body.expiresAt) {
    const d = new Date(body.expiresAt);
    if (Number.isNaN(d.getTime())) return { error: "invalid request body" };
    coupon.expiresAt = d;
  }
  return { coupon };
}

// Rules for a code an admin is saving. Returns an error sentence, or an empty string when the code is acceptable.
function validateCouponInput(coupon) {
  coupon.code = String(coupon.code ?? "").trim().toUpperCase();
  if (!coupon.code) return "code is required";
  if (coupon.code.length > 32) return "code must be 32 characters or fewer";
  if (coupon.type === "percentage") {
    if (coupon.value <= 0 || coupon.value > 100) return "percentage value must be between 1 and 100";
  } else if (coupon.type === "fixed") {
    if (coupon.value <= 0) return "fixed discount must be greater than 0";
  } else if (coupon.type === "free_shipping") {
    coupon.value = 0;
  } else {
    return "type must be percentage, fixed or free_shipping";
  }
  if (coupon.startsAt && coupon.expiresAt && coupon.expiresAt < coupon.startsAt) {
    return "expiry must be after the start date";
  }
  return "";
}

// Admin: every coupon, newest first.
export async function listCoupons(req, res) {
  try {
    const coupons = await Coupon.findAll({ order: [["createdAt", "DESC"]] });
    json(res, 200, { coupons: coupons.map((coupon) => coupon.toJSON()), count: coupons.length });
  } catch (err) {
    console.log(`[COUPON] list: ${err.message}`);
    error(res, 500, "failed to load coupons");
  }
}

// Admin: create a coupon. A code that already exists is rejected.
export async function createCoupon(req, res) {
  const body = decode(req, res);
  if (!body) return;
  const parsed = couponFromBody(body);
  if (parsed.error) {
    error(res, 400, parsed.error);
    return;
  }
  const msg = validateCouponInput(parsed.coupon);
  if (msg) {
    error(res, 400, msg);
    return;
  }
  try {
    const coupon = await Coupon.create(parsed.coupon);
    json(res, 201, coupon.toJSON());
  } catch (err) {
    if (isUniqueViolation(err)) {
      error(res, 409, "a coupon with that code already exists");
      return;
    }
    console.log(`[COUPON] create: ${err.message}`);
    error(res, 500, "failed to create coupon");
  }
}

// Admin: replace a coupon's rules. The number of times it has already been used is kept.
export async function updateCoupon(req, res) {
  const id = parseId(req.params.id);
  if (id == null) {
    error(res, 400, "invalid coupon ID");
    return;
  }
  const existing = await Coupon.findByPk(id);
  if (!existing) {
    error(res, 404, "coupon not found");
    return;
  }
  const body = decode(req, res);
  if (!body) return;
  const parsed = couponFromBody(body);
  if (parsed.error) {
    error(res, 400, parsed.error);
    return;
  }
  // usageCount is not part of the form. Keep the live count so an edit does not reset redemptions.
  parsed.coupon.usageCount = existing.usageCount;
  const msg = validateCouponInput(parsed.coupon);
  if (msg) {
    error(res, 400, msg);
    return;
  }
  try {
    await existing.update({
      code: parsed.coupon.code,
      description: parsed.coupon.description,
      type: parsed.coupon.type,
      value: parsed.coupon.value,
      maxDiscount: parsed.coupon.maxDiscount,
      minSubtotal: parsed.coupon.minSubtotal,
      usageLimit: parsed.coupon.usageLimit,
      perUserLimit: parsed.coupon.perUserLimit,
      categoryIds: parsed.coupon.categoryIds,
      productIds: parsed.coupon.productIds,
      firstOrderOnly: parsed.coupon.firstOrderOnly,
      startsAt: parsed.coupon.startsAt,
      expiresAt: parsed.coupon.expiresAt,
      active: parsed.coupon.active,
    });
  } catch (err) {
    console.log(`[COUPON] update: ${err.message}`);
    error(res, 500, "failed to update coupon");
    return;
  }
  json(res, 200, { id: Number(existing.id), usageCount: existing.usageCount, ...parsed.coupon });
}

// Admin: delete a coupon. Past redemption rows are left in place by this handler.
export async function deleteCoupon(req, res) {
  const id = parseId(req.params.id);
  if (id == null) {
    error(res, 400, "invalid coupon ID");
    return;
  }
  try {
    await Coupon.destroy({ where: { id } });
  } catch (err) {
    console.log(`[COUPON] delete: ${err.message}`);
    error(res, 500, "failed to delete coupon");
    return;
  }
  json(res, 200, { success: true });
}
