// Shop tables: accounts, catalog, orders, payments, care reminders, and the extra records around them.
// connect() calls initModels once. Handlers then use the exported models (User, Order, Product, and the rest).
// present() is what JSON responses go through. Password hashes, soft-delete times, and a few internal columns are removed.
// initModels returns the model map. strPtr, emailOrEmpty, and phoneOrEmpty are small helpers for nullable user fields.

import { DataTypes } from "sequelize";

// Columns that must never appear in an API response. They stay in the database.
const HIDDEN = new Set([
  "passwordHash",
  "deletedAt",
  "inventoryReleased",
  "reviewRequestedAt",
  "itemsJson",
  "pushToken",
  "dedupeKey",
  "payload",
  "restockedInventory",
]);

// Turns a model, a list, or a plain object into JSON-safe data. Handlers and toJSON call this.
// Dates become ISO strings. Hidden columns are dropped. Nested models are cleaned the same way.
// Returns the value unchanged when it is null or not an object.
export function present(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(present);
  if (value instanceof Date) return value.toISOString();
  const raw = typeof value?.get === "function" ? value.get({ plain: true }) : value;
  if (typeof raw !== "object") return raw;
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    // Skip secrets and internal bookkeeping. The column still exists on the row.
    if (HIDDEN.has(k)) continue;
    out[k] = present(v);
  }
  return out;
}

const id = { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true };
// A required foreign key. An optional one may be null, for a guest order or a product with no brand.
const reqId = { type: DataTypes.BIGINT, allowNull: false };
const optId = { type: DataTypes.BIGINT, allowNull: true };
const textArr = { type: DataTypes.ARRAY(DataTypes.TEXT), defaultValue: [] };

// Shared table options. Names are snake_case, deleted rows stay in the table, and every row has timestamps.
function table(name, extra = {}) {
  return { tableName: name, underscored: true, paranoid: true, timestamps: true, ...extra };
}

export let sequelize;
export let User;
export let Category;
export let Subcategory;
export let Brand;
export let Product;
export let ProductSize;
export let Attribute;
export let Review;
export let Order;
export let OrderItem;
export let Payment;
export let Wishlist;
export let RequestedProduct;
export let DoothaWaitlist;
export let OrderSupportRequest;
export let WebhookEvent;
export let Refund;
export let Coupon;
export let CouponRedemption;
export let Address;
export let ConsentRecord;
export let BackInStockRequest;
export let OwnedPlant;
export let PlantHealthLog;
export let NotificationPreference;
export let AppNotification;
export let SavedItem;
export let StoreCredit;
export let CreditEntry;
export let SavedPaymentMethod;
export let RecentView;
export let CartSnapshot;
export let ChatTurn;
export let QuoteRequest;

export const models = {};

