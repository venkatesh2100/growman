// Delivery options and the price the customer pays to receive an order.
//
// The cart is priced from the database, then the fulfillment engine offers
// store pickup, our own vehicle, or a courier. Courier cost can come from a
// live Shiprocket lookup; if that lookup is down, the fee bands in config
// are used instead. Checkout calls resolveOrderFulfillment so the amount
// charged matches the quote, including the optional gift-wrap fee.
// A bulk order is quoted by sales and cannot be paid here.

import { Op } from "sequelize";
import { json, error, decode } from "../../pkg/httpjson/httpjson.js";
import { fulfillmentPolicy } from "../config/config.js";
import * as engine from "../fulfillment/fulfillment.js";
import { Product, ProductSize } from "../models/index.js";

// A cart may have at most this many lines, and each line at most this many units.
const maxCartLines = 100;
const maxLineQuantity = 1000;
// A Shiprocket serviceability answer is reused for six hours.
const courierLookupTTLSec = 6 * 60 * 60;
// Checkout accepts the client's amount when it is within one rupee of our quote.
const amountTolerance = 1;
// Gift wrap is a flat fee added on top of goods and delivery.
const giftWrapFee = 49;

// These three channels can be paid at checkout. Bulk quote is handled by sales.
const payableChannels = new Set([engine.ChannelStorePickup, engine.ChannelCourier, engine.ChannelOwnVehicle]);

const SHIPROCKET_NOT_CONFIGURED = "shiprocket credentials not configured";
const SHIPROCKET_CIRCUIT = "lookups paused after repeated failures";

// The public quote hides what we pay the courier. Empty delivery-day estimates are omitted.
function publicQuote(quote) {
  const copy = { ...quote, options: (quote.options || []).map((option) => ({ ...option })) };
  delete copy.courierCost;
  delete copy.courierName;
  if (!copy.estimatedDeliveryDays) delete copy.estimatedDeliveryDays;
  return copy;
}

// The destination is a pincode, plus a map pin when both coordinates are real.
// A missing pin, a pin outside the valid range, or the 0,0 ocean point is ignored.
function destinationFrom(raw) {
  const dest = { pincode: raw?.pincode || "" };
  const lat = raw?.latitude;
  const lng = raw?.longitude;
  if (
    lat != null &&
    lng != null &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0)
  ) {
    dest.lat = lat;
    dest.lng = lng;
  }
  return dest;
}

// Load each cart line's price, size class, and bulky flag from the catalog.
// A chosen size replaces the product price and, when set, the size class and bulky flag.
// Returns the priced lines, or null after writing the error response.
export async function resolveCart(req, res, items) {
  if (!items || items.length === 0) {
    error(res, 400, "cart is empty");
    return null;
  }
  if (items.length > maxCartLines) {
    error(res, 400, "too many items in cart");
    return null;
  }
  const productIds = [];
  const sizeIds = [];
  for (const item of items) {
    if (item.quantity < 1 || item.quantity > maxLineQuantity) {
      error(res, 400, "invalid item quantity");
      return null;
    }
    productIds.push(item.productId);
    if (item.productSizeId != null) sizeIds.push(item.productSizeId);
  }
  let products;
  try {
    products = await Product.findAll({
      attributes: ["id", "price", "sizeClass", "bulky"],
      where: { id: { [Op.in]: productIds } },
    });
  } catch (err) {
    console.log(`[FULFILLMENT] fetch products: ${err.message}`);
    error(res, 500, "failed to price cart");
    return null;
  }
  const productById = new Map(products.map((product) => [Number(product.id), product]));
  const sizeById = new Map();
  if (sizeIds.length) {
    let sizes;
    try {
      // A size only counts when it belongs to one of the products in this cart.
      sizes = await ProductSize.findAll({
        attributes: ["id", "productId", "price", "sizeClass", "bulky"],
        where: { id: { [Op.in]: sizeIds }, productId: { [Op.in]: productIds } },
      });
    } catch (err) {
      console.log(`[FULFILLMENT] fetch product sizes: ${err.message}`);
      error(res, 500, "failed to price cart");
      return null;
    }
    for (const size of sizes) sizeById.set(Number(size.id), size);
  }
  const lines = [];
  for (const item of items) {
    const product = productById.get(Number(item.productId));
    if (!product) {
      error(res, 400, `product with ID ${item.productId} not found`);
      return null;
    }
    let price = product.price;
    let sizeClass = product.sizeClass;
    let bulky = Boolean(product.bulky);
    if (item.productSizeId != null) {
      const size = sizeById.get(Number(item.productSizeId));
      if (!size || Number(size.productId) !== Number(item.productId)) {
        error(res, 400, `product size with ID ${item.productSizeId} not found for product ${item.productId}`);
        return null;
      }
      price = size.price;
      if (size.sizeClass != null) sizeClass = size.sizeClass;
      if (size.bulky != null) bulky = Boolean(size.bulky);
    }
    lines.push({ sizeClass, bulky, quantity: item.quantity, unitPrice: price });
  }
  return lines;
}

// A missing courier login, or a paused lookup after repeated failures, is not worth a log line.
function quietCourierError(err) {
  const msg = String(err?.message || "");
  return msg.includes(SHIPROCKET_NOT_CONFIGURED) || msg.includes(SHIPROCKET_CIRCUIT);
}

