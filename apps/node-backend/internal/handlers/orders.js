/*
This file is how customers and admins read and update orders after checkout.

A signed-in customer can list their own orders, buy the same plants again,
rate a delivery that has arrived, and start a new payment when the last one
failed. An admin can list every order, change the status, and set the
expected delivery date. Status changes also send the customer a short notice.

List results are cached for a couple of minutes. Changing an order clears
that cache so the next list is fresh.
*/

import { Op, fn, col, where as sqlWhere } from "sequelize";
import { json, error, decode } from "../../pkg/httpjson/httpjson.js";
import { requireUser, isAdminRole } from "../auth/jwt.js";
import { parsePagination, buildPaginationMeta } from "../../pkg/pagination/pagination.js";
import { Order, OrderItem, User } from "../models/index.js";

// Status values an admin is allowed to write onto an order.
const allowedOrderStatuses = new Set([
  "pending", "confirmed", "shipped", "out_for_delivery", "delivered", "cancelled", "failed", "paid",
]);

// Shorten a note to a maximum number of characters, counting letters rather than bytes.
// Used for delivery feedback so a long comment cannot blow past the column.
function clipText(value, max) {
  const text = String(value ?? "").trim();
  const characters = [...text];
  if (characters.length <= max) return text;
  return characters.slice(0, max).join("").trim();
}

// Turn a URL id such as "42" into a number.
// A missing id, a word, or a number too big to store safely comes back as null.
function parseId(raw) {
  if (!/^\d+$/.test(String(raw ?? ""))) return null;
  const parsedId = Number(raw);
  if (!Number.isSafeInteger(parsedId)) return null;
  return parsedId;
}

// Build the database filter for the order list.
// status "all" keeps every status. "settled" keeps orders that are not still waiting
// or failed, and not abandoned. A comma-separated status matches either the order
// status or the payment status. orderId and search narrow the list further.
function orderFilters(statusFilter, orderIdFilter, searchFilter) {
  const where = {};
  const and = [];
  if (!statusFilter || statusFilter === "all") {
    // No status constraint. Every order in the caller's scope is included.
  } else if (statusFilter === "settled") {
    // Paid or otherwise finished payments, skipping abandoned checkouts.
    and.push(sqlWhere(fn("LOWER", col("payment_status")), { [Op.notIn]: ["created", "failed"] }));
    and.push(sqlWhere(fn("LOWER", col("status")), { [Op.ne]: "abandoned" }));
  } else {
    const wanted = statusFilter.split(",").map((part) => part.trim()).filter(Boolean);
    if (wanted.length) {
      and.push({
        [Op.or]: [
          sqlWhere(fn("LOWER", col("status")), { [Op.in]: wanted }),
          sqlWhere(fn("LOWER", col("payment_status")), { [Op.in]: wanted }),
        ],
      });
    }
  }
  if (orderIdFilter && /^\d+$/.test(orderIdFilter)) and.push({ id: Number(orderIdFilter) });
  if (searchFilter) {
    // Search matches the customer's name, phone, or email. The match is case-insensitive.
    const like = `%${searchFilter.toLowerCase()}%`;
    and.push({
      [Op.or]: [
        sqlWhere(fn("LOWER", col("customer_name")), { [Op.like]: like }),
        sqlWhere(fn("LOWER", col("customer_phone")), { [Op.like]: like }),
        sqlWhere(fn("LOWER", col("customer_email")), { [Op.like]: like }),
      ],
    });
  }
  if (and.length) where[Op.and] = and;
  return where;
}

// Turn one order into the JSON the app shows, with image addresses filled in.
function presentOrder(order, handler) {
  const body = order.toJSON();
  body.items = handler.resolveOrderItemImageURLsSlice(order.items || body.items || []);
  return body;
}

