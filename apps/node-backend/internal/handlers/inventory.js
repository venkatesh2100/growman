/*
This file keeps Growman's plant stock honest.

Checkout checks that enough plants are free, then holds them by lowering
the stock count. A paid order keeps that hold. A failed payment, a cancel,
or a checkout that sits unpaid for 30 minutes puts the plants back.

When stock comes back from zero, people who asked to be emailed are told.
An admin can set stock by hand and can list plants that are running low.
A background timer sweeps abandoned checkouts so reserved plants are not
held forever.
*/

import { Op, QueryTypes } from "sequelize";
import { json, error, decode } from "../../pkg/httpjson/httpjson.js";
import { Product, ProductSize, Order, OrderItem, BackInStockRequest } from "../models/index.js";
import { validateEmail, renderEmail, escapeHtml } from "./auth.js";

// An unpaid checkout holds stock for 30 minutes. The reminder email only goes
// to checkouts from the last 45 minutes, and at most 8 emails per sweep.
const abandonedOrderTTLMs = 30 * 60 * 1000;
const abandonedEmailWindowMs = 45 * 60 * 1000;
const maxAbandonedEmailsPerSweep = 8;

// Thrown when a hold or a commit cannot take the requested quantity.
// Checkout and payment turn this into an out-of-stock response or a support ticket.
export class OutOfStockError extends Error {
  // name is the plant label when we have it. productId is used in the message when the name is blank.
  constructor(name, productId) {
    const message = name
      ? `${name} is no longer available in the requested quantity`
      : `product ${productId} is no longer available in the requested quantity`;
    super(message);
    this.outOfStock = true;
    this.productId = productId;
    this.itemName = name || "";
  }
}

// Run a SQL statement that returns rows, inside the caller's transaction when one was given.
async function returning(sequelize, sql, bind, transaction) {
  const rows = await sequelize.query(sql, { bind, transaction, type: QueryTypes.SELECT });
  return rows;
}

// Load the current stock for each cart line.
// A sized line uses the size's stock and a name like "Money plant (Medium)".
// trackInventory false means the product is always treated as available.
// Throws if a product or size id does not exist.
export async function loadStockLines(items, transaction) {
  const productIds = [];
  const sizeIds = [];
  for (const item of items || []) {
    productIds.push(item.productId);
    if (item.productSizeId != null) sizeIds.push(item.productSizeId);
  }
  const products = await Product.findAll({
    attributes: ["id", "name", "stock", "trackInventory"],
    where: { id: { [Op.in]: productIds.length ? productIds : [0] } },
    transaction,
  });
  const productById = new Map(products.map((product) => [Number(product.id), product]));
  const sizeById = new Map();
  if (sizeIds.length) {
    const sizes = await ProductSize.findAll({
      attributes: ["id", "productId", "label", "stock"],
      where: { id: { [Op.in]: sizeIds } },
      transaction,
    });
    for (const size of sizes) sizeById.set(Number(size.id), size);
  }
  const lines = [];
  for (const item of items || []) {
    const product = productById.get(Number(item.productId));
    if (!product) throw new Error(`product ${item.productId} not found`);
    const line = {
      productId: Number(item.productId),
      productSizeId: item.productSizeId != null ? Number(item.productSizeId) : null,
      name: product.name,
      quantity: item.quantity,
      tracked: product.trackInventory !== false,
      available: product.stock,
    };
    if (item.productSizeId != null) {
      const size = sizeById.get(Number(item.productSizeId));
      if (!size) throw new Error(`product size ${item.productSizeId} not found`);
      line.available = size.stock;
      if (size.label) line.name = `${product.name} (${size.label})`;
    }
    lines.push(line);
  }
  return lines;
}

// Tell checkout whether every tracked line has enough stock.
// Called before we create the Razorpay order. Untracked products are skipped.
// When something is short, the response lists what was asked and what is left.
export async function checkStockAvailability(req, res, items) {
  let lines;
  try {
    lines = await this.loadStockLines(items);
  } catch (err) {
    console.log(`[INVENTORY] load stock: ${err.message}`);
    error(res, 400, "failed to check availability");
    return false;
  }
  const problems = [];
  for (const line of lines) {
    if (!line.tracked) continue;
    if (line.available < line.quantity) {
      const row = {
        productId: line.productId,
        name: line.name,
        requested: line.quantity,
        available: Math.max(line.available, 0),
      };
      if (line.productSizeId != null) row.productSizeId = line.productSizeId;
      problems.push(row);
    }
  }
  if (problems.length) {
    json(res, 409, { error: "out_of_stock", items: problems });
    return false;
  }
  return true;
}

