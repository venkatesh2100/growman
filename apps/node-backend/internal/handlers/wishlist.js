// The signed-in customer's wishlist.
//
// Adding a product remembers the price at that moment. Opening the list
// compares today's price with that saved price and, when it has dropped by
// more than one rupee, drops a notice in the inbox. Removing an item deletes
// the row for good. A product that was removed from the catalog still leaves
// a gap in the list so the saved order of the other items stays put.

import { QueryTypes } from "sequelize";
import { json, error, decode } from "../../pkg/httpjson/httpjson.js";
import { requireUser } from "../auth/jwt.js";
import { Product, ProductSize, Category, Wishlist } from "../models/index.js";

// Saving the same product twice hits the unique index. That is treated as "already saved".
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

// The API calls the short and full blurbs shortDescription and fullDescription.
function wireProduct(body) {
  if (!body || typeof body !== "object") return body;
  if (Object.prototype.hasOwnProperty.call(body, "shortDesc")) body.shortDescription = body.shortDesc;
  if (Object.prototype.hasOwnProperty.call(body, "fullDesc")) body.fullDescription = body.fullDesc;
  return body;
}

// The wishlist row for this customer and product, including a soft-deleted one.
async function findWishlistRow(sequelize, userId, productId) {
  const rows = await sequelize.query(
    `SELECT id, deleted_at FROM wishlists
     WHERE user_id = :userId AND product_id = :productId
     ORDER BY id LIMIT 1`,
    { replacements: { userId, productId }, type: QueryTypes.SELECT },
  );
  return rows[0] || null;
}

// Put a previously removed wishlist row back by clearing its deleted timestamp.
async function restoreWishlist(sequelize, id) {
  await sequelize.query(
    `UPDATE wishlists SET deleted_at = NULL, updated_at = NOW() WHERE id = :id`,
    { replacements: { id } },
  );
}

// The signed-in customer's saved products, newest first, with image URLs filled in.
export async function listWishlist(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;

  try {
    const items = await Wishlist.findAll({
      where: { userId: claims.userId },
      order: [["createdAt", "DESC"]],
      include: [{
        model: Product,
        as: "product",
        include: [
          { model: ProductSize, as: "sizes", separate: true },
          { model: Category, as: "category" },
        ],
      }],
    });

    const products = [];
    for (const item of items) {
      const product = item.product;
      // A drop of more than one rupee below the price saved at add time sends an inbox notice.
      if (product && Number(item.priceAtAdd) > 0 && Number(product.price) > 0
        && Number(product.price) < Number(item.priceAtAdd) - 1) {
        if (typeof this.pushNotice === "function") {
          try {
            await this.pushNotice(
              claims.userId,
              "offer",
              "Price drop on your wishlist",
              `${product.name} is now lower than when you saved it.`,
              `/product/${product.slug}`,
              `drop:${item.productId}:${Math.trunc(Number(product.price))}`,
              null,
              item.productId,
              null,
            );
          } catch (err) {
            console.log(`[NOTIFY] inbox: ${err.message}`);
          }
        }
      }
      products.push(product || null);
    }

    // Image URLs are resolved only for products that still exist.
    const resolved = this.resolveProductImageURLsSlice(products.filter(Boolean));
    let cursor = 0;
    const out = products.map((product) => {
      if (!product) return {};
      return wireProduct(resolved[cursor++]);
    });
    json(res, 200, out);
  } catch (err) {
    console.log(`[WISHLIST] Error fetching wishlist: ${err.message}`);
    error(res, 500, "failed to fetch wishlist");
  }
}

// Save a product. The price at this moment is stored so a later drop can be noticed.
// A product already on the list, including one that was soft-deleted, is restored and reported as already saved.
export async function addToWishlist(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;

  const body = decode(req, res);
  if (!body) return;
  const productId = Number(body.productId);
  if (!Number.isInteger(productId) || productId <= 0) {
    error(res, 400, "productId is required");
    return;
  }

  let product;
  try {
    product = await Product.findOne({ where: { id: productId } });
  } catch {
    error(res, 404, "product not found");
    return;
  }
  if (!product) {
    error(res, 404, "product not found");
    return;
  }

  try {
    const existing = await findWishlistRow(this.sequelize, claims.userId, productId);
    if (existing?.id) {
      if (existing.deleted_at) {
        try {
          await restoreWishlist(this.sequelize, existing.id);
        } catch (err) {
          console.log(`[WISHLIST] Error restoring wishlist: ${err.message}`);
          error(res, 500, "failed to add to wishlist");
          return;
        }
      }
      json(res, 200, { message: "already in wishlist" });
      return;
    }
  } catch {
    /* fall through and try the insert, matching the Go lookup miss */
  }

  try {
    await Wishlist.create({
      userId: claims.userId,
      productId,
      priceAtAdd: product.price,
    });
    json(res, 201, { message: "added to wishlist" });
  } catch (err) {
    if (isDuplicateKey(err)) {
      try {
        // The unique index fired because a row already exists. Clear its deleted flag and treat the save as done.
        const row = await findWishlistRow(this.sequelize, claims.userId, productId);
        if (row?.id) {
          await restoreWishlist(this.sequelize, row.id);
          json(res, 200, { message: "added to wishlist" });
          return;
        }
      } catch (restoreErr) {
        console.log(`[WISHLIST] Error adding to wishlist: ${restoreErr.message}`);
        error(res, 500, "failed to add to wishlist");
        return;
      }
    }
    console.log(`[WISHLIST] Error adding to wishlist: ${err.message}`);
    error(res, 500, "failed to add to wishlist");
  }
}

// Remove one product from this customer's wishlist. The row is deleted for good.
export async function removeFromWishlist(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;

  const raw = req.params.productId;
  if (!/^\d+$/.test(String(raw || ""))) {
    error(res, 400, "invalid productId");
    return;
  }
  const productId = Number(raw);
  if (!Number.isSafeInteger(productId) || productId <= 0 || productId > 0xffffffff) {
    error(res, 400, "invalid productId");
    return;
  }

  try {
    const removed = await Wishlist.destroy({
      where: { userId: claims.userId, productId },
      force: true,
    });
    if (!removed) {
      error(res, 404, "item not in wishlist");
      return;
    }
    json(res, 200, { message: "removed from wishlist" });
  } catch (err) {
    console.log(`[WISHLIST] Error removing from wishlist: ${err.message}`);
    error(res, 500, "failed to remove from wishlist");
  }
}
