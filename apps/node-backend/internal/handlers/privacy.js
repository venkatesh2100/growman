// This file handles a customer's privacy choices.
// They can record cookie consent, download a copy of their data, or ask
// for their account to be erased. Order rows that the law says we must keep
// are scrubbed of personal details and deleted later by a daily sweep.

import { Op, literal } from "sequelize";
import { decode, error, json } from "../../pkg/httpjson/httpjson.js";
import { requireUser } from "../auth/jwt.js";
import { clientIP } from "../middlewares/ip.js";
import {
  Address, AppNotification, BackInStockRequest, CartSnapshot, ChatTurn, ConsentRecord,
  CreditEntry, NotificationPreference, Order, OrderSupportRequest, OwnedPlant, PlantHealthLog,
  QuoteRequest, RecentView, Review, SavedItem, SavedPaymentMethod, StoreCredit, User,
  WebhookEvent, Wishlist,
} from "../models/index.js";

// The name left on an account after the customer asks to be erased.
const erasedUserName = "Deleted user";
// The privacy-notice version stored with each consent choice.
const noticeVersion = "2026-01";
// How long minimised order records are kept after erasure: one year.
const transactionalRetentionMs = 365 * 24 * 60 * 60 * 1000;
const validConsentPurposes = new Set(["essential", "analytics", "marketing", "personalisation"]);

// Saves the consent choices a visitor just made, one row per purpose.
export async function recordConsent(req, res) {
  const body = decode(req, res);
  if (!body) return;
  const purposes = body.purposes;
  if (!purposes || typeof purposes !== "object" || Array.isArray(purposes) || Object.keys(purposes).length === 0) {
    error(res, 400, "at least one purpose is required");
    return;
  }
  const userId = req.user?.userId ?? null;
  const email = String(body.email || "").trim().toLowerCase();
  // A visitor who is not signed in and gave no email is still recorded, with a log line.
  if (userId == null && !email) console.log("[CONSENT] anonymous consent recorded without identity");
  let userAgent = req.get("User-Agent") || "";
  if (userAgent.length > 500) userAgent = userAgent.slice(0, 500);
  const ip = clientIP(req);
  const records = [];
  for (const [purpose, granted] of Object.entries(purposes)) {
    if (!validConsentPurposes.has(purpose)) {
      error(res, 400, `unknown consent purpose: ${purpose}`);
      return;
    }
    records.push({
      userId,
      email,
      purpose,
      granted: Boolean(granted),
      noticeVersion,
      ip,
      userAgent,
    });
  }
  try {
    await ConsentRecord.bulkCreate(records);
  } catch (err) {
    console.log(`[CONSENT] record: ${err.message || err}`);
    error(res, 500, "failed to record consent");
    return;
  }
  json(res, 200, { success: true, noticeVersion });
}

// Builds a download of the signed-in customer's personal data.
export async function exportMyData(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const user = await User.findByPk(claims.userId);
  if (!user) {
    error(res, 404, "account not found");
    return;
  }
  let orders = [];
  try {
    orders = await Order.findAll({
      where: { userId: claims.userId },
      include: [{ association: "items" }],
      order: [["createdAt", "DESC"]],
    });
  } catch (err) {
    // A failed order lookup still lets the rest of the export go out.
    console.log(`[PRIVACY] export orders: ${err.message || err}`);
  }
  const addresses = await Address.findAll({ where: { userId: claims.userId } });
  const reviews = await Review.findAll({ where: { userId: claims.userId } });
  const wishlist = await Wishlist.findAll({
    where: { userId: claims.userId },
    include: [{ association: "product", attributes: ["id", "name", "slug"] }],
  });
  // Consent may have been saved against the account or against the email before sign-in.
  const consentWhere = [{ userId: claims.userId }];
  if (user.email) consentWhere.push({ email: user.email });
  const consents = await ConsentRecord.findAll({
    where: { [Op.or]: consentWhere },
    order: [["createdAt", "DESC"]],
  });
  const supportRequests = await OrderSupportRequest.findAll({ where: { userId: claims.userId } });
  const ownedPlants = await OwnedPlant.findAll({ where: { userId: claims.userId } });
  const healthLogs = await PlantHealthLog.findAll({ where: { userId: claims.userId } });
  const notificationPrefs = await NotificationPreference.findAll({ where: { userId: claims.userId } });
  const savedItems = await SavedItem.findAll({ where: { userId: claims.userId } });
  const paymentMethods = await SavedPaymentMethod.findAll({ where: { userId: claims.userId } });
  const chatTurns = await ChatTurn.findAll({ where: { userId: claims.userId } });
  // The browser should save the reply as a file named growman-my-data.json.
  res.set("Content-Disposition", 'attachment; filename="growman-my-data.json"');
  json(res, 200, {
    exportedAt: new Date(),
    noticeVersion,
    account: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      createdAt: user.createdAt,
    },
    orders,
    addresses,
    reviews,
    wishlist,
    consentHistory: consents,
    supportRequests,
    plants: ownedPlants,
    plantHealth: healthLogs,
    notificationPreferences: notificationPrefs,
    savedItems,
    paymentMethods,
    chatHistory: chatTurns,
    retentionNotice: "Order records and processing logs are retained for at least one year from the date of the transaction, as required by Rule 8(3) of the DPDP Rules 2025, even after an account is deleted.",
  });
}