// Lower stock for each line so two checkouts cannot sell the same plant.
// Called inside the checkout transaction, and again when a failed payment is retried.
// The SQL only updates a row when enough stock remains. No row means the plant is gone.
// Products that do not track inventory are still "updated" so the hold succeeds.
export async function reserveOrderInventory(tx, items) {
  for (const item of items || []) {
    if (item.quantity < 1) throw new Error(`invalid quantity for product ${item.productId}`);
    const sizeId = item.productSizeId ?? item.productSize ?? null;
    let rows;
    if (sizeId != null) {
      rows = await returning(
        this.sequelize,
        `UPDATE product_sizes SET stock = stock - $1, updated_at = NOW()
         WHERE id = $2 AND stock >= $1
         RETURNING id`,
        [item.quantity, sizeId],
        tx,
      );
    } else {
      rows = await returning(
        this.sequelize,
        `UPDATE products SET stock = stock - $1, updated_at = NOW()
         WHERE id = $2 AND (track_inventory = false OR stock >= $1)
         RETURNING id`,
        [item.quantity, item.productId],
        tx,
      );
    }
    if (!rows.length) throw new OutOfStockError(item.name, item.productId);
  }
}

// Keep the stock hold when an order is paid.
// If the plants are still held (inventory_released is false), there is nothing to do.
// If they were already released, take them again and mark the order as holding stock.
// Called from markOrderPaid the first time the order becomes paid.
export async function commitOrderInventory(tx, order) {
  const held = await returning(
    this.sequelize,
    `UPDATE orders SET inventory_released = false
     WHERE id = $1 AND inventory_released = false
     RETURNING id`,
    [order.id],
    tx,
  );
  if (held.length === 1) return;
  await this.reserveOrderInventory(tx, order.items || []);
  await this.sequelize.query(
    `UPDATE orders SET inventory_released = false WHERE id = $1`,
    { bind: [order.id], transaction: tx },
  );
}

// Put an order's plants back in stock, once.
// Called when a payment fails, when an order is cancelled, and when a refund restocks.
// The first statement claims the release. A second call finds the flag already set and returns.
// Sizes always get their count back. Unsized products get it back only when they track inventory.
export async function releaseOrderInventory(tx, order) {
  const claimed = await returning(
    this.sequelize,
    `UPDATE orders SET inventory_released = true
     WHERE id = $1 AND inventory_released = false
     RETURNING id`,
    [order.id],
    tx,
  );
  if (!claimed.length) return;
  let items = order.items || [];
  if (!items.length) {
    items = await OrderItem.findAll({ where: { orderId: order.id }, transaction: tx });
  }
  for (const item of items) {
    const sizeId = item.productSizeId ?? null;
    if (sizeId != null) {
      await this.sequelize.query(
        `UPDATE product_sizes SET stock = stock + $1, updated_at = NOW() WHERE id = $2`,
        { bind: [item.quantity, sizeId], transaction: tx },
      );
      continue;
    }
    await this.sequelize.query(
      `UPDATE products SET stock = stock + $1, updated_at = NOW() WHERE id = $2 AND track_inventory = true`,
      { bind: [item.quantity, item.productId], transaction: tx },
    );
  }
  order.inventoryReleased = true;
}

