// This file handles order-help tickets for customers and for staff.
// When a customer tells Dootha about a delay, refund, or delivery problem,
// a support ticket is saved. Staff can list those tickets and mark them resolved.

import { Op } from "sequelize";
import { decode, error, json } from "../../pkg/httpjson/httpjson.js";
import { isAdminRole, requireUser } from "../auth/jwt.js";
import { emailOrEmpty, Order, OrderSupportRequest, phoneOrEmpty, User } from "../models/index.js";

// Reads one query-string value. Repeated keys use the first value.
function qget(req, name) {
  const v = req.query?.[name];
  if (Array.isArray(v)) return v[0] == null ? "" : String(v[0]);
  return v == null ? "" : String(v);
}

// Staff list of order-support tickets, optionally filtered by status.
export async function listOrderSupportRequests(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  if (!isAdminRole(claims.role)) {
    error(res, 403, "admin access required");
    return;
  }
  const status = qget(req, "status").trim().toLowerCase();
  const where = status ? { status } : undefined;
  try {
    const rows = await OrderSupportRequest.findAll({ where, order: [["createdAt", "DESC"]], limit: 200 });
    json(res, 200, rows);
  } catch {
    error(res, 500, "failed to fetch order support requests");
  }
}

// Staff update of a ticket status, with optional notes for the team.
export async function updateOrderSupportStatus(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  if (!isAdminRole(claims.role)) {
    error(res, 403, "admin access required");
    return;
  }
  const raw = String(req.params?.id ?? "");
  if (!/^\d+$/.test(raw) || raw === "0") {
    error(res, 400, "invalid id");
    return;
  }
  const body = decode(req, res);
  if (!body) return;
  const status = String(body.status || "").trim().toLowerCase();
  if (!["pending", "in_progress", "resolved"].includes(status)) {
    error(res, 400, "unsupported status");
    return;
  }
  const record = await OrderSupportRequest.findByPk(raw);
  if (!record) {
    error(res, 404, "request not found");
    return;
  }
  const updates = { status };
  const notes = String(body.adminNotes || "").trim();
  if (notes) updates.adminNotes = notes;
  try {
    await record.update(updates);
  } catch {
    error(res, 500, "failed to update request");
    return;
  }
  const fresh = await OrderSupportRequest.findByPk(raw);
  if (!fresh) {
    error(res, 500, "failed to fetch updated request");
    return;
  }
  json(res, 200, fresh);
}

// Chat intent: true when the customer is asking for a person to help with an order.
export function detectOrderSupportIntent(msg) {
  const lower = String(msg || "").trim().toLowerCase();
  // Phrases that always mean "pass this to the support team".
  for (const term of [
    "delivery support", "support for order", "escalate", "escalation",
    "order delay", "delayed delivery", "late delivery", "not delivered",
    "need support", "help with order", "order problem", "order issue",
    "customer support", "contact support", "support team", "support contact",
  ]) {
    if (lower.includes(term)) return true;
  }
  // A message that names an order number plus a help word is also a support request.
  if (this.extractOrderIDFromMessage(msg) != null) {
    for (const term of ["support", "help", "delay", "delivery", "escalat", "refund", "track"]) {
      if (lower.includes(term)) return true;
    }
  }
  if (lower.includes("refund") && lower.includes("order")) return true;
  return false;
}

// Picks the ticket type from the words in the customer's message.
function classifyOrderIssueType(msg) {
  const lower = String(msg || "").toLowerCase();
  if (lower.includes("refund")) return "refund";
  if (lower.includes("track")) return "tracking";
  if (lower.includes("delay") || lower.includes("late") || lower.includes("not delivered")) return "delivery_delay";
  return "order_support";
}