// List orders for the signed-in customer, or every order when the caller is an admin.
// GET /api/v1/orders. Admins can pass ?scope=self to see only their own orders.
export async function listOrders(req, res) {
  // The caller must be signed in.
  const claims = requireUser(req, res);
  if (!claims) return;

  const page = parsePagination(req);
  const statusFilter = String(req.query?.status ?? "").trim().toLowerCase();
  const orderIdFilter = String(req.query?.orderId ?? "").trim();
  const searchFilter = String(req.query?.search ?? "").trim();
  const scopeFilter = String(req.query?.scope ?? "").trim().toLowerCase();

  // An admin sees every order unless they asked for their own. A customer only sees their orders.
  const isAdmin = isAdminRole(claims.role) && scopeFilter !== "self";
  const cacheScope = isAdmin ? "admin:all" : "user:" + claims.userId;
  const cacheKey = `orders:${cacheScope}:page:${page.page}:size:${page.pageSize}:status:${statusFilter}:orderId:${orderIdFilter}:search:${searchFilter.toLowerCase()}`;
  const totalCacheKey = `orders:${cacheScope}:total:status:${statusFilter}:orderId:${orderIdFilter}:search:${searchFilter.toLowerCase()}`;

  // Serve the last list when both the page and the total are still cached.
  const cachedOrders = this.cache ? await this.cache.get(cacheKey) : null;
  const cachedTotal = this.cache ? await this.cache.get(totalCacheKey) : null;
  if (cachedOrders && cachedTotal != null) {
    json(res, 200, {
      data: cachedOrders,
      pagination: buildPaginationMeta(page.page, page.pageSize, cachedTotal),
    });
    return;
  }

  // Customers are limited to their own user id. Admins are not.
  const where = orderFilters(statusFilter, orderIdFilter, searchFilter);
  if (!isAdmin) where.userId = claims.userId;

  // Newest orders first, one page at a time, with the plants and the customer account.
  let total;
  let orders;
  try {
    total = await Order.count({ where });
    orders = await Order.findAll({
      where,
      include: [
        { model: OrderItem, as: "items" },
        { model: User, as: "user" },
      ],
      order: [["createdAt", "DESC"]],
      offset: page.offset,
      limit: page.pageSize,
    });
  } catch (err) {
    console.log(`[DB] fetch orders: ${err.message}`);
    error(res, 500, "failed to fetch orders");
    return;
  }

  // Cache the page for 2 minutes and the total for 5 minutes so the next scroll is cheap.
  const data = orders.map((order) => presentOrder(order, this));
  if (this.cache) {
    await this.cache.set(cacheKey, data, 2 * 60 * 1000);
    await this.cache.set(totalCacheKey, total, 5 * 60 * 1000);
  }
  json(res, 200, { data, pagination: buildPaginationMeta(page.page, page.pageSize, total) });
}

// Change an order's status. Only an admin may do this.
// PATCH /api/v1/orders/:id/status. The customer is notified after the save.
export async function updateOrderStatus(req, res) {
  // The caller must be signed in, and must be an admin.
  const claims = requireUser(req, res);
  if (!claims) return;
  if (!isAdminRole(claims.role)) {
    error(res, 403, "admin access required");
    return;
  }

  // The order id is in the URL. Stop if it is not a plain number.
  const orderId = parseId(req.params.id);
  if (orderId == null) {
    error(res, 400, "invalid order id");
    return;
  }

  // Read the JSON body. Stop if it is missing or not an object.
  const body = decode(req, res);
  if (!body) return;

  // Stop if the status is not one the shop uses.
  const status = String(body.status ?? "").trim().toLowerCase();
  if (!allowedOrderStatuses.has(status)) {
    error(res, 400, "unsupported order status");
    return;
  }

  const order = await Order.findByPk(orderId);
  if (!order) {
    error(res, 404, "order not found");
    return;
  }

  // Delivered and paid also mark the payment as paid.
  // Failed and cancelled copy that word onto the payment status too.
  const updates = { status };
  if (status === "delivered" || status === "paid") updates.paymentStatus = "paid";
  else if (status === "failed" || status === "cancelled") updates.paymentStatus = status;
  try {
    await order.update(updates);
  } catch {
    error(res, 500, "failed to update order status");
    return;
  }

  // Reload so the response includes plants, the customer, and image addresses.
  // The reload also clears the order list cache.
  const fresh = await this.reloadOrderForResponse(res, orderId);
  if (!fresh) return;
  await this.notifyStatus(fresh);
  json(res, 200, fresh);
}