// Erases a customer's personal details after they ask to delete their account.
// Refuses while a paid order is still on the way, because delivery still needs those details.
export async function requestErasure(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const user = await User.findByPk(claims.userId);
  if (!user) {
    error(res, 404, "account not found");
    return;
  }
  // A paid order that has not been delivered or cancelled still needs the delivery details.
  let openOrders = 0;
  try {
    openOrders = await Order.count({
      where: {
        userId: claims.userId,
        paymentStatus: "paid",
        deliveredAt: { [Op.is]: null },
        cancelledAt: { [Op.is]: null },
      },
    });
  } catch {
    error(res, 500, "failed to check open orders");
    return;
  }
  if (openOrders > 0) {
    json(res, 409, {
      error: "open_orders",
      reason: "You have an order still in transit. We need your delivery details until it arrives — please request erasure once it's been delivered.",
    });
    return;
  }
  const erasedAt = new Date();
  try {
    await this.sequelize.transaction(async (tx) => {
      // Replace the name, email, phone, and password so the account can no longer be used.
      await User.update({
        name: erasedUserName,
        email: literal(`CONCAT('erased-', id, '@deleted.invalid')`),
        phone: literal(`CONCAT('erased-', id)`),
        passwordHash: "",
      }, { where: { id: user.id }, transaction: tx });
      // Delete the personal rows that are not needed for a legal order record.
      await Address.destroy({ where: { userId: user.id }, force: true, transaction: tx });
      await Review.update({ verifiedPurchase: false }, { where: { userId: user.id }, silent: true, transaction: tx });
      await Wishlist.destroy({ where: { userId: user.id }, force: true, transaction: tx });
      await BackInStockRequest.destroy({ where: { userId: user.id }, force: true, transaction: tx });
      await PlantHealthLog.destroy({ where: { userId: user.id }, force: true, transaction: tx });
      await AppNotification.destroy({ where: { userId: user.id }, force: true, transaction: tx });
      await OwnedPlant.destroy({ where: { userId: user.id }, force: true, transaction: tx });
      await NotificationPreference.destroy({ where: { userId: user.id }, force: true, transaction: tx });
      for (const Model of [SavedItem, StoreCredit, CreditEntry, SavedPaymentMethod, RecentView, CartSnapshot, ChatTurn, QuoteRequest]) {
        await Model.destroy({ where: { userId: user.id }, force: true, transaction: tx });
      }
      // Other customers who used this person's invite code are no longer linked to them.
      await User.update({ referredBy: null }, { where: { referredBy: user.id }, transaction: tx });
      // Keep the order rows, but wipe the customer name, contact, and device details.
      await Order.update({
        customerName: erasedUserName,
        customerEmail: "",
        customerPhone: "",
        clientIp: "",
        userAgent: "",
      }, { where: { userId: user.id }, transaction: tx });
      // Record that essential consent was withdrawn as part of the deletion.
      await ConsentRecord.create({
        userId: user.id,
        purpose: "essential",
        granted: false,
        noticeVersion,
        ip: clientIP(req),
      }, { transaction: tx });
    });
  } catch (err) {
    console.log(`[PRIVACY] erasure for user ${user.id}: ${err.message || err}`);
    error(res, 500, "failed to process erasure request");
    return;
  }
  console.log(`[PRIVACY] erasure completed for user ${user.id} at ${erasedAt.toISOString()}`);
  // Tell staff that a customer used their right to erasure.
  this.notifyMerchantAsync(
    "Data erasure request completed",
    "A customer exercised their DPDP right to erasure. Account identifiers have been scrubbed; order records are retained in minimised form for the statutory one-year period.",
  );
  json(res, 200, {
    success: true,
    message: "Your personal details have been erased. Order records are kept in minimised form for one year, as the law requires, and then deleted.",
  });
}

// Deletes minimised order records, webhook logs, and old back-in-stock notes older than one year.
export async function sweepExpiredData() {
  const cutoff = new Date(Date.now() - transactionalRetentionMs);
  // Only orders that were already scrubbed by an erasure request are removed here.
  const removed = await Order.destroy({
    where: { createdAt: { [Op.lt]: cutoff }, customerEmail: "", customerName: erasedUserName },
    force: true,
    paranoid: false,
  });
  if (removed > 0) console.log(`[PRIVACY] retention sweep removed ${removed} expired order record(s)`);
  await WebhookEvent.destroy({ where: { createdAt: { [Op.lt]: cutoff } }, force: true, paranoid: false });
  await BackInStockRequest.destroy({
    where: { [Op.and]: [{ notifiedAt: { [Op.not]: null } }, { notifiedAt: { [Op.lt]: cutoff } }] },
    force: true,
    paranoid: false,
  });
}

// Starts a once-a-day job that deletes data past the one-year retention window.
export function startRetentionSweeper(signal) {
  if (signal?.aborted) return;
  const timer = setInterval(() => {
    this.sweepExpiredData().catch((err) => console.log(`[PRIVACY] retention sweep: ${err.message || err}`));
  }, 24 * 60 * 60 * 1000);
  // Let the process exit even if this timer is still scheduled.
  if (typeof timer.unref === "function") timer.unref();
  // Stops the daily sweep when the server is shutting down.
  const stop = () => clearInterval(timer);
  signal?.addEventListener("abort", stop, { once: true });
}
