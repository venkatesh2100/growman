// The handler is the toolbox every URL uses.
//
// It keeps:
//   sequelize     the Postgres connection
//   cfg           settings read from the environment
//   redis         optional shared cache and rate-limit counter (null if Redis is off)
//   cache         fast memory cache, with Redis behind it when Redis is on
//   imageService  turns a stored file name into a public image URL (null if uploads are off)
//   shiprocket    courier API client (null if no courier login is configured)
//
// Each file in this folder exports functions such as listProducts(req, res).
// loadHandlerModules copies those functions onto Handler, so a route can call
// handler.listProducts. Inside those functions, `this` is the handler.

import { CacheHelper } from "../cache/cache.js";
import { QueryTypes } from "sequelize";

const HANDLER_MODULES = [
  "health", "query", "image_helpers", "auth", "products", "categories", "brands", "catalog",
  "reviews", "checkout", "payments", "webhooks", "orders", "inventory", "refunds", "coupons",
  "wishlist", "addresses", "images", "chat", "plants", "plants_care", "plants_catalog",
  "plants_image", "plants_cache", "my_plants", "customer_features", "notify", "quotation",
  "dootha_waitlist", "privacy", "shipments", "invoicing", "fulfillment", "inbox",
  "app_notifications", "requested_products", "order_support", "dashboard", "rag_client",
];

export class Handler {
  constructor(sequelize, cfg, redis, imageService, shiprocket = null) {
    this.sequelize = sequelize;
    this.cfg = cfg;
    this.redis = redis;
    this.cache = new CacheHelper(redis);
    this.imageService = imageService;
    this.shiprocket = shiprocket;
  }

  async autoMigrate() {
    await this.sequelize.sync();
    await this.ensureSearchIndexes();
  }

  async ensureSearchIndexes() {
    const stmts = [
      `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
      `CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name gin_trgm_ops)`,
      `CREATE INDEX IF NOT EXISTS idx_products_short_desc_trgm ON products USING gin (short_desc gin_trgm_ops)`,
      `CREATE INDEX IF NOT EXISTS idx_products_tags_gin ON products USING gin (tags)`,
      `CREATE INDEX IF NOT EXISTS idx_categories_name_trgm ON categories USING gin (name gin_trgm_ops)`,
      `CREATE INDEX IF NOT EXISTS idx_brands_name_trgm ON brands USING gin (name gin_trgm_ops)`,
      `CREATE INDEX IF NOT EXISTS idx_products_slug_alive ON products (slug) WHERE deleted_at IS NULL`,
      `CREATE INDEX IF NOT EXISTS idx_product_sizes_product_id ON product_sizes (product_id)`,
      `CREATE INDEX IF NOT EXISTS idx_attributes_product_id ON attributes (product_id)`,
      `CREATE INDEX IF NOT EXISTS idx_reviews_product_id_created ON reviews (product_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_products_featured_created ON products (created_at DESC) WHERE featured = true AND deleted_at IS NULL`,
      `CREATE INDEX IF NOT EXISTS idx_products_category_created ON products (category_id, created_at DESC) WHERE deleted_at IS NULL`,
      `CREATE INDEX IF NOT EXISTS idx_products_created ON products (created_at DESC) WHERE deleted_at IS NULL`,
      `CREATE INDEX IF NOT EXISTS idx_reviews_approved ON reviews (product_id, created_at DESC) WHERE status = 'approved' AND deleted_at IS NULL`,
      `CREATE INDEX IF NOT EXISTS idx_orders_unpaid_created ON orders (created_at) WHERE payment_status = 'created' AND inventory_released = false AND deleted_at IS NULL`,
      `CREATE INDEX IF NOT EXISTS idx_coupons_code_active ON coupons (code) WHERE active = true AND deleted_at IS NULL`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral ON users (referral_code) WHERE referral_code <> ''`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_public_token ON orders (public_token) WHERE public_token <> ''`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_invoice_number ON orders (invoice_number) WHERE invoice_number <> ''`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_razorpay_refund_id ON refunds (razorpay_refund_id) WHERE razorpay_refund_id <> ''`,
    ];
    for (const stmt of stmts) {
      try {
        await this.sequelize.query(stmt, { type: QueryTypes.RAW });
      } catch (err) {
        console.log(`[DB] search index skipped: ${err.message}`);
      }
    }
  }
}

export async function loadHandlerModules() {
  for (const name of HANDLER_MODULES) {
    try {
      const mod = await import(`./${name}.js`);
      Object.assign(Handler.prototype, mod);
    } catch (err) {
      if (err.code === "ERR_MODULE_NOT_FOUND") continue;
      throw err;
    }
  }
}

export async function createHandler(sequelize, cfg, redis, imageService) {
  await loadHandlerModules();
  let shiprocket = null;
  try {
    const mod = await import("../shiprocket/client.js");
    if (typeof mod.createClient === "function") {
      shiprocket = mod.createClient(cfg.shiprocketEmail, cfg.shiprocketPassword, cfg.shiprocketToken);
    }
  } catch (err) {
    if (err.code !== "ERR_MODULE_NOT_FOUND") throw err;
  }
  return new Handler(sequelize, cfg, redis, imageService, shiprocket);
}
