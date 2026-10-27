// Product reviews on the shop, and the admin queue that approves them.
//
// A signed-in customer can leave one review per product, with up to five
// photos. A review from someone who paid for that product is approved
// immediately and counted in the star rating. Everyone else's review waits
// for an admin. The product page lists only approved reviews, verified
// purchases first. Ten days after delivery we email a request to review
// the first item on the order.

import { Op, QueryTypes } from "sequelize";
import { json, error, decode } from "../../pkg/httpjson/httpjson.js";
import { requireUser } from "../auth/jwt.js";
import { Product, Review, User, Order, OrderItem } from "../models/index.js";

// A verified purchase is published without waiting in the moderation queue.
const reviewAutoApproveVerified = true;
// An account that has been erased must not show that label as the author name.
const erasedUserName = "Deleted user";

// Read a query number such as limit or offset. Anything that is not a whole number is ignored.
function atoi(value) {
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== "string" || !/^[+-]?\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

// A review id in the URL must be a plain non-negative integer.
function parseUint(value) {
  const text = String(value ?? "");
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

// Cut a string to a maximum number of bytes without splitting a multi-byte character.
function clipBytes(text, max) {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= max) return text;
  let end = max;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
  return buf.subarray(0, end).toString("utf8");
}

// Two reviews for the same person and product hit the unique index. That race is handled by updating the existing row.
function isDuplicateKey(err) {
  const seen = new Set();
  let current = err;
  while (current && !seen.has(current)) {
    seen.add(current);
    const text = String(current.message || current);
    if (text.includes("23505") || text.includes("duplicate key")) return true;
    if (current.parent?.code === "23505" || current.original?.code === "23505") return true;
    current = current.cause || current.parent || current.original;
  }
  return false;
}

// A published review changes the stars on the product page, so the catalog cache is cleared.
async function safeInvalidate(handler) {
  try {
    await handler.invalidateCatalog();
  } catch (err) {
    console.error(err);
  }
}

// True when this customer has a paid order that contains the product.
export async function hasPurchased(userId, productId) {
  const rows = await this.sequelize.query(
    `SELECT COUNT(*)::int AS count
     FROM order_items
     JOIN orders ON orders.id = order_items.order_id
     WHERE order_items.product_id = :productId
       AND orders.user_id = :userId
       AND orders.payment_status = 'paid'
       AND order_items.deleted_at IS NULL`,
    { replacements: { productId, userId }, type: QueryTypes.SELECT },
  );
  return Number(rows[0]?.count || 0) > 0;
}

// The review the product page shows: first name, verified flag, and public image URLs.
export function decorateReview(review) {
  const plain = review?.toJSON ? review.toJSON() : { ...(review || {}) };
  let author = String(plain.user?.name || "").trim();
  if (author === erasedUserName) author = "";
  const parts = author.split(/\s+/).filter(Boolean);
  // Only the first name is shown.
  if (parts.length) author = parts[0];
  if (!author) author = "Growman customer";

  // Each stored image key becomes a public image URL. Empty keys are skipped.
  const images = [];
  for (const key of plain.imageKeys || []) {
    const url = this.resolveImageURL(key);
    if (url) images.push(url);
  }

  return {
    id: plain.id,
    rating: plain.rating,
    title: plain.title ?? "",
    comment: plain.comment ?? "",
    author,
    verifiedPurchase: Boolean(plain.verifiedPurchase),
    images,
    createdAt: plain.createdAt,
  };
}

// One review per customer per product. A second submit updates the existing row, including a soft-deleted one.
async function saveReview(fields) {
  const patch = {
    rating: fields.rating,
    title: fields.title,
    comment: fields.comment,
    status: fields.status,
    verifiedPurchase: fields.verifiedPurchase,
    imageKeys: fields.imageKeys,
  };
  const existing = await Review.findOne({
    where: { productId: fields.productId, userId: fields.userId },
    paranoid: false,
  });
  if (existing) {
    await Review.update(patch, { where: { id: existing.id }, paranoid: false });
    existing.set(patch);
    return existing;
  }
  try {
    return await Review.create(fields);
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    // Another request inserted the row between the lookup and the insert. Update that row instead.
    const again = await Review.findOne({
      where: { productId: fields.productId, userId: fields.userId },
      paranoid: false,
    });
    if (!again) throw err;
    await Review.update(patch, { where: { id: again.id }, paranoid: false });
    again.set(patch);
    return again;
  }
}

// Signed-in customer: save a review for the product slug.
// Rating is a whole number from 1 to 5. Title, comment, and photos are trimmed to the limits.
export async function createProductReview(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const slug = req.params.slug;

  const body = decode(req, res);
  if (!body) return;

  const rating = body.rating == null ? 0 : body.rating;
  if (typeof rating !== "number" || !Number.isInteger(rating)) {
    error(res, 400, "invalid request body");
    return;
  }
  if (rating < 1 || rating > 5) {
    error(res, 400, "rating must be between 1 and 5");
    return;
  }
  if (body.title != null && typeof body.title !== "string") {
    error(res, 400, "invalid request body");
    return;
  }
  if (body.comment != null && typeof body.comment !== "string") {
    error(res, 400, "invalid request body");
    return;
  }
  if (body.imageKeys != null && !Array.isArray(body.imageKeys)) {
    error(res, 400, "invalid request body");
    return;
  }

  let comment = clipBytes(String(body.comment ?? "").trim(), 4000);
  let title = clipBytes(String(body.title ?? "").trim(), 140);
  let imageKeys = Array.isArray(body.imageKeys) ? body.imageKeys.slice(0, 5) : [];

  let product;
  try {
    product = await Product.findOne({
      attributes: ["id", "name", "slug"],
      where: { slug },
    });
  } catch {
    error(res, 404, "product not found");
    return;
  }
  if (!product) {
    error(res, 404, "product not found");
    return;
  }

  // A paid order for this product marks the review as a verified purchase.
  let verified = false;
  try {
    verified = await this.hasPurchased(claims.userId, product.id);
  } catch (err) {
    console.log(`[REVIEW] purchase check: ${err.message}`);
  }

  // Verified purchases are approved immediately. Other reviews wait for an admin.
  const status = verified && reviewAutoApproveVerified ? "approved" : "pending";

  let review;
  try {
    review = await saveReview({
      productId: product.id,
      userId: claims.userId,
      rating,
      title,
      comment,
      status,
      verifiedPurchase: verified,
      imageKeys,
    });
  } catch (err) {
    console.log(`[REVIEW] create: ${err.message}`);
    error(res, 500, "failed to save review");
    return;
  }

  if (status === "approved") {
    // The star average on the product changes as soon as an approved review is saved.
    try {
      await this.recalculateProductRating(product.id);
    } catch (err) {
      console.log(`[REVIEW] recalculate rating: ${err.message}`);
    }
    await safeInvalidate(this);
  } else if (typeof this.notifyMerchantAsync === "function") {
    Promise.resolve(this.notifyMerchantAsync(
      "New review awaiting moderation",
      `A review was submitted for ${product.name} and is waiting for approval in the admin queue.`,
    )).catch((err) => console.log(`[REVIEW] notify: ${err.message}`));
  }

  try {
    const user = await User.findOne({
      attributes: ["id", "name"],
      where: { id: claims.userId },
    });
    if (user) review.setDataValue("user", user);
  } catch {
    /* author falls back to the anonymous label */
  }

  const message = status === "approved"
    ? "Thanks! Your review is live."
    : "Thanks! Your review will appear once we've checked it over.";
  json(res, 200, {
    success: true,
    status,
    message,
    review: this.decorateReview(review),
  });
}

// Reviews for the product page. Only approved reviews are shown.
export async function listProductReviews(req, res) {
  const slug = req.params.slug;
  let product;
  try {
    product = await Product.findOne({
      attributes: ["id", "ratingAverage", "ratingCount"],
      where: { slug },
    });
  } catch {
    error(res, 404, "product not found");
    return;
  }
  if (!product) {
    error(res, 404, "product not found");
    return;
  }

  // Page size defaults to 20 and cannot exceed 100.
  let limit = 20;
  const parsedLimit = atoi(req.query.limit);
  if (parsedLimit != null && parsedLimit > 0 && parsedLimit <= 100) limit = parsedLimit;
  let offset = 0;
  const parsedOffset = atoi(req.query.offset);
  if (parsedOffset != null && parsedOffset > 0) offset = parsedOffset;

  let reviews;
  try {
    // Only approved reviews are shown on the product page. Verified purchases are listed first.
    reviews = await Review.findAll({
      where: { productId: product.id, status: "approved" },
      include: [{ model: User, as: "user", attributes: ["id", "name"] }],
      order: [["verifiedPurchase", "DESC"], ["createdAt", "DESC"]],
      limit,
      offset,
    });
  } catch (err) {
    console.log(`[REVIEW] list: ${err.message}`);
    error(res, 500, "failed to load reviews");
    return;
  }

  // How many approved reviews gave each star, from 5 down to 1.
  let histogram = null;
  try {
    const rows = await this.sequelize.query(
      `SELECT rating, COUNT(*)::int AS count
       FROM reviews
       WHERE product_id = :productId AND status = 'approved' AND deleted_at IS NULL
       GROUP BY rating
       ORDER BY rating DESC`,
      { replacements: { productId: product.id }, type: QueryTypes.SELECT },
    );
    histogram = rows.length
      ? rows.map((row) => ({ rating: Number(row.rating), count: Number(row.count) }))
      : null;
  } catch (err) {
    console.log(`[REVIEW] histogram: ${err.message}`);
  }

  json(res, 200, {
    reviews: reviews.map((review) => this.decorateReview(review)),
    ratingAverage: Number(product.ratingAverage || 0),
    ratingCount: Number(product.ratingCount || 0),
    histogram,
  });
}

// Recompute the product's star average and review count from approved reviews only.
export async function recalculateProductRating(productId) {
  const rows = await this.sequelize.query(
    `SELECT COALESCE(AVG(rating), 0) AS average, COUNT(*)::int AS count
     FROM reviews
     WHERE product_id = :productId AND status = 'approved' AND deleted_at IS NULL`,
    { replacements: { productId }, type: QueryTypes.SELECT },
  );
  const row = rows[0];
  // The average shown on the product is one decimal place.
  const average = Math.trunc(Number(row?.average || 0) * 10 + 0.5) / 10;
  const count = Number(row?.count || 0);
  await Product.update(
    { ratingAverage: average, ratingCount: count },
    { where: { id: productId }, silent: true },
  );
}

// Admin queue. Status defaults to pending. "all" returns every status, newest first, up to 200.
export async function listReviewsForModeration(req, res) {
  const rawStatus = Array.isArray(req.query.status) ? req.query.status[0] : req.query.status;
  let status = String(rawStatus ?? "").trim();
  if (!status) status = "pending";

  try {
    const where = status === "all" ? {} : { status };
    const reviews = await Review.findAll({
      where,
      include: [{ model: User, as: "user", attributes: ["id", "name", "email"] }],
      order: [["createdAt", "DESC"]],
      limit: 200,
    });

    // Product names are loaded in one query so the queue can show what was reviewed.
    const nameById = new Map();
    const productIds = [...new Set(reviews.map((review) => review.productId))];
    if (productIds.length) {
      try {
        const products = await Product.findAll({
          attributes: ["id", "name"],
          where: { id: productIds },
        });
        for (const product of products) nameById.set(product.id, product.name);
      } catch {
        /* names stay blank */
      }
    }

    const out = reviews.map((review) => {
      const plain = review.toJSON();
      return {
        id: plain.id,
        productId: plain.productId,
        productName: nameById.get(plain.productId) ?? "",
        rating: plain.rating,
        title: plain.title ?? "",
        comment: plain.comment ?? "",
        status: plain.status,
        verifiedPurchase: Boolean(plain.verifiedPurchase),
        authorName: plain.user?.name ?? "",
        authorEmail: plain.user?.email ?? "",
        createdAt: plain.createdAt,
        adminNotes: plain.adminNotes ?? "",
      };
    });
    json(res, 200, { reviews: out, count: out.length });
  } catch (err) {
    console.log(`[REVIEW] moderation list: ${err.message}`);
    error(res, 500, "failed to load reviews");
  }
}

// Admin: set a review to approved, rejected, or pending, then recompute that product's stars.
export async function moderateReview(req, res) {
  const reviewId = parseUint(req.params.id);
  if (reviewId == null) {
    error(res, 400, "invalid review ID");
    return;
  }

  const body = decode(req, res);
  if (!body) return;
  if (body.status !== "approved" && body.status !== "rejected" && body.status !== "pending") {
    error(res, 400, "status must be approved, rejected or pending");
    return;
  }

  let review;
  try {
    review = await Review.findOne({ where: { id: reviewId } });
  } catch {
    error(res, 404, "review not found");
    return;
  }
  if (!review) {
    error(res, 404, "review not found");
    return;
  }

  try {
    await Review.update(
      { status: body.status, adminNotes: body.adminNotes == null ? "" : String(body.adminNotes) },
      { where: { id: review.id } },
    );
  } catch (err) {
    console.log(`[REVIEW] moderate: ${err.message}`);
    error(res, 500, "failed to update review");
    return;
  }

  // Approving or rejecting changes which reviews count toward the product rating.
  try {
    await this.recalculateProductRating(review.productId);
  } catch (err) {
    console.log(`[REVIEW] recalculate rating: ${err.message}`);
  }
  await safeInvalidate(this);
  json(res, 200, { success: true, status: body.status });
}

// Email a review request for orders delivered more than ten days ago that have not been asked yet.
// Only the first line on the order is mentioned. An order that already has a review is marked asked and skipped.
export async function sendReviewRequests() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 10);

  const orders = await Order.findAll({
    where: {
      paymentStatus: "paid",
      deliveredAt: { [Op.ne]: null, [Op.lt]: cutoff },
      userId: { [Op.ne]: null },
      customerEmail: { [Op.ne]: "" },
      reviewRequestedAt: null,
    },
    include: [{ model: OrderItem, as: "items", separate: true, order: [["id", "ASC"]] }],
    limit: 50,
  });

  let sent = 0;
  for (const order of orders) {
    const items = order.items || [];
    if (!items.length || order.userId == null) continue;
    const item = items[0];

    let product;
    try {
      product = await Product.findOne({
        attributes: ["id", "name", "slug"],
        where: { id: item.productId },
      });
    } catch {
      continue;
    }
    if (!product) continue;

    let existing = 0;
    try {
      existing = await Review.count({
        where: { productId: product.id, userId: order.userId },
      });
    } catch {
      existing = 0;
    }
    if (existing > 0) {
      await this.markReviewRequested(order.id);
      continue;
    }

    const svc = typeof this.emailService === "function" ? this.emailService() : this.emailService;
    const send = svc?.sendReviewRequestEmail || svc?.SendReviewRequestEmail;
    if (typeof send !== "function") {
      console.log("[REVIEW] request email: email service not configured");
      continue;
    }
    try {
      await send.call(svc, order.customerEmail, order.customerName, order.id, product.name, product.slug);
    } catch (err) {
      console.log(`[REVIEW] request email: ${err.message}`);
      continue;
    }
    await this.markReviewRequested(order.id);
    sent += 1;
  }
  return sent;
}

// Remember that this order has already been asked for a review, so the worker does not email it again.
export async function markReviewRequested(orderId) {
  try {
    await Order.update(
      { reviewRequestedAt: new Date() },
      { where: { id: orderId }, silent: true },
    );
  } catch (err) {
    console.log(`[REVIEW] mark requested: ${err.message}`);
  }
}
