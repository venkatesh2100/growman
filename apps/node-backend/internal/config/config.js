// Reads settings from the environment (and from a .env file if one exists).
//
// The database URL and, in production, the payment secrets are required.
// The server refuses to start without them, instead of failing later
// when a customer tries to pay.
//
// Every other integration (email, images, chat, plant scan, SMS, courier)
// is optional. The route that needs it answers "not configured" when the
// secret is empty.
//
// Field names here are camelCase. GO_PORT becomes settings.port.
// The names of the environment variables themselves are unchanged, so the
// same example.env file works for this server and the Go server.

import dotenv from "dotenv";
import { defaultPolicy, parseZone } from "../fulfillment/fulfillment.js";

dotenv.config();

function getenv(key, fallback) {
  const val = process.env[key];
  return val == null || val === "" ? fallback : val;
}

function getenvInt(key, fallback) {
  const val = process.env[key];
  if (!val) return fallback;
  const n = Number.parseInt(val, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function getenvFloat(key, fallback) {
  const val = process.env[key];
  if (!val) return fallback;
  const f = Number.parseFloat(val);
  if (!Number.isFinite(f) || f < 0) return fallback;
  return f;
}

function isProd(env) {
  const e = String(env ?? "").trim().toLowerCase();
  return e === "production" || e === "prod";
}

function firstNonEmpty(...values) {
  for (const s of values) if (s) return s;
  return "";
}

function splitAndTrim(input) {
  return String(input)
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

export function fulfillmentPolicy(cfg) {
  const p = defaultPolicy();
  if (cfg.storeLatitude !== 0 && cfg.storeLongitude !== 0) {
    p.storeLat = cfg.storeLatitude;
    p.storeLng = cfg.storeLongitude;
  }
  if (cfg.courierProvider) p.courierProvider = cfg.courierProvider;
  const zone = parseZone(cfg.retailMaxZone);
  if (zone) p.retailMaxZone = zone;
  p.freeDeliveryMinSubtotal = cfg.freeDeliveryMinSubtotal;
  if (cfg.ownVehicleMinSubtotal > 0) p.ownVehicleMinSubtotal = cfg.ownVehicleMinSubtotal;
  if (cfg.bulkMinUnits > 0) p.bulkMinUnits = cfg.bulkMinUnits;
  if (cfg.bulkMinSubtotal > 0) p.bulkMinSubtotal = cfg.bulkMinSubtotal;
  return p;
}

export function load() {
  const cfg = {
    port: getenv("GO_PORT", ":8080"),
    databaseURL: process.env.DATABASE_URL || "",
    hyperdriveURL: process.env.HYPERDRIVE_URL || "",
    jwtSecret: getenv("JWT_SECRET", "dev-secret-change-me"),
    appEnv: getenv("GO_ENV", getenv("APP_ENV", "development")),
    autoMigrate: getenv("AUTO_MIGRATE", "true") === "true",
    redisURL: process.env.REDIS_URL || "",
    seedOnStartup: getenv("SEED_ON_STARTUP", "false") === "true",
    razorpayKeyID: process.env.RAZORPAY_KEY_ID || "",
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || "",
    razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
    smtpEmail: process.env.SMTP_EMAIL || "",
    smtpPassword: process.env.SMTP_PASSWORD || "",
    smtpHost: getenv("SMTP_HOST", "smtp.gmail.com"),
    smtpPort: getenv("SMTP_PORT", "587"),
    merchantNotifyEmail: getenv("MERCHANT_NOTIFY_EMAIL", "zoroboro.ynm@gmail.com"),
    discordWebhookURL: (process.env.DISCORD_WEBHOOK_URL || "").trim(),
    quotationEmail: getenv("QUOTATION_EMAIL", "growman.live@gmail.com"),
    waitlistEmail: getenv("WAITLIST_EMAIL", "growman.live@gmail.com"),
    imageBaseURL: process.env.IMAGE_BASE_URL || "",
    gcsBucketName: process.env.GCS_BUCKET_NAME || "",
    gcsProjectID: process.env.GCS_PROJECT_ID || "",
    gcsCredentialsJSON: process.env.GCS_CREDENTIALS_JSON || "",
    openAIAPIKey: process.env.OPENAI_API_KEY || "",
    geminiAPIKey: process.env.GEMINI_API_KEY || "",
    aiProvider: getenv("AI_PROVIDER", "openai"),
    ragServiceURL: (process.env.RAG_SERVICE_URL || "").trim(),
    ragSharedSecret: process.env.RAG_SHARED_SECRET || "",
    plantNetAPIKey: process.env.PLANTNET_API_KEY || "",
    plantNetProject: getenv("PLANTNET_PROJECT", "all"),
    plantNetReserve: getenvInt("PLANTNET_RESERVE", 40),
    plantNetBaseURL: process.env.PLANTNET_BASE_URL || "",
    googleClientID: firstNonEmpty(process.env.GOOGLE_CLIENT_ID, process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID),
    cloudflareAPIToken: process.env.CLOUDFLARE_API_TOKEN || "",
    cloudflareZoneID: process.env.CLOUDFLARE_ZONE_ID || "",
    cloudflareAccountID: (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim(),
    msg91AuthKey: process.env.MSG91_AUTH_KEY || "",
    msg91TemplateID: process.env.MSG91_TEMPLATE_ID || "",
    msg91WidgetID: process.env.MSG91_WIDGET_ID || "",
    msg91TokenAuth: process.env.MSG91_TOKEN_AUTH || "",
    truecallerClientID: firstNonEmpty(process.env.TRUECALLER_CLIENT_ID, process.env.TRUECALLER_ANDROID_CLIENT_ID),
    storeLatitude: getenvFloat("STORE_LATITUDE", 0),
    storeLongitude: getenvFloat("STORE_LONGITUDE", 0),
    storePincode: (process.env.STORE_PINCODE || "").trim(),
    courierProvider: getenv("COURIER_PROVIDER", "Shiprocket"),
    retailMaxZone: process.env.RETAIL_MAX_ZONE || "",
    shiprocketEmail: process.env.SHIPROCKET_EMAIL || "",
    shiprocketPassword: process.env.SHIPROCKET_PASSWORD || "",
    shiprocketToken: (process.env.SHIPROCKET_TOKEN || "").trim(),
    shiprocketPickupLocation: (process.env.SHIPROCKET_PICKUP_LOCATION || "").trim(),
    shiprocketWebhookToken: (process.env.SHIPROCKET_WEBHOOK_TOKEN || "").trim(),
    freeDeliveryMinSubtotal: getenvFloat("FREE_DELIVERY_MIN_SUBTOTAL", 0),
    ownVehicleMinSubtotal: getenvFloat("OWN_VEHICLE_MIN_SUBTOTAL", 0),
    bulkMinUnits: getenvInt("BULK_MIN_UNITS", 0),
    bulkMinSubtotal: getenvFloat("BULK_MIN_SUBTOTAL", 0),
    dbMaxOpenConns: getenvInt("DB_MAX_OPEN_CONNS", 40),
    dbMaxIdleConns: getenvInt("DB_MAX_IDLE_CONNS", 10),
    redisPoolSize: getenvInt("REDIS_POOL_SIZE", 20),
  };
  cfg.allowedOrigins = splitAndTrim(
    getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001,http://localhost:3002"),
  );
  if (!cfg.hyperdriveURL && !cfg.databaseURL) {
    throw new Error("either HYPERDRIVE_URL or DATABASE_URL is required for node backend");
  }
  if (isProd(cfg.appEnv) && (!cfg.jwtSecret || cfg.jwtSecret === "dev-secret-change-me")) {
    throw new Error("JWT_SECRET must be set to a strong secret in production");
  }
  if (isProd(cfg.appEnv)) {
    if (!cfg.razorpayKeySecret) {
      throw new Error("RAZORPAY_KEY_SECRET is required in production to verify payment signatures");
    }
    if (!cfg.razorpayWebhookSecret) {
      throw new Error(
        "RAZORPAY_WEBHOOK_SECRET is required in production to verify webhook signatures (this is the dashboard webhook secret, not the API key secret)",
      );
    }
  }
  return cfg;
}