// Send the customer the notice that matches the order's current status.
// Called after an admin changes the status, and after a customer cancels.
// Store pickup gets its own wording when the order is packed.
export async function notifyStatus(order) {
  const status = order.status;
  try {
    if (status === "confirmed" || status === "processing") {
      if (order.fulfillmentChannel === "store_pickup") {
        await this.notifyOrderEvent(order, "Ready for store pickup", "Your order can be collected from the nursery.", "pickup");
        return;
      }
      await this.notifyOrderEvent(order, "Order packed", "Your plants are packed and waiting to leave.", "packed");
    } else if (status === "shipped") {
      await this.notifyOrderEvent(order, "Order shipped", "Your order is on the way.", "shipped");
    } else if (status === "out_for_delivery") {
      await this.notifyOrderEvent(order, "Out for delivery", "Your order is out for delivery today.", "ofd");
    } else if (status === "delivered") {
      await this.notifyOrderEvent(order, "Order delivered", "Your plants have arrived. Tell us how the delivery went.", "delivered");
    } else if (status === "failed") {
      await this.notifyOrderEvent(order, "Payment failed", "The payment did not go through. You can try again from Orders.", "failed");
    } else if (status === "cancelled") {
      await this.notifyOrderEvent(order, "Order cancelled", "This order has been cancelled.", "cancelled");
    }
  } catch (err) {
    console.log(`[NOTIFY] status: ${err.message}`);
  }
}