// Add quantities back onto many products or sizes in one statement.
// Used by the abandoned-checkout sweep. Returns the plants that crossed from
// zero (or below) to at least one, so we can email the waiting list.
async function applyStockDelta(sequelize, sizes, ids, qty, transaction) {
  if (!ids.length) return [];
  if (ids.length !== qty.length) throw new Error("stock delta length mismatch");
  const binds = [];
  const tuples = [];
  for (let index = 0; index < ids.length; index++) {
    const base = binds.length;
    tuples.push(`($${base + 1}::bigint,$${base + 2}::int)`);
    binds.push(ids[index], qty[index]);
  }
  const table = sizes ? "product_sizes" : "products";
  let sql = `UPDATE ${table} AS s SET stock = s.stock + v.qty, updated_at = NOW() FROM (VALUES ${tuples.join(",")}) AS v(id, qty) WHERE s.id = v.id`;
  if (!sizes) sql += ` AND s.track_inventory = true`;
  if (sizes) sql += ` RETURNING s.id, s.product_id, (s.stock - v.qty) AS prev_stock, s.stock AS new_stock`;
  else sql += ` RETURNING s.id, s.id AS product_id, (s.stock - v.qty) AS prev_stock, s.stock AS new_stock`;
  const rows = await sequelize.query(sql, { bind: binds, transaction, type: QueryTypes.SELECT });
  const targets = [];
  for (const row of rows) {
    const previousStock = Number(row.prev_stock);
    const newStock = Number(row.new_stock);
    // Still out of stock, or it was already in stock. Nobody new to email.
    if (previousStock > 0 || newStock < 1) continue;
    const target = { productId: Number(row.product_id) };
    if (sizes) target.sizeId = Number(row.id);
    targets.push(target);
  }
  return targets;
}

// Pick which abandoned checkouts should get a "you left plants in your cart" email.
// Newest first, only from the last 45 minutes, one email per customer address, up to limit.
export function selectAbandonedNudges(orders, now, limit) {
  if (limit <= 0 || !orders?.length) return [];
  const earliest = now.getTime() - abandonedEmailWindowMs;
  const sorted = [...orders].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  const seen = new Set();
  const chosen = [];
  for (const order of sorted) {
    if (new Date(order.createdAt).getTime() < earliest) continue;
    const email = String(order.customerEmail ?? "").trim().toLowerCase();
    if (!email.includes("@")) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    chosen.push({ ...order, customerEmail: email });
    if (chosen.length >= limit) break;
  }
  return chosen;
}