// Defines every shop table on this connection and wires the associations. Called once from connect().
// Returns the models map. Later imports of User, Order, and the rest see the same objects.
export function initModels(seq) {
  sequelize = seq;

  // Accounts. phone and email are unique. passwordHash is hidden from JSON. role is admin, seller, or buyer.
  User = seq.define("User", {
    id, name: DataTypes.STRING,
    email: { type: DataTypes.STRING, unique: true },
    phone: { type: DataTypes.STRING, unique: true },
    passwordHash: DataTypes.STRING,
    phoneVerifiedAt: DataTypes.DATE,
    emailVerified: { type: DataTypes.BOOLEAN, defaultValue: false },
    provider: { type: DataTypes.STRING, defaultValue: "local" },
    role: DataTypes.STRING,
    addressLine: DataTypes.STRING, city: DataTypes.STRING, state: DataTypes.STRING,
    pincode: DataTypes.STRING, country: DataTypes.STRING,
    latitude: DataTypes.DOUBLE, longitude: DataTypes.DOUBLE,
    referralCode: DataTypes.STRING, referredBy: optId,
  }, table("users"));

  // Top-level catalog groups such as indoor and outdoor plants. slug is the public URL.
  Category = seq.define("Category", {
    id, name: DataTypes.STRING, slug: { type: DataTypes.STRING, unique: true }, description: DataTypes.TEXT,
  }, table("categories"));

  // A group inside a category. categoryId is required.
  Subcategory = seq.define("Subcategory", {
    id, name: DataTypes.STRING, slug: DataTypes.STRING, description: DataTypes.TEXT, categoryId: reqId,
  }, table("subcategories"));

  // Nursery or brand shown on a product. slug is unique.
  Brand = seq.define("Brand", {
    id, name: DataTypes.STRING, slug: { type: DataTypes.STRING, unique: true },
  }, table("brands"));

  // A plant or good for sale. price is what we charge, mrp is the crossed-out price.
  // stock is the count when trackInventory is on. sizeClass and bulky decide courier versus van.
  // gstRate and hsnCode feed the tax invoice. featured products are the home-page list.
  Product = seq.define("Product", {
    id, name: DataTypes.STRING, slug: { type: DataTypes.STRING, unique: true },
    description: DataTypes.TEXT, shortDesc: DataTypes.TEXT, fullDesc: DataTypes.TEXT,
    specifications: DataTypes.TEXT, taxInfo: DataTypes.TEXT,
    price: DataTypes.DOUBLE, mrp: DataTypes.DOUBLE, currency: DataTypes.STRING,
    imageKey: DataTypes.STRING, status: DataTypes.STRING,
    featured: { type: DataTypes.BOOLEAN, defaultValue: false },
    tags: textArr, stock: { type: DataTypes.INTEGER, defaultValue: 0 },
    trackInventory: { type: DataTypes.BOOLEAN, defaultValue: true },
    lowStockThreshold: { type: DataTypes.INTEGER, defaultValue: 5 },
    ratingAverage: { type: DataTypes.DOUBLE, defaultValue: 0 },
    ratingCount: { type: DataTypes.INTEGER, defaultValue: 0 },
    hsnCode: DataTypes.STRING, gstRate: { type: DataTypes.DOUBLE, defaultValue: 0 },
    sizeClass: { type: DataTypes.STRING, defaultValue: "small" },
    bulky: { type: DataTypes.BOOLEAN, defaultValue: false },
    categoryId: reqId, subcategoryId: optId, brandId: optId,
  }, table("products"));

  // A pot size or height of the same plant, with its own price, stock, and photos.
  ProductSize = seq.define("ProductSize", {
    id, label: DataTypes.STRING, price: DataTypes.DOUBLE, stock: { type: DataTypes.INTEGER, defaultValue: 0 },
    productId: reqId, sizeClass: DataTypes.STRING, bulky: DataTypes.BOOLEAN, imageKeys: textArr,
  }, table("product_sizes"));

  // Extra name/value facts on a product, such as light or growth rate.
  Attribute = seq.define("Attribute", {
    id, name: DataTypes.STRING, value: DataTypes.STRING, productId: reqId,
  }, table("attributes"));

  // One review per user per product. New reviews stay pending until an admin approves them.
  Review = seq.define("Review", {
    id, rating: DataTypes.INTEGER, title: DataTypes.STRING, comment: DataTypes.TEXT,
    productId: reqId, userId: reqId, status: { type: DataTypes.STRING, defaultValue: "pending" },
    verifiedPurchase: { type: DataTypes.BOOLEAN, defaultValue: false },
    imageKeys: textArr, adminNotes: DataTypes.TEXT,
  }, table("reviews", { indexes: [{ unique: true, fields: ["user_id", "product_id"] }] }));

  // A checkout. amount is what the shopper pays. paymentStatus tracks Razorpay.
  // fulfillmentChannel is pickup, courier, van, or bulk. deliveryFee is what we charged; courierCost is what the courier billed us.
  // publicToken lets a guest open the order. inventoryReleased means stock was put back after a cancel.
  Order = seq.define("Order", {
    id, userId: optId,
    razorpayOrderId: { type: DataTypes.STRING, unique: true },
    razorpayPaymentId: DataTypes.STRING,
    paymentStatus: { type: DataTypes.STRING, defaultValue: "created" },
    status: DataTypes.STRING, amount: DataTypes.DOUBLE, currency: DataTypes.STRING,
    expectedDeliveryDate: DataTypes.DATE, publicToken: DataTypes.STRING,
    customerName: DataTypes.STRING, customerEmail: DataTypes.STRING, customerPhone: DataTypes.STRING,
    clientIp: DataTypes.STRING, userAgent: DataTypes.STRING,
    addressLine: DataTypes.STRING, city: DataTypes.STRING, state: DataTypes.STRING, pincode: DataTypes.STRING,
    fulfillmentChannel: DataTypes.STRING, fulfillmentZone: DataTypes.STRING,
    subtotal: DataTypes.DOUBLE, deliveryFee: DataTypes.DOUBLE,
    deliveryFeeWaived: { type: DataTypes.BOOLEAN, defaultValue: false },
    distanceKm: DataTypes.DOUBLE, distanceSource: DataTypes.STRING,
    latitude: DataTypes.DOUBLE, longitude: DataTypes.DOUBLE,
    courierProvider: DataTypes.STRING, courierService: DataTypes.STRING, courierCost: DataTypes.DOUBLE,
    shipmentId: DataTypes.STRING, awbNumber: DataTypes.STRING, trackingUrl: DataTypes.STRING,
    shippedAt: DataTypes.DATE, deliveredAt: DataTypes.DATE, pickupBookedAt: DataTypes.DATE,
    taxableValue: DataTypes.DOUBLE, taxAmount: DataTypes.DOUBLE,
    invoiceNumber: DataTypes.STRING, invoiceDate: DataTypes.DATE,
    couponId: optId, couponCode: DataTypes.STRING, discountTotal: DataTypes.DOUBLE,
    reviewRequestedAt: DataTypes.DATE, cancelledAt: DataTypes.DATE, cancelReason: DataTypes.STRING,
    refundedAmount: { type: DataTypes.DOUBLE, defaultValue: 0 },
    inventoryReleased: { type: DataTypes.BOOLEAN, defaultValue: false },
    giftWrap: { type: DataTypes.BOOLEAN, defaultValue: false }, giftNote: DataTypes.STRING,
    hidePrice: { type: DataTypes.BOOLEAN, defaultValue: false }, giftFee: DataTypes.DOUBLE,
    deliverySlot: DataTypes.STRING, preferredDeliveryDate: DataTypes.DATE,
    deliveryRating: DataTypes.INTEGER, deliveryFeedback: DataTypes.STRING,
    creditApplied: DataTypes.DOUBLE, shippingAddress: DataTypes.TEXT, billingAddress: DataTypes.TEXT,
  }, table("orders"));

  // One line on an order. price is the unit price at purchase time, not the live catalog price.
  // product_size is the column name for productSizeId. The field option keeps that mapping.
  OrderItem = seq.define("OrderItem", {
    id, orderId: reqId, productId: reqId,
    productSizeId: { ...optId, field: "product_size" }, quantity: DataTypes.INTEGER,
    price: DataTypes.DOUBLE, name: DataTypes.STRING, imageKey: DataTypes.STRING,
  }, table("order_items"));

  // A Razorpay payment against an order. razorpayPaymentId is unique so a webhook cannot record it twice.
  Payment = seq.define("Payment", {
    id, orderId: reqId, razorpayOrderId: DataTypes.STRING,
    razorpayPaymentId: { type: DataTypes.STRING, unique: true },
    amount: DataTypes.DOUBLE, currency: DataTypes.STRING, status: DataTypes.STRING,
    method: DataTypes.STRING, description: DataTypes.TEXT,
  }, table("payments"));

  // A saved product. priceAtAdd is the price when they saved it, so a drop can be noticed later.
  Wishlist = seq.define("Wishlist", {
    id, userId: reqId, productId: reqId, priceAtAdd: DataTypes.DOUBLE,
  }, table("wishlists", { indexes: [{ unique: true, fields: ["user_id", "product_id"] }] }));

  // A plant someone asked us to stock. status starts at pending until staff act on it.
  RequestedProduct = seq.define("RequestedProduct", {
    id, productName: { type: DataTypes.STRING, allowNull: false }, details: DataTypes.TEXT,
    status: { type: DataTypes.STRING, defaultValue: "pending" },
    source: { type: DataTypes.STRING, defaultValue: "manual" },
    requestedById: optId, requesterName: DataTypes.STRING, requesterEmail: DataTypes.STRING,
    requesterPhone: DataTypes.STRING, adminNotes: DataTypes.TEXT,
  }, table("requested_products"));

  // Signup for the Dootha delivery waitlist. signups counts how many times the same phone asked.
  DoothaWaitlist = seq.define("DoothaWaitlist", {
    id, name: { type: DataTypes.STRING, allowNull: false }, phone: { type: DataTypes.STRING, allowNull: false },
    email: DataTypes.STRING, address: DataTypes.TEXT,
    status: { type: DataTypes.STRING, defaultValue: "pending" },
    source: { type: DataTypes.STRING, defaultValue: "homepage_popup" },
    userId: optId, ip: DataTypes.STRING, userAgent: DataTypes.STRING,
    signups: { type: DataTypes.INTEGER, defaultValue: 1 }, adminNotes: DataTypes.TEXT,
  }, table("dootha_waitlists"));

  // A help request about an order, usually from the chatbot. priority defaults to high.
  OrderSupportRequest = seq.define("OrderSupportRequest", {
    id, orderId: optId, userId: optId, customerName: DataTypes.STRING, customerEmail: DataTypes.STRING,
    customerPhone: DataTypes.STRING, issueType: DataTypes.STRING,
    priority: { type: DataTypes.STRING, defaultValue: "high" },
    userMessage: { type: DataTypes.TEXT, allowNull: false },
    orderStatus: DataTypes.STRING, paymentStatus: DataTypes.STRING, orderAmount: DataTypes.DOUBLE,
    orderItems: DataTypes.TEXT, expectedDelivery: DataTypes.STRING,
    status: { type: DataTypes.STRING, defaultValue: "pending" },
    source: { type: DataTypes.STRING, defaultValue: "chatbot" }, adminNotes: DataTypes.TEXT,
  }, table("order_support_requests"));

  // A payment or courier webhook we already saw. eventId is unique so a retry is not applied twice.
  WebhookEvent = seq.define("WebhookEvent", {
    id, provider: DataTypes.STRING, eventId: { type: DataTypes.STRING, unique: true },
    eventType: DataTypes.STRING, status: { type: DataTypes.STRING, defaultValue: "received" },
    payload: DataTypes.TEXT, error: DataTypes.TEXT, attempts: { type: DataTypes.INTEGER, defaultValue: 0 },
    processedAt: DataTypes.DATE,
  }, table("webhook_events"));

  // Money sent back for an order. restockedInventory records whether the plants were returned to stock.
  Refund = seq.define("Refund", {
    id, orderId: reqId, razorpayRefundId: DataTypes.STRING, razorpayPaymentId: DataTypes.STRING,
    amount: DataTypes.DOUBLE, currency: { type: DataTypes.STRING, defaultValue: "INR" },
    status: { type: DataTypes.STRING, defaultValue: "pending" }, reason: DataTypes.STRING,
    notes: DataTypes.TEXT, initiatedBy: optId, processedAt: DataTypes.DATE,
    restockedInventory: { type: DataTypes.BOOLEAN, defaultValue: false },
  }, table("refunds"));

  // A discount code. type and value say how the discount is calculated. usageCount is how many times it has been used.
  Coupon = seq.define("Coupon", {
    id, code: { type: DataTypes.STRING, unique: true }, description: DataTypes.STRING,
    type: DataTypes.STRING, value: DataTypes.DOUBLE, maxDiscount: DataTypes.DOUBLE, minSubtotal: DataTypes.DOUBLE,
    usageLimit: DataTypes.INTEGER, perUserLimit: { type: DataTypes.INTEGER, defaultValue: 1 },
    usageCount: { type: DataTypes.INTEGER, defaultValue: 0 },
    categoryIds: textArr, productIds: textArr,
    firstOrderOnly: { type: DataTypes.BOOLEAN, defaultValue: false },
    startsAt: DataTypes.DATE, expiresAt: DataTypes.DATE,
    active: { type: DataTypes.BOOLEAN, defaultValue: true },
  }, table("coupons"));

  // One use of a coupon on one order, so per-user limits can be checked.
  CouponRedemption = seq.define("CouponRedemption", {
    id, couponId: reqId, userId: optId, email: DataTypes.STRING, orderId: reqId, amount: DataTypes.DOUBLE,
  }, table("coupon_redemptions"));

  // A saved delivery address. isDefault is the one checkout offers first.
  Address = seq.define("Address", {
    id, userId: reqId, label: DataTypes.STRING, name: DataTypes.STRING, phone: DataTypes.STRING,
    addressLine: DataTypes.STRING, city: DataTypes.STRING, state: DataTypes.STRING, pincode: DataTypes.STRING,
    latitude: DataTypes.DOUBLE, longitude: DataTypes.DOUBLE,
    isDefault: { type: DataTypes.BOOLEAN, defaultValue: false },
  }, table("addresses"));

  // A record that the shopper accepted or refused a notice, with the version they saw.
  ConsentRecord = seq.define("ConsentRecord", {
    id, userId: optId, email: DataTypes.STRING, purpose: DataTypes.STRING, granted: DataTypes.BOOLEAN,
    noticeVersion: DataTypes.STRING, ip: DataTypes.STRING, userAgent: DataTypes.STRING,
  }, table("consent_records"));

  // An email waiting for a sold-out product. notifiedAt is set once the back-in-stock mail goes out.
  BackInStockRequest = seq.define("BackInStockRequest", {
    id, productId: reqId, productSizeId: optId, email: DataTypes.STRING, userId: optId, notifiedAt: DataTypes.DATE,
  }, table("back_in_stock_requests"));

  // A plant in the shopper's own collection, with watering and feeding intervals and the next due times.
  OwnedPlant = seq.define("OwnedPlant", {
    id, userId: reqId, name: DataTypes.STRING, location: DataTypes.STRING, notes: DataTypes.TEXT,
    waterEveryDays: DataTypes.INTEGER, fertilizeEveryDays: DataTypes.INTEGER,
    waterNextAt: DataTypes.DATE, fertilizeNextAt: DataTypes.DATE,
    waterReminder: { type: DataTypes.BOOLEAN, defaultValue: true },
    fertilizeReminder: { type: DataTypes.BOOLEAN, defaultValue: true },
    photoUrl: DataTypes.STRING, productId: optId, productSlug: DataTypes.STRING, room: DataTypes.STRING,
    mistEveryDays: DataTypes.INTEGER, rotateEveryDays: DataTypes.INTEGER,
    repotEveryDays: DataTypes.INTEGER, pruneEveryDays: DataTypes.INTEGER,
    mistReminder: DataTypes.BOOLEAN, rotateReminder: DataTypes.BOOLEAN,
    repotReminder: DataTypes.BOOLEAN, pruneReminder: DataTypes.BOOLEAN,
    mistNextAt: DataTypes.DATE, rotateNextAt: DataTypes.DATE, repotNextAt: DataTypes.DATE, pruneNextAt: DataTypes.DATE,
    snoozedUntil: DataTypes.DATE,
  }, table("owned_plants"));

  // A health note on an owned plant, with an optional follow-up date.
  PlantHealthLog = seq.define("PlantHealthLog", {
    id, ownedPlantId: reqId, userId: reqId, status: DataTypes.STRING, notes: DataTypes.TEXT,
    photoUrl: DataTypes.STRING, recordedAt: DataTypes.DATE, followUpAt: DataTypes.DATE,
  }, table("plant_health_logs"));

  // Per-user switches for order, promo, care, weather, and Dootha alerts, plus quiet hours.
  NotificationPreference = seq.define("NotificationPreference", {
    id, userId: { type: DataTypes.BIGINT, allowNull: false, unique: true },
    orderUpdates: { type: DataTypes.BOOLEAN, defaultValue: true },
    promotions: { type: DataTypes.BOOLEAN, defaultValue: false },
    careReminders: { type: DataTypes.BOOLEAN, defaultValue: true },
    weatherAlerts: { type: DataTypes.BOOLEAN, defaultValue: true },
    doothaAlerts: { type: DataTypes.BOOLEAN, defaultValue: true },
    reminderHour: { type: DataTypes.INTEGER, defaultValue: 8 },
    quietStartHour: { type: DataTypes.INTEGER, defaultValue: 22 },
    quietEndHour: { type: DataTypes.INTEGER, defaultValue: 7 },
    vacationUntil: DataTypes.DATE, pushToken: DataTypes.STRING,
  }, table("notification_preferences"));

  // An in-app message. dedupeKey stops the same reminder from being inserted twice.
  AppNotification = seq.define("AppNotification", {
    id, userId: reqId, kind: DataTypes.STRING, title: DataTypes.STRING, body: DataTypes.STRING,
    ownedPlantId: optId, orderId: optId, productId: optId, href: DataTypes.STRING,
    readAt: DataTypes.DATE, dedupeKey: { type: DataTypes.STRING, unique: true },
  }, table("app_notifications"));

  // A cart line saved on the account, including the chosen pot and quantity.
  SavedItem = seq.define("SavedItem", {
    id, userId: reqId, productId: reqId, productSizeId: optId, pot: DataTypes.STRING,
    quantity: { type: DataTypes.INTEGER, defaultValue: 1 },
  }, table("saved_items", { indexes: [{ unique: true, fields: ["user_id", "product_id"] }] }));

  // The shopper's credit balance in rupees. One row per user.
  StoreCredit = seq.define("StoreCredit", {
    id, userId: { type: DataTypes.BIGINT, allowNull: false, unique: true }, balance: DataTypes.DOUBLE,
  }, table("store_credits"));

  // One credit grant or spend. amount is signed by the caller. orderId is set when checkout used the credit.
  CreditEntry = seq.define("CreditEntry", {
    id, userId: reqId, amount: DataTypes.DOUBLE, reason: DataTypes.STRING, orderId: optId,
  }, table("credit_entries"));

  // A label for a saved payment method. The raw card number is not stored here.
  SavedPaymentMethod = seq.define("SavedPaymentMethod", {
    id, userId: reqId, kind: DataTypes.STRING, label: DataTypes.STRING, detail: DataTypes.STRING,
    isDefault: { type: DataTypes.BOOLEAN, defaultValue: false },
  }, table("saved_payment_methods"));

  // A product the user opened, so the app can show recently viewed plants.
  RecentView = seq.define("RecentView", {
    id, userId: reqId, productId: reqId, viewedAt: DataTypes.DATE,
  }, table("recent_views", { indexes: [{ unique: true, fields: ["user_id", "product_id"] }] }));

  // The last cart we saw for this user, used to send one abandoned-cart email. itemsJson is hidden from API JSON.
  CartSnapshot = seq.define("CartSnapshot", {
    id, userId: { type: DataTypes.BIGINT, allowNull: false, unique: true },
    itemsJson: DataTypes.TEXT, itemCount: DataTypes.INTEGER, notifiedAt: DataTypes.DATE,
  }, table("cart_snapshots"));

  // One line of the shopper's chat with the assistant.
  ChatTurn = seq.define("ChatTurn", {
    id, userId: reqId, role: DataTypes.STRING, content: DataTypes.TEXT,
  }, table("chat_turns"));

  // A bulk quotation that was emailed. estimateNo is the number printed on the PDF. status starts at sent.
  QuoteRequest = seq.define("QuoteRequest", {
    id, userId: optId, estimateNo: DataTypes.STRING, name: DataTypes.STRING, phone: DataTypes.STRING,
    email: DataTypes.STRING, summary: DataTypes.STRING, amount: DataTypes.DOUBLE,
    status: { type: DataTypes.STRING, defaultValue: "sent" },
  }, table("quote_requests"));

  // Links used by includes: a product's category, sizes, and reviews, an order's items, and so on.
  Category.hasMany(Subcategory, { foreignKey: "categoryId", as: "subcategories" });
  Subcategory.belongsTo(Category, { foreignKey: "categoryId", as: "category" });
  Category.hasMany(Product, { foreignKey: "categoryId", as: "products" });
  Subcategory.hasMany(Product, { foreignKey: "subcategoryId", as: "products" });
  Brand.hasMany(Product, { foreignKey: "brandId", as: "products" });
  Product.belongsTo(Category, { foreignKey: "categoryId", as: "category" });
  Product.belongsTo(Subcategory, { foreignKey: "subcategoryId", as: "subcategory" });
  Product.belongsTo(Brand, { foreignKey: "brandId", as: "brand" });
  Product.hasMany(ProductSize, { foreignKey: "productId", as: "sizes" });
  ProductSize.belongsTo(Product, { foreignKey: "productId" });
  Product.hasMany(Attribute, { foreignKey: "productId", as: "attributes" });
  Product.hasMany(Review, { foreignKey: "productId", as: "reviews" });
  Review.belongsTo(User, { foreignKey: "userId", as: "user" });
  Review.belongsTo(Product, { foreignKey: "productId" });
  User.hasMany(Review, { foreignKey: "userId", as: "reviews" });
  Order.belongsTo(User, { foreignKey: "userId", as: "user" });
  Order.hasMany(OrderItem, { foreignKey: "orderId", as: "items" });
  OrderItem.belongsTo(Order, { foreignKey: "orderId" });
  OrderItem.belongsTo(Product, { foreignKey: "productId", as: "product" });
  Payment.belongsTo(Order, { foreignKey: "orderId", as: "order" });
  Wishlist.belongsTo(Product, { foreignKey: "productId", as: "product" });
  Refund.belongsTo(Order, { foreignKey: "orderId", as: "order" });
  OwnedPlant.hasMany(PlantHealthLog, { foreignKey: "ownedPlantId", as: "healthLogs" });
  SavedItem.belongsTo(Product, { foreignKey: "productId", as: "product" });
  RecentView.belongsTo(Product, { foreignKey: "productId", as: "product" });

  const all = [
    User, Category, Subcategory, Brand, Product, ProductSize, Attribute, Review, Order, OrderItem,
    Payment, Wishlist, RequestedProduct, DoothaWaitlist, OrderSupportRequest, WebhookEvent, Refund,
    Coupon, CouponRedemption, Address, ConsentRecord, BackInStockRequest, OwnedPlant, PlantHealthLog,
    NotificationPreference, AppNotification, SavedItem, StoreCredit, CreditEntry, SavedPaymentMethod,
    RecentView, CartSnapshot, ChatTurn, QuoteRequest,
  ];
  for (const Model of all) {
    // Every model JSON response drops the hidden columns.
    Model.prototype.toJSON = function toJSON() {
      return present(this.get({ plain: true }));
    };
    models[Model.name] = Model;
  }

  const orderJSON = Order.prototype.toJSON;
  // Orders also hide the client IP and user agent. Those are for fraud review, not for the shopper.
  Order.prototype.toJSON = function orderToJSON() {
    const body = orderJSON.call(this);
    delete body.clientIp;
    delete body.userAgent;
    return body;
  };
  // Handlers call this before offering a cancel button.
  // A shipped order, one with an airway bill, or one already cancelled cannot be cancelled here.
  Order.prototype.isCancellable = function isCancellable() {
    if (this.cancelledAt || this.awbNumber || this.shippedAt) return false;
    return ["pending", "paid", "confirmed", "processing"].includes(this.status);
  };
  // What the shop pays the courier minus what the shopper paid for delivery.
  // Zero when we never recorded a courier cost. A negative number means the fee covered the courier.
  Order.prototype.deliverySubsidy = function deliverySubsidy() {
    if (this.courierCost == null) return 0;
    return Number(this.courierCost) - Number(this.deliveryFee || 0);
  };

  return models;
}

// Empty string becomes null so an optional column is stored as SQL NULL, not "".
export function strPtr(s) {
  return s ? s : null;
}

// The user's email, or "" when the account has none. Callers use this instead of reading a missing row.
export function emailOrEmpty(user) {
  return user?.email || "";
}

// The user's phone, or "" when the account has none.
export function phoneOrEmpty(user) {
  return user?.phone || "";
}
