// This file is the map of every URL the API serves.
//
// Read it from top to bottom:
//   - The first middlewares run on every request (security headers, logs,
//     a 60 second timeout, gzip, and which websites may call the API).
//   - /healthz and /readyz are for the server itself, not for shoppers.
//   - /webhooks/* are called by Razorpay and Shiprocket. They are not
//     behind the shopper rate limit, because slowing them down only
//     makes the provider send the same event again.
//   - /api/v1 is the shop. Public pages (products, categories) need no
//     login. Checkout and login are limited by IP so they cannot be
//     spammed. Account pages need a full login token.
//
// A route that has not been ported yet answers 501. A missing URL answers
// the same plain "404 page not found" text as the Go server.

import express from "express";
import cors from "cors";
import compression from "compression";
import { randomUUID } from "node:crypto";
import * as auth from "../auth/jwt.js";
import { mountDocs } from "../docs/mount.js";
import { metricsHandler } from "../metrics/prometheus.js";
import { clientIP } from "../middlewares/ip.js";
import { prometheus } from "../middlewares/prometheus.js";
import { namedIPRateLimiter, strictIPRateLimiter } from "../middlewares/ratelimit.js";
import { quietLogger, requestTimeout, securityHeaders, throttle } from "../middlewares/security.js";

// Turns a handler method name into an Express function.
// Example: call(handler, "listProducts") runs handler.listProducts(req, res).
function call(handler, name) {
  return (req, res, next) => {
    const fn = handler[name];
    if (typeof fn !== "function") {
      res.status(501).json({ error: `${name} is not implemented` });
      return;
    }
    Promise.resolve(fn.call(handler, req, res, next)).catch(next);
  };
}