// A calendar date in UTC, written as "26 Oct 2026" for the ticket reply.
function utcDayMonYear(date) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = new Date(date);
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// Chat intent handler: opens a support ticket, or reuses one already pending for that order.
export async function handleOrderSupportChat(userMessage, claims, loggedIn) {
  const orderID = this.extractOrderIDFromMessage(userMessage);
  let user = null;
  let order = null;
  // A signed-in customer is matched to their own order when they named a number.
  if (loggedIn && claims) {
    user = await User.findByPk(claims.userId, { attributes: ["id", "name", "email", "phone"] });
    if (orderID != null) {
      const scope = await this.userOrdersQuery(claims.userId);
      order = await Order.findOne({
        where: { [Op.and]: [scope, { id: orderID }] },
        include: [{ association: "items" }],
      });
    }
  } else if (orderID != null) {
    // A guest who names an order number still gets that order attached if it exists.
    order = await Order.findOne({ where: { id: orderID }, include: [{ association: "items" }] });
  }
  // Do not open a second pending ticket for the same customer and order.
  if (loggedIn && claims && orderID != null) {
    const existing = await OrderSupportRequest.findOne({
      where: { orderId: orderID, userId: claims.userId, status: "pending" },
      order: [["createdAt", "DESC"]],
    });
    if (existing?.id) return this.orderSupportChatResult(existing, order, true);
  }
  const record = OrderSupportRequest.build({
    issueType: classifyOrderIssueType(userMessage),
    priority: "high",
    userMessage: String(userMessage || "").trim(),
    status: "pending",
    source: "chatbot",
  });
  if (orderID != null) record.orderId = orderID;
  if (loggedIn && claims) {
    record.userId = claims.userId;
    record.customerName = user?.name || "";
    record.customerEmail = emailOrEmpty(user);
    record.customerPhone = phoneOrEmpty(user);
  }
  // Copy the order snapshot onto the ticket so staff can see it without opening the order.
  if (order) {
    record.orderStatus = order.status;
    record.paymentStatus = order.paymentStatus;
    record.orderAmount = order.amount;
    record.orderItems = this.formatOrderItems(order.items || []);
    if (order.expectedDeliveryDate) record.expectedDelivery = utcDayMonYear(order.expectedDeliveryDate);
    if (!record.customerEmail) record.customerEmail = order.customerEmail;
    if (!record.customerPhone) record.customerPhone = order.customerPhone;
    if (!record.customerName) record.customerName = order.customerName;
  }
  try {
    await record.save();
  } catch {
    return {
      ok: true,
      text: "Our support team is at **growman.live@gmail.com**. We couldn't save your ticket automatically — please email us with your order number.",
    };
  }
  return this.orderSupportChatResult(record, order, false);
}

// The chat reply: order status, the ticket number, and how to email the team.
export async function orderSupportChatResult(record, order, existing) {
  let text = "";
  if (record.orderId != null) {
    if (order || record.orderStatus || record.orderItems) {
      text += `**Order #${record.orderId} status**\n`;
      let statusLabel = this.displayOrderStatus({ status: record.orderStatus, paymentStatus: record.paymentStatus });
      if (!statusLabel) statusLabel = "Processing";
      text += `- **Status:** ${statusLabel}\n`;
      if (record.paymentStatus) text += `- **Payment:** ${this.humanOrderStatus(record.paymentStatus)}\n`;
      if (record.orderAmount > 0) text += `- **Amount:** ₹${Math.round(record.orderAmount)}\n`;
      if (record.orderItems) text += `- **Items:** ${record.orderItems}\n`;
      if (record.expectedDelivery) text += `- **Expected delivery:** ${record.expectedDelivery}\n`;
      text += "\n";
    } else {
      text += `**Order #${record.orderId}** — we will verify details with our support team.\n\n`;
    }
  }
  // An existing pending ticket is acknowledged instead of sounding like a new one.
  if (existing) {
    text += `Your request is **already raised with our support team** (ticket **#${record.id}**). They are looking into it.\n\n`;
  } else {
    text += `Your request has been **raised to our support team** (priority ticket **#${record.id}**). We will review the delay and get back to you within **24–48 hours**.\n\n`;
  }
  text += "**Thank you for your patience.**\n\n";
  text += "**Support contact:**\n";
  text += "- Email: **growman.live@gmail.com**\n";
  text += "- Website: https://growman.live/\n";
  text += `\nPlease mention ticket **#${record.id}** when you email us.`;
  const orders = order ? [await this.orderToChatCard(order)] : undefined;
  return { ok: true, text, orders };
}