// Live courier rate for this pincode and parcel weight.
// A cache hit returns the stored answer. A timeout or error returns an empty object so fee bands are used.
export async function courierQuote(lines, policy, pincode) {
  if (!this.shiprocket || !this.cfg.storePincode || !pincode) return {};
  const weight = engine.estimatedWeightKg(policy, lines);
  // Weight is rounded up to the next half kilogram so nearby carts share one cache entry.
  const bucket = Math.ceil(weight * 2) / 2;
  const cacheKey = `courier:serviceability:${this.cfg.storePincode}:${pincode}:${bucket.toFixed(1)}`;
  if (this.redis) {
    try {
      const raw = await this.redis.get(cacheKey);
      // Cache hit: the stored Shiprocket answer is still inside the six-hour window.
      if (raw) return JSON.parse(raw);
    } catch {
      /* miss */
    }
  }
  let rate;
  try {
    // The lookup is abandoned after four seconds so checkout does not wait on the courier.
    rate = await Promise.race([
      this.shiprocket.checkServiceability({
        pickupPincode: this.cfg.storePincode,
        deliveryPincode: pincode,
        weightKg: bucket,
        declaredValue: engine.cartSubtotal(lines),
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000)),
    ]);
  } catch (err) {
    if (!quietCourierError(err)) {
      console.log(`[COURIER] serviceability lookup for ${pincode} failed, falling back to fee bands: ${err.message}`);
    }
    return {};
  }
  const result = {
    checked: true,
    serviceable: Boolean(rate.serviceable ?? rate.Serviceable),
    rateINR: Number(rate.rateINR ?? rate.RateINR ?? 0),
    courierName: rate.courierName ?? rate.CourierName ?? "",
    estimatedDays: Number(rate.estimatedDays ?? rate.EstimatedDays ?? 0),
  };
  if (this.redis) {
    this.redis.set(cacheKey, JSON.stringify(result), "EX", courierLookupTTLSec).catch(() => {});
  }
  return result;
}

// Quote the cart. If the courier option is open, ask Shiprocket and quote a second time with that rate.
export async function quoteCart(lines, policy, dest) {
  let quote = engine.quoteWith(policy, lines, dest, {});
  const opt = engine.quoteOption(quote, engine.ChannelCourier);
  if (!opt || !opt.available) return quote;
  const courier = await this.courierQuote(lines, policy, dest.pincode || "");
  // No live answer: keep the first quote, which uses the configured fee bands.
  if (!courier.checked) return quote;
  return engine.quoteWith(policy, lines, dest, courier);
}

// Public delivery quote for the cart the browser sent.
export async function quoteFulfillment(req, res) {
  const body = decode(req, res);
  if (!body) return;
  const lines = await this.resolveCart(req, res, body.items);
  if (!lines) return;
  const policy = fulfillmentPolicy(this.cfg);
  const quote = await this.quoteCart(lines, policy, destinationFrom(body.destination));
  json(res, 200, { quote: publicQuote(quote), courierProvider: policy.courierProvider });
}

// Checkout uses this to lock the delivery channel and the amount to charge.
// The channel must be one the customer can pay for, it must still be available, and the amount must match the quote.
// Returns the priced fulfillment, or null after writing the error response.
export async function resolveOrderFulfillment(req, res, payload) {
  if (!payload.fulfillmentChannel) {
    json(res, 400, {
      error: "fulfillment_channel_required",
      reason: "Choose a delivery option before placing the order.",
    });
    return null;
  }
  const channel = payload.fulfillmentChannel;
  if (!payableChannels.has(channel)) {
    if (channel === engine.ChannelBulkQuote) {
      error(res, 400, "bulk orders are quoted by sales, not paid at checkout");
      return null;
    }
    error(res, 400, "unknown fulfillment channel");
    return null;
  }
  const lines = await this.resolveCart(req, res, payload.items);
  if (!lines) return null;
  const policy = fulfillmentPolicy(this.cfg);
  const quote = await this.quoteCart(
    lines,
    policy,
    destinationFrom({
      latitude: payload.latitude,
      longitude: payload.longitude,
      pincode: payload.customer?.pincode,
    }),
  );
  const opt = engine.quoteOption(quote, channel);
  // The chosen option can be closed by distance, pincode, or a courier that does not serve the address.
  if (!opt || !opt.available) {
    json(res, 409, { error: "channel_unavailable", reason: opt?.reason || "", quote: publicQuote(quote) });
    return null;
  }
  const gift = payload.giftWrap ? giftWrapFee : 0;
  const expected = quote.subtotal + opt.fee + gift;
  // The browser's amount must match goods plus delivery plus gift wrap, within one rupee.
  if (Math.abs(Number(payload.amount) - expected) > amountTolerance) {
    json(res, 409, { error: "amount_mismatch", expectedAmount: expected, quote: publicQuote(quote) });
    return null;
  }
  payload.amount = expected;
  const result = {
    channel,
    zone: quote.zone,
    subtotal: quote.subtotal,
    fee: opt.fee,
    feeWaived: Boolean(opt.feeWaived),
    distanceKm: quote.distanceKm ?? null,
    distanceSource: quote.distanceSource || "",
    courierProvider: "",
    courierService: "",
    courierCost: null,
    giftFee: gift,
  };
  // Courier name and our cost are stored only when the order is actually going by courier.
  if (channel === engine.ChannelCourier) {
    result.courierProvider = policy.courierProvider;
    result.courierService = quote.courierName || "";
    if (quote.courierCost != null) result.courierCost = quote.courierCost;
  }
  return result;
}