// Format a date the way the delivery notice reads it, for example "26 Oct 2026".
function formatGoDate(value) {
  const date = new Date(value);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

// Format a date as YYYY-MM-DD for the notice id, so the same date is not announced twice.
function formatISODate(value) {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${dayOfMonth}`;
}

// Set or clear the date the shop expects to deliver an order.
// An admin calls PATCH /api/v1/orders/:id/expected-delivery.
// A blank date clears it. A real date tells the customer.
export async function updateOrderExpectedDeliveryDate(req, res) {
  // The caller must be signed in, and must be an admin.
  const claims = requireUser(req, res);
  if (!claims) return;
  if (!isAdminRole(claims.role)) {
    error(res, 403, "admin access required");
    return;
  }

  const orderId = parseId(req.params.id);
  if (orderId == null) {
    error(res, 400, "invalid order id");
    return;
  }

  const body = decode(req, res);
  if (!body) return;

  const order = await Order.findByPk(orderId);
  if (!order) {
    error(res, 404, "order not found");
    return;
  }

  // An empty date clears the expectation. A non-empty date must be YYYY-MM-DD.
  const dateString = String(body.expectedDeliveryDate ?? "").trim();
  let expected = null;
  if (dateString) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      error(res, 400, "expectedDeliveryDate must be YYYY-MM-DD");
      return;
    }
    expected = new Date(dateString + "T00:00:00Z");
    if (Number.isNaN(expected.getTime())) {
      error(res, 400, "expectedDeliveryDate must be YYYY-MM-DD");
      return;
    }
  }
  try {
    await order.update({ expectedDeliveryDate: expected });
  } catch {
    error(res, 500, "failed to update expected delivery date");
    return;
  }

  const fresh = await this.reloadOrderForResponse(res, orderId);
  if (!fresh) return;

  // Tell the customer only when a date was set. Clearing the date stays quiet.
  if (fresh.expectedDeliveryDate) {
    try {
      await this.notifyOrderEvent(
        fresh,
        "Delivery date updated",
        "The new expected date is " + formatGoDate(fresh.expectedDeliveryDate) + ".",
        "date:" + formatISODate(fresh.expectedDeliveryDate),
      );
    } catch (err) {
      console.log(`[NOTIFY] delivery date: ${err.message}`);
    }
  }
  json(res, 200, fresh);
}

// Forget cached order lists, then load one order the way the list endpoint would.
// Called after a status or delivery-date change. Writes the error itself when the reload fails.
export async function reloadOrderForResponse(res, orderId) {
  try {
    if (this.cache) await this.cache.deletePattern("orders:*");
  } catch {
    /* cache miss is fine */
  }
  const order = await Order.findOne({
    where: { id: orderId },
    include: [
      { model: OrderItem, as: "items" },
      { model: User, as: "user" },
    ],
  });
  if (!order) {
    error(res, 500, "failed to fetch updated order");
    return null;
  }
  return presentOrder(order, this);
}

// Load one order that belongs to this customer, including its plants.
// Shared by reorder, delivery rating, and payment retry.
// Writes the error response and returns null when the id is bad or the order is not theirs.
export async function ownOrder(req, res, userId) {
  const id = parseId(req.params.id);
  if (id == null) {
    error(res, 400, "invalid order id");
    return null;
  }
  let order;
  try {
    order = await Order.findOne({
      where: { id, userId },
      include: [{ model: OrderItem, as: "items" }],
    });
  } catch {
    error(res, 500, "failed to load order");
    return null;
  }
  if (!order) {
    error(res, 404, "order not found");
    return null;
  }
  return order;
}

// Hand the plants from one of the customer's orders back as a new cart.
// POST /api/v1/orders/:id/reorder. Prices are the prices stored on that order.
export async function reorder(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;

  // Stop if this order is not the customer's.
  const order = await this.ownOrder(req, res, claims.userId);
  if (!order) return;

  const lines = (order.items || []).map((item) => {
    const body = this.resolveOrderItemImageURL(item);
    const line = {
      productId: Number(item.productId),
      quantity: item.quantity,
      name: item.name,
      price: item.price,
    };
    if (item.productSizeId != null) line.productSizeId = Number(item.productSizeId);
    if (body.imageUrl) line.imageUrl = body.imageUrl;
    return line;
  });
  json(res, 200, { items: lines });
}

// Save a 1-to-5 rating for a delivery that has arrived.
// POST /api/v1/orders/:id/rating. The customer can only rate their own order.
export async function rateDelivery(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;

  const order = await this.ownOrder(req, res, claims.userId);
  if (!order) return;

  // A rating is only allowed after the order is marked delivered, or a delivery time was stored.
  if (order.status !== "delivered" && !order.deliveredAt) {
    error(res, 409, "You can rate a delivery after it arrives.");
    return;
  }

  // The rating must be a number from 1 to 5. Feedback is optional and clipped.
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body) || !(body.rating >= 1 && body.rating <= 5)) {
    error(res, 400, "Choose a rating from 1 to 5.");
    return;
  }
  try {
    await order.update({ deliveryRating: body.rating, deliveryFeedback: clipText(body.feedback, 500) });
  } catch {
    error(res, 500, "Could not save the rating.");
    return;
  }
  json(res, 200, { success: true });
}

// Start a fresh Razorpay payment for an order whose last payment failed.
// POST /api/v1/orders/:id/retry-payment. Also reserves the plants again.
export async function retryPayment(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;

  const order = await this.ownOrder(req, res, claims.userId);
  if (!order) return;

  // Only a failed payment can be tried again. Paid and pending orders stop here.
  if (order.paymentStatus !== "failed") {
    error(res, 409, "This order does not need a new payment attempt.");
    return;
  }

  // Ask Razorpay for a new order in paise, using the amount already stored on our order.
  let razorpayOrder;
  try {
    razorpayOrder = await this.createRazorpayOrder(Math.trunc(Number(order.amount) * 100 + 0.5), order.currency);
  } catch {
    error(res, 500, "Could not start a new payment.");
    return;
  }

  // Point the order at the new Razorpay id and hold the plants again.
  // If the plants are gone, tell the customer instead of leaving a payable order with no stock.
  try {
    await this.sequelize.transaction(async (tx) => {
      await Order.update(
        { razorpayOrderId: razorpayOrder.id, paymentStatus: "created", status: "pending" },
        { where: { id: order.id }, transaction: tx },
      );
      await this.reserveOrderInventory(tx, order.items);
    });
  } catch (err) {
    console.log(`[PAYMENT] retry order ${order.id}: ${err.message}`);
    error(res, 409, "Those plants are no longer available to reserve.");
    return;
  }
  json(res, 200, {
    id: razorpayOrder.id,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency,
    orderId: Number(order.id),
  });
}