// Pick which abandoned checkouts the shop should be told about.
// Same window and cap as the customer email, but an order with no email is still included.
export function selectAbandonedAlerts(orders, now, limit) {
  if (limit <= 0 || !orders?.length) return [];
  const earliest = now.getTime() - abandonedEmailWindowMs;
  const sorted = [...orders].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  const seen = new Set();
  const chosen = [];
  for (const order of sorted) {
    if (new Date(order.createdAt).getTime() < earliest) continue;
    let key = String(order.customerEmail ?? "").trim().toLowerCase();
    if (!key.includes("@")) key = `#${order.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const copy = { ...order };
    if (key.includes("@")) copy.customerEmail = key;
    chosen.push(copy);
    if (chosen.length >= limit) break;
  }
  return chosen;
}

// Release plants held by checkouts that were never paid.
// A timer calls this every few minutes. Orders still in "created" after 30 minutes
// are marked abandoned, their stock is returned, the customer may get one email,
// and the shop is told. Plants that come back from zero notify the waiting list.
export async function sweepAbandonedOrders() {
  const cutoff = new Date(Date.now() - abandonedOrderTTLMs);
  let claimed = [];
  let restocks = [];
  await this.sequelize.transaction(async (tx) => {
    // Lock up to 200 unpaid holds so two servers do not release the same order.
    claimed = await this.sequelize.query(
      `WITH due AS (
         SELECT id FROM orders
         WHERE payment_status = 'created'
           AND inventory_released = false
           AND created_at < $1
           AND deleted_at IS NULL
         ORDER BY created_at
         LIMIT 200
         FOR UPDATE SKIP LOCKED
       )
       UPDATE orders AS o
       SET inventory_released = true,
           status = 'abandoned',
           updated_at = NOW()
       FROM due
       WHERE o.id = due.id
         AND o.payment_status = 'created'
         AND o.inventory_released = false
         AND o.deleted_at IS NULL
       RETURNING o.id, o.customer_email, o.customer_name, o.created_at`,
      { bind: [cutoff], transaction: tx, type: QueryTypes.SELECT },
    );
    if (!claimed.length) return;

    // Add the quantities from those orders back onto sizes and products.
    const ids = claimed.map((row) => row.id);
    const lines = await this.sequelize.query(
      `SELECT product_id, product_size, SUM(quantity)::int AS quantity
       FROM order_items
       WHERE order_id IN (${ids.map((_, index) => `$${index + 1}`).join(",")}) AND deleted_at IS NULL
       GROUP BY product_id, product_size`,
      { bind: ids, transaction: tx, type: QueryTypes.SELECT },
    );
    const sizeIds = [];
    const sizeQty = [];
    const productIds = [];
    const productQty = [];
    for (const line of lines) {
      if (Number(line.quantity) < 1) continue;
      if (line.product_size != null) {
        sizeIds.push(line.product_size);
        sizeQty.push(Number(line.quantity));
      } else {
        productIds.push(line.product_id);
        productQty.push(Number(line.quantity));
      }
    }
    const fromSizes = await applyStockDelta(this.sequelize, true, sizeIds, sizeQty, tx);
    const fromProducts = await applyStockDelta(this.sequelize, false, productIds, productQty, tx);
    restocks = fromSizes.concat(fromProducts);
  });
  if (!claimed.length) return 0;

  // One reminder email per customer, capped, for recent checkouts only.
  const nudges = selectAbandonedNudges(
    claimed.map((row) => ({
      id: row.id,
      customerEmail: row.customer_email,
      customerName: row.customer_name,
      createdAt: row.created_at,
    })),
    new Date(),
    maxAbandonedEmailsPerSweep,
  );
  await this.sendAbandonedCartEmails(nudges);

  // Tell the shop about the same abandoned checkouts. A failed alert does not put the stock back on hold.
  const claimedView = claimed.map((row) => ({
    id: row.id,
    customerEmail: row.customer_email,
    customerName: row.customer_name,
    createdAt: row.created_at,
  }));
  try {
    await this.notifyAbandonedCheckouts(claimedView);
  } catch (err) {
    console.log(`[INVENTORY] abandoned notify: ${err.message}`);
  }
  console.log(`[INVENTORY] released stock for ${claimed.length} abandoned order(s), emailed ${nudges.length}`);

  // Email people who asked to hear when a plant that just returned is buyable again.
  await this.notifyBackInStock(restocks);
  return claimed.length;
}

// Email the abandoned-cart reminder for each chosen checkout.
// Loads the plants first. The emails go out in the background so the sweep can finish.
export async function sendAbandonedCartEmails(nudges) {
  if (!nudges?.length) return;
  const ids = nudges.map((nudge) => nudge.id);
  let items;
  try {
    items = await OrderItem.findAll({ where: { orderId: { [Op.in]: ids } } });
  } catch (err) {
    console.log(`[INVENTORY] load abandoned items: ${err.message}`);
    return;
  }
  const byOrder = new Map();
  for (const item of items) {
    const key = Number(item.orderId);
    if (!byOrder.has(key)) byOrder.set(key, []);
    byOrder.get(key).push(item);
  }
  const orders = [];
  for (const nudge of nudges) {
    const lines = byOrder.get(Number(nudge.id)) || [];
    if (!lines.length) continue;
    orders.push({
      id: nudge.id,
      customerEmail: nudge.customerEmail,
      customerName: nudge.customerName,
      items: lines,
    });
  }
  if (!orders.length) return;
  setImmediate(() => {
    (async () => {
      for (const order of orders) {
        try {
          await this.deliverAbandonedCartEmail(order);
        } catch (err) {
          console.log(`[EMAIL] abandoned cart for order ${order.id}: ${err.message}`);
        }
      }
    })();
  });
}

// Start the timer that releases abandoned checkout stock.
// Called when the server boots. everyMs defaults to 5 minutes.
// Stops when the process abort signal fires.
export async function startInventorySweeper(signal, everyMs) {
  let every = everyMs;
  if (!every || every <= 0) every = 5 * 60 * 1000;
  const timer = setInterval(() => {
    if (signal?.aborted) {
      clearInterval(timer);
      return;
    }
    this.sweepAbandonedOrders().catch((err) => console.log(`[INVENTORY] sweep: ${err.message || err}`));
  }, every);
  signal?.addEventListener?.("abort", () => clearInterval(timer), { once: true });
}

// Save an email address that wants to know when a plant is buyable again.
// POST /api/v1/products/:slug/back-in-stock. The same email and product are not saved twice
// while a request is still waiting (notifiedAt is null).
export async function createBackInStockRequest(req, res) {
  const body = decode(req, res);
  if (!body) return;
  if (!body.productId) {
    error(res, 400, "productId is required");
    return;
  }
  if (!validateEmail(body.email)) {
    error(res, 400, "invalid email format");
    return;
  }
  const product = await Product.findByPk(body.productId, { attributes: ["id"] });
  if (!product) {
    error(res, 404, "product not found");
    return;
  }
  try {
    await BackInStockRequest.findOrCreate({
      where: { productId: body.productId, email: body.email, notifiedAt: null },
      defaults: {
        productSizeId: body.productSizeId ?? null,
        userId: req.user?.userId ?? null,
      },
    });
  } catch (err) {
    console.log(`[INVENTORY] back-in-stock signup: ${err.message}`);
    error(res, 500, "failed to save request");
    return;
  }
  json(res, 200, { success: true, message: "We'll email you when this is back in stock." });
}

// Email people who asked to hear about plants that just became available.
// Called after the abandoned sweep returns stock, and after an admin raises stock from zero.
// A size restock also matches requests that did not name a size. A product restock
// only matches requests that did not name a size.
export async function notifyBackInStock(targets) {
  if (!targets?.length) return;

  // One notice target per size or product, even if several orders returned the same plant.
  const seen = new Map();
  for (const target of targets) {
    const key = target.sizeId != null ? `s:${target.sizeId}` : `p:${target.productId}`;
    seen.set(key, target);
  }
  const or = [];
  for (const target of seen.values()) {
    if (target.sizeId != null) {
      or.push({
        productId: target.productId,
        [Op.or]: [{ productSizeId: null }, { productSizeId: target.sizeId }],
      });
    } else {
      or.push({ productId: target.productId, productSizeId: null });
    }
  }

  // Only waiting requests, and only a page of them, so one restock cannot send forever.
  let pending;
  try {
    pending = await BackInStockRequest.findAll({
      where: { notifiedAt: null, [Op.or]: or },
      limit: 100,
    });
  } catch (err) {
    console.log(`[INVENTORY] load back-in-stock queue: ${err.message}`);
    return;
  }
  for (const entry of pending) {
    // Skip this person if the plant is tracked and still has nothing to sell.
    let lines;
    try {
      lines = await this.loadStockLines([
        { productId: entry.productId, productSizeId: entry.productSizeId, quantity: 1 },
      ]);
    } catch {
      continue;
    }
    if (!lines.length) continue;
    const line = lines[0];
    if (line.tracked && line.available < 1) continue;

    const product = await Product.findByPk(entry.productId, { attributes: ["id", "name", "slug"] });
    if (!product) continue;

    // Email first. If the email fails, leave the request waiting so a later restock can retry.
    try {
      await this.sendBackInStockEmail(entry.email, product.name, product.slug);
    } catch (err) {
      console.log(`[EMAIL] back-in-stock: ${err.message}`);
      continue;
    }
    try {
      await BackInStockRequest.update({ notifiedAt: new Date() }, { where: { id: entry.id }, silent: true });
    } catch (err) {
      console.log(`[INVENTORY] mark notified: ${err.message}`);
    }

    // Signed-in customers also get an in-app notice. A failed notice does not unsend the email.
    if (entry.userId) {
      try {
        await this.pushNotice(
          entry.userId,
          "offer",
          `${product.name} is back in stock`,
          "The size you asked about is available again.",
          "/product/" + product.slug,
          "restock:" + entry.id,
          null,
          product.id,
          null,
        );
      } catch (err) {
        console.log(`[NOTIFY] restock: ${err.message}`);
      }
    }
  }
}

// Email one person that a plant they asked about can be bought again.
// Called from notifyBackInStock after we confirm stock is actually available.
export async function sendBackInStockEmail(to, productName, productSlug) {
  const link = `https://growman.live/product/${productSlug}`;
  const text = `Good news — ${productName} is back in stock.\n\nShop it here: ${link}\n\nStock is limited and we email everyone on the list at once, so it may not last long.\n\n— Growman`;
  const inner = `<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111827;">Back in stock</h1>
<p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;"><strong style="color:#111827;">${escapeHtml(productName)}</strong> is available again.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#059669;">
<a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Shop now</a>
</td></tr></table>
<p style="margin:20px 0 0;font-size:13px;color:#6b7280;line-height:1.5;">We notify everyone on the waiting list at the same time, so stock may go quickly.</p>`;
  await this.sendTransactionalEmail(to, `${productName} is back in stock`, text, renderEmail(`${productName} is back in stock`, inner));
}

// Set a product or size stock count, or add a delta to it.
// An admin calls POST /api/v1/inventory/adjust. Exactly one of stock or delta is required.
// Crossing from zero to a positive count emails the back-in-stock list.
export async function adjustStock(req, res) {
  const body = decode(req, res);
  if (!body) return;
  if (!body.productId) {
    error(res, 400, "productId is required");
    return;
  }

  // The admin must send a new absolute count or a change, not both and not neither.
  const hasStock = body.stock != null;
  const hasDelta = body.delta != null;
  if (hasStock === hasDelta) {
    error(res, 400, "provide exactly one of stock or delta");
    return;
  }

  // A size id updates that size. Otherwise we update the product itself.
  let table = "products";
  let id = body.productId;
  if (body.productSizeId != null) {
    table = "product_sizes";
    id = body.productSizeId;
  }
  if (table !== "products" && table !== "product_sizes") {
    error(res, 400, "productId is required");
    return;
  }

  // An absolute stock cannot be negative. A delta is clamped so stock never goes below zero.
  let assignment;
  let arg;
  if (hasStock) {
    if (body.stock < 0) {
      error(res, 400, "stock cannot be negative");
      return;
    }
    assignment = "$1";
    arg = body.stock;
  } else {
    assignment = "GREATEST(s.stock + $1, 0)";
    arg = body.delta;
  }

  // Write the new count and return the old and new values so we can see a restock.
  let changed;
  try {
    changed = await this.sequelize.query(
      `UPDATE ${table} AS s
       SET stock = ${assignment}, updated_at = NOW()
       FROM (SELECT id, stock FROM ${table} WHERE id = $2) AS prev
       WHERE s.id = prev.id
       RETURNING prev.stock AS prev_stock, s.stock AS new_stock`,
      { bind: [arg, id], type: QueryTypes.SELECT },
    );
  } catch (err) {
    console.log(`[INVENTORY] adjust stock: ${err.message}`);
    error(res, 500, "failed to adjust stock");
    return;
  }

  // Leave an audit line, then drop cached catalog pages so the shop shows the new count.
  const actor = req.user?.userId || 0;
  console.log(`[INVENTORY] stock adjusted on ${table}#${id} by user ${actor} (reason: ${body.reason || ""})`);
  try {
    await this.invalidateCatalog();
  } catch (err) {
    console.log(`[INVENTORY] invalidate: ${err.message}`);
  }

  // Email the waiting list only when this change brought the plant back from empty.
  if (changed.length === 1 && Number(changed[0].prev_stock) <= 0 && Number(changed[0].new_stock) > 0) {
    await this.notifyBackInStock([{ productId: body.productId, sizeId: body.productSizeId ?? null }]);
  }
  json(res, 200, { success: true });
}

// List plants and sizes whose stock is at or below the low-stock threshold.
// An admin calls GET /api/v1/inventory/low-stock. Products that have sizes are
// listed per size, not as the parent product. Capped at 200 rows, lowest stock first.
export async function listLowStock(req, res) {
  let rows;
  try {
    rows = await this.sequelize.query(
      `SELECT p.id AS product_id, NULL::bigint AS size_id, p.name, p.slug, p.stock,
              p.low_stock_threshold AS threshold
       FROM products p
       WHERE p.deleted_at IS NULL AND p.track_inventory = true
         AND p.stock <= p.low_stock_threshold
         AND NOT EXISTS (SELECT 1 FROM product_sizes s WHERE s.product_id = p.id AND s.deleted_at IS NULL)
       UNION ALL
       SELECT p.id AS product_id, s.id AS size_id,
              p.name || ' (' || s.label || ')' AS name, p.slug, s.stock,
              p.low_stock_threshold AS threshold
       FROM product_sizes s
       JOIN products p ON p.id = s.product_id
       WHERE s.deleted_at IS NULL AND p.deleted_at IS NULL AND p.track_inventory = true
         AND s.stock <= p.low_stock_threshold
       ORDER BY stock ASC
       LIMIT 200`,
      { type: QueryTypes.SELECT },
    );
  } catch (err) {
    console.log(`[INVENTORY] low stock: ${err.message}`);
    error(res, 500, "failed to load low stock");
    return;
  }
  const items = rows.map((row) => {
    const item = {
      productId: Number(row.product_id),
      name: row.name,
      slug: row.slug,
      stock: Number(row.stock),
      threshold: Number(row.threshold),
    };
    if (row.size_id != null) item.productSizeId = Number(row.size_id);
    return item;
  });
  json(res, 200, { items, count: items.length });
}