export function newRouter(handler, settings) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);

  app.use((req, res, next) => {
    const id = req.get("X-Request-Id") || randomUUID();
    res.set("X-Request-Id", id);
    req.id = id;
    next();
  });
  app.use((req, res, next) => {
    if (!req.ip && req.socket) req.clientIP = clientIP(req);
    next();
  });
  app.use(securityHeaders);
  app.use(prometheus("growman-api"));
  app.use(requestTimeout(60_000));
  app.use(throttle(512));
  app.use(compression({ level: 1 }));
  const verbose = process.env.LOG_HTTP === "1" || process.env.LOG_HTTP === "true";
  app.use(verbose ? (req, res, next) => {
    const start = Date.now();
    res.on("finish", () => console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`));
    next();
  } : quietLogger(1200));
  app.use(cors({
    origin: settings.allowedOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    allowedHeaders: ["Accept", "Authorization", "Content-Type", "X-CSRF-Token", "Origin", "X-Requested-With"],
    exposedHeaders: ["Content-Length", "Content-Type", "ETag", "X-RateLimit-Limit", "X-RateLimit-Remaining"],
    credentials: true,
    maxAge: 600,
  }));

  // Is the process up? /healthz does not touch the database.
  // /readyz also checks Postgres. Redis being down is degraded, not down.
  app.get("/healthz", call(handler, "health"));
  app.get("/readyz", call(handler, "ready"));
  app.get("/metrics", metricsHandler);
  mountDocs(app);
  // Payment and courier callbacks. They prove who sent them with a signature,
  // not with a customer login token.
  app.post("/webhooks/razorpay", express.raw({ type: "*/*", limit: "2mb" }), (req, res, next) => {
    req.rawBody = req.body;
    try { req.body = JSON.parse(req.body.toString("utf8") || "null"); } catch { req.body = null; }
    next();
  }, call(handler, "razorpayWebhook"));
  app.post("/webhooks/shiprocket", express.raw({ type: "*/*", limit: "2mb" }), (req, res, next) => {
    req.rawBody = req.body;
    try { req.body = JSON.parse(req.body.toString("utf8") || "null"); } catch { req.body = null; }
    next();
  }, call(handler, "shiprocketWebhook"));

  // Everything under /api/v1. JSON bodies are capped at 11 MB.
  const api = express.Router();
  api.use(express.json({
    limit: "11mb",
    verify: (req, _res, buf) => { req.rawBody = buf; },
  }));
  api.use(express.urlencoded({ extended: false, limit: "11mb" }));
  if (handler.redis) api.use(namedIPRateLimiter(handler.redis, "api", 250, 60_000));

  api.get("/debug/version", call(handler, "version"));
  api.get("/healthz", call(handler, "health"));

  // Login, signup, and OTP. Limited to 20 calls per IP per minute.
  // A Redis outage still enforces the limit here, because each OTP text costs money.
  const authRoutes = express.Router();
  authRoutes.use(strictIPRateLimiter(handler.redis, "auth", 20, 60_000));
  authRoutes.post("/login", call(handler, "login"));
  authRoutes.post("/admin/login", call(handler, "adminLogin"));
  authRoutes.post("/signup", call(handler, "signup"));
  authRoutes.post("/google", call(handler, "google"));
  authRoutes.post("/google-signup", call(handler, "googleSignup"));
  authRoutes.post("/forgot-password/send-otp", call(handler, "sendPasswordResetOTP"));
  authRoutes.post("/forgot-password/verify-otp", call(handler, "verifyPasswordResetOTP"));
  authRoutes.post("/forgot-password/reset", call(handler, "resetPassword"));
  authRoutes.post("/otp/send", call(handler, "sendPhoneOTP"));
  authRoutes.post("/otp/verify", call(handler, "verifyPhoneOTP"));
  authRoutes.post("/otp/widget/verify", call(handler, "verifyWidgetOTP"));
  authRoutes.post("/truecaller", call(handler, "verifyTruecaller"));
  api.use("/auth", authRoutes);

  // Checkout. Guests can pay, so these routes do not require a token.
  // If a token is sent, we still read it, so a signed-in customer is not treated as a guest.
  const checkout = express.Router();
  checkout.use(strictIPRateLimiter(handler.redis, "checkout", 20, 60_000));
  checkout.use(auth.optionalAuthMiddleware(settings.jwtSecret));
  checkout.post("/quote", call(handler, "quoteFulfillment"));
  checkout.post("/send-email-otp", call(handler, "sendEmailOTP"));
  checkout.post("/verify-email-otp", call(handler, "verifyEmailOTP"));
  checkout.post("/create-order", call(handler, "createCheckoutOrder"));
  checkout.post("/validate-coupon", call(handler, "validateCoupon"));
  api.use("/checkout", checkout);

  // The catalogue. Reading is public. A review needs a finished account.
  // Creating or editing a product needs an admin.
  const products = express.Router();
  products.get("/", call(handler, "listProducts"));
  products.get("/search", call(handler, "searchProducts"));
  products.get("/featured", call(handler, "featuredProducts"));
  products.get("/filters", call(handler, "filterProducts"));
  products.get("/:slug", call(handler, "getProduct"));
  products.get("/:slug/related", call(handler, "relatedProducts"));
  products.get("/:slug/companions", call(handler, "productCompanions"));
  products.get("/:slug/reviews", call(handler, "listProductReviews"));
  products.post("/:slug/back-in-stock", call(handler, "createBackInStockRequest"));
  products.post("/:slug/reviews", auth.fullAuthMiddleware(settings.jwtSecret), call(handler, "createProductReview"));
  products.post("/", auth.adminMiddleware(settings.jwtSecret), call(handler, "createProduct"));
  products.put("/:slug", auth.adminMiddleware(settings.jwtSecret), call(handler, "updateProduct"));
  products.delete("/:slug", auth.adminMiddleware(settings.jwtSecret), call(handler, "deleteProduct"));
  api.use("/products", products);

  api.get("/categories", call(handler, "listCategories"));
  api.get("/categories/:slug", call(handler, "getCategory"));
  api.get("/categories/:slug/products", call(handler, "productsByCategory"));
  api.get("/categories/:slug/subcategories", call(handler, "listSubcategories"));
  api.get("/categories/:slug/subcategories/:subSlug/products", call(handler, "productsBySubcategory"));
  api.get("/brands", call(handler, "listBrands"));
  api.get("/tags", call(handler, "listTags"));
  api.get("/catalog", call(handler, "listCatalog"));
  api.get("/care/season", call(handler, "careSeason"));

  // Admin-only tools: stock, refunds, invoices, coupons, shipments.
  const adminOnly = auth.adminMiddleware(settings.jwtSecret);
  api.post("/images/upload", adminOnly, call(handler, "uploadImage"));
  api.post("/inventory/adjust", adminOnly, call(handler, "adjustStock"));
  api.get("/inventory/low-stock", adminOnly, call(handler, "listLowStock"));
  api.get("/reviews", adminOnly, call(handler, "listReviewsForModeration"));
  api.patch("/reviews/:id/status", adminOnly, call(handler, "moderateReview"));
  api.get("/refunds", adminOnly, call(handler, "listRefunds"));
  api.post("/orders/:id/refund", adminOnly, call(handler, "createRefund"));
  api.post("/orders/:id/invoice/email", adminOnly, call(handler, "emailOrderInvoice"));
  api.get("/reports/gst", adminOnly, call(handler, "exportGSTReport"));
  api.post("/orders/:id/shipment", adminOnly, call(handler, "createShipment"));
  api.post("/orders/:id/shipment/pickup", adminOnly, call(handler, "schedulePickup"));
  api.get("/coupons", adminOnly, call(handler, "listCoupons"));
  api.post("/coupons", adminOnly, call(handler, "createCoupon"));
  api.put("/coupons/:id", adminOnly, call(handler, "updateCoupon"));
  api.delete("/coupons/:id", adminOnly, call(handler, "deleteCoupon"));
  api.patch("/quotes/:id", adminOnly, call(handler, "updateQuoteStatus"));

  // Plant photo identification. Limited because each scan uses a paid API credit.
  const plantLimit = strictIPRateLimiter(handler.redis, "plant", 20, 60_000);
  api.post("/images/identify-plant", plantLimit, call(handler, "identifyPlant"));
  api.get("/plants/status", plantLimit, call(handler, "plantNetStatus"));
  api.get("/plants/languages", plantLimit, call(handler, "plantNetLanguages"));
  api.get("/plants/projects", plantLimit, call(handler, "plantNetProjects"));
  api.get("/plants/species", plantLimit, call(handler, "plantNetSpecies"));
  api.get("/plants/diseases", plantLimit, call(handler, "plantNetDiseases"));
  api.get("/plants/varieties", plantLimit, call(handler, "plantNetVarieties"));
  api.get("/plants/quota", plantLimit, call(handler, "plantNetQuota"));

  // Shop chat assistant.
  api.post("/chat", strictIPRateLimiter(handler.redis, "chat", 30, 60_000), call(handler, "chat"));
  const quoteLimit = handler.redis ? [namedIPRateLimiter(handler.redis, "quotation", 5, 10 * 60_000)] : [];
  api.post("/quotations", ...quoteLimit, call(handler, "createQuotation"));
  const waitLimit = handler.redis ? [namedIPRateLimiter(handler.redis, "waitlist", 5, 10 * 60_000)] : [];
  api.post("/dootha-waitlist", ...waitLimit, call(handler, "joinDoothaWaitlist"));

  api.post("/requested-products", call(handler, "createRequestedProduct"));
  api.post("/engagement/long-browse", call(handler, "reportLongBrowse"));
  api.post("/razorpay/verify", call(handler, "verifyPayment"));
  api.get("/auth/check-user", call(handler, "checkUserExists"));

  const optionalAuth = auth.optionalAuthMiddleware(settings.jwtSecret);
  api.post("/consent", optionalAuth, call(handler, "recordConsent"));
  api.get("/order", optionalAuth, call(handler, "getOrder"));
  api.get("/orders/:id/invoice", optionalAuth, call(handler, "getOrderInvoice"));
  api.post("/auth/profile/complete", auth.onboardingAuthMiddleware(settings.jwtSecret), call(handler, "completePhoneProfile"));

  // Signed-in customer pages: profile, orders, wishlist, plants, notifications.
  // An unfinished phone signup cannot use these.
  const accountAuth = auth.fullAuthMiddleware(settings.jwtSecret);
  api.get("/auth/me", accountAuth, call(handler, "me"));
  api.get("/dashboard/map", accountAuth, call(handler, "dashboardMap"));
  api.get("/requested-products", accountAuth, call(handler, "listRequestedProducts"));
  api.get("/dootha-waitlist", accountAuth, call(handler, "listDoothaWaitlist"));
  api.get("/order-support-requests", accountAuth, call(handler, "listOrderSupportRequests"));
  api.patch("/order-support-requests/:id/status", accountAuth, call(handler, "updateOrderSupportStatus"));
  api.put("/auth/profile", accountAuth, call(handler, "updateProfile"));
  api.post("/auth/save-location", accountAuth, call(handler, "saveLocation"));
  api.get("/orders", accountAuth, call(handler, "listOrders"));
  api.patch("/orders/:id/status", accountAuth, call(handler, "updateOrderStatus"));
  api.patch("/orders/:id/expected-delivery", accountAuth, call(handler, "updateOrderExpectedDeliveryDate"));
  api.post("/orders/:id/cancel", accountAuth, call(handler, "cancelOrder"));
  api.get("/wishlist", accountAuth, call(handler, "listWishlist"));
  api.post("/wishlist", accountAuth, call(handler, "addToWishlist"));
  api.delete("/wishlist/:productId", accountAuth, call(handler, "removeFromWishlist"));
  api.get("/addresses", accountAuth, call(handler, "listAddresses"));
  api.post("/addresses", accountAuth, call(handler, "createAddress"));
  api.put("/addresses/:id", accountAuth, call(handler, "updateAddress"));
  api.delete("/addresses/:id", accountAuth, call(handler, "deleteAddress"));
  api.get("/privacy/export", accountAuth, call(handler, "exportMyData"));
  api.post("/privacy/erase", accountAuth, call(handler, "requestErasure"));
  api.get("/me/plants", accountAuth, call(handler, "listOwnedPlants"));
  api.post("/me/plants", accountAuth, call(handler, "createOwnedPlant"));
  api.get("/me/plants/calendar", accountAuth, call(handler, "plantCalendar"));
  api.post("/me/plants/import-orders", accountAuth, call(handler, "importPurchasedPlants"));
  api.get("/me/plants/:id", accountAuth, call(handler, "getOwnedPlant"));
  api.put("/me/plants/:id", accountAuth, call(handler, "updateOwnedPlant"));
  api.delete("/me/plants/:id", accountAuth, call(handler, "deleteOwnedPlant"));
  api.post("/me/plants/:id/water", accountAuth, call(handler, "markPlantWatered"));
  api.post("/me/plants/:id/fertilize", accountAuth, call(handler, "markPlantFertilized"));
  api.post("/me/plants/:id/health", accountAuth, call(handler, "addPlantHealth"));
  api.post("/me/plants/:id/care", accountAuth, call(handler, "markPlantTask"));
  api.post("/me/plants/:id/snooze", accountAuth, call(handler, "snoozePlant"));
  api.post("/me/plants/:id/diagnosis", accountAuth, call(handler, "diagnosePlant"));
  api.post("/me/plants/:id/care-plan", accountAuth, call(handler, "startCarePlan"));
  api.get("/me/plants/:id/card", accountAuth, call(handler, "plantCareCard"));
  api.get("/notification-preferences", accountAuth, call(handler, "getNotificationPreferences"));
  api.put("/notification-preferences", accountAuth, call(handler, "updateNotificationPreferences"));
  api.get("/notifications", accountAuth, call(handler, "listAppNotifications"));
  api.post("/notifications/read-all", accountAuth, call(handler, "markAllNotificationsRead"));
  api.patch("/notifications/:id/read", accountAuth, call(handler, "markNotificationRead"));
  api.get("/me/saved", accountAuth, call(handler, "listSavedItems"));
  api.post("/me/saved", accountAuth, call(handler, "saveForLater"));
  api.delete("/me/saved/:id", accountAuth, call(handler, "removeSavedItem"));
  api.get("/me/payment-methods", accountAuth, call(handler, "listPaymentMethods"));
  api.post("/me/payment-methods", accountAuth, call(handler, "savePaymentMethod"));
  api.delete("/me/payment-methods/:id", accountAuth, call(handler, "deletePaymentMethod"));
  api.get("/me/referral", accountAuth, call(handler, "getReferral"));
  api.post("/me/referral", accountAuth, call(handler, "claimReferral"));
  api.post("/me/recently-viewed", accountAuth, call(handler, "recordRecentView"));
  api.get("/me/recently-viewed", accountAuth, call(handler, "listRecentViews"));
  api.post("/me/cart-signals", accountAuth, call(handler, "syncCartSignals"));
  api.get("/me/offers", accountAuth, call(handler, "listOffers"));
  api.get("/me/quotes", accountAuth, call(handler, "listMyQuotes"));
  api.get("/me/orders/active", accountAuth, call(handler, "activeOrder"));
  api.post("/me/images", accountAuth, call(handler, "uploadMyImage"));
  api.post("/me/scan-alert", accountAuth, call(handler, "scanAlert"));
  api.post("/me/care-followup", accountAuth, call(handler, "careFollowUp"));
  api.get("/me/chat", accountAuth, call(handler, "listChatHistory"));
  api.post("/orders/:id/reorder", accountAuth, call(handler, "reorder"));
  api.post("/orders/:id/rating", accountAuth, call(handler, "rateDelivery"));
  api.post("/orders/:id/retry-payment", accountAuth, call(handler, "retryPayment"));

  app.use("/api/v1", api);
  app.use((req, res) => {
    res.status(404).type("text/plain").send("404 page not found");
  });
  app.use((err, req, res, next) => {
    if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
      res.status(400).json({ error: "invalid request body" });
      return;
    }
    if (err?.type === "entity.too.large") {
      res.status(413).json({ error: "request entity too large" });
      return;
    }
    console.error(err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: "internal server error" });
  });
  return app;
}
