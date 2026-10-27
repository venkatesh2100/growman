// Delivery quote for a cart: zone, fees, and which channels the shopper can pick.
// Checkout calls quote or quoteWith with the cart lines and the destination.
// A quote lists store pickup, courier, Growman van, and a bulk quote. One of them is recommended.
// Money is in rupees. Distances are kilometres from the Hyderabad store.

import { centroidForPincode, cityPincode, serviceablePincode } from "./pincode.js";

export const SizeSmall = "small";
export const SizeMedium = "medium";
export const SizeLarge = "large";
export const SizeXL = "xl";

const sizeRank = { [SizeSmall]: 0, [SizeMedium]: 1, [SizeLarge]: 2, [SizeXL]: 3 };

// Cart lines and product sizes call this. Unknown or blank text is treated as small, the cheapest and easiest to ship.
export function normalizeSize(s) {
  switch (String(s ?? "").trim().toLowerCase()) {
    case SizeMedium:
      return SizeMedium;
    case SizeLarge:
      return SizeLarge;
    case SizeXL:
      return SizeXL;
    default:
      return SizeSmall;
  }
}

// 0 for small through 3 for xl. Used to compare a cart against the courier size cap.
export function sizeRankOf(s) {
  return sizeRank[normalizeSize(s)];
}

// The shopper collects the plants. Fee is always zero.
export const ChannelStorePickup = "store_pickup";
// Shiprocket or another courier. Only smaller carts qualify.
export const ChannelCourier = "courier";
// The nursery's own van. Needs a minimum order value.
export const ChannelOwnVehicle = "own_vehicle";
// Too big, too far, or too many plants. Staff send a price instead of charging a fee here.
export const ChannelBulkQuote = "bulk_quote";

// Rings around the store, nearest first.
export const ZoneStoreLocal = "store_local";
export const ZoneNear = "near";
export const ZoneMid = "mid";
export const ZoneFar = "far";
// Past the farthest ring, or a pin we do not deliver to. Retail delivery is refused.
export const ZoneOutside = "outside";
// A serviceable pin we cannot place on the map. Quoted as the far ring, not as a refusal.
export const ZoneUnknown = "unknown";

const zoneRank = {
  [ZoneStoreLocal]: 0,
  [ZoneNear]: 1,
  [ZoneMid]: 2,
  [ZoneFar]: 3,
  [ZoneOutside]: 4,
};

// Unknown is priced like far, not like outside. A missing zone is treated as the store itself.
export function zoneRankOf(z) {
  if (z === ZoneUnknown) return zoneRank[ZoneFar];
  return zoneRank[z] ?? 0;
}

// Outside is the only zone that cannot be delivered. Unknown still can.
export function zoneDeliverable(z) {
  return z !== ZoneOutside;
}

// Reads a zone the client sent back. Only the four retail rings are accepted. Anything else is "".
export function parseZone(s) {
  const z = String(s ?? "").trim().toLowerCase();
  if ([ZoneStoreLocal, ZoneNear, ZoneMid, ZoneFar].includes(z)) return z;
  return "";
}

// How the distance was measured. Coordinates are GPS. Pincode is a known centroid. Prefix is a Hyderabad pin with no centroid.
export const SourceCoordinates = "coordinates";
export const SourcePincode = "pincode";
export const SourcePincodePrefix = "pincode_prefix";
export const SourceNone = "none";

// Sum of unit price times quantity. A missing cart is zero, not an error.
export function cartSubtotal(items) {
  return (items ?? []).reduce((sum, it) => sum + Number(it.unitPrice || 0) * Number(it.quantity || 0), 0);
}

// How many plants are in the cart. Courier refuses a cart over its unit cap.
export function cartUnits(items) {
  return (items ?? []).reduce((sum, it) => sum + Number(it.quantity || 0), 0);
}

// The largest size class in the cart. One xl plant makes the whole cart xl.
export function cartMaxSize(items) {
  let max = SizeSmall;
  for (const it of items ?? []) {
    const size = normalizeSize(it.sizeClass);
    if (sizeRankOf(size) > sizeRankOf(max)) max = size;
  }
  return max;
}

// True when any line is flagged bulky. Bulky plants cannot go by courier.
export function cartHasBulky(items) {
  return (items ?? []).some((it) => Boolean(it.bulky));
}

// The nursery's default rings, fees, and cutoffs. Checkout uses this unless a saved policy replaces it.
// Distances are from the Hyderabad store. Fees are rupees. Free delivery is off until a minimum is set above zero.
export function defaultPolicy() {
  return {
    storeLat: 17.385,
    storeLng: 78.4867,
    storeLocalMaxKm: 10,
    nearMaxKm: 20,
    midMaxKm: 30,
    farMaxKm: 50,
    retailMaxZone: ZoneFar,
    courierProvider: "Shiprocket",
    courierFeeByZone: {
      [ZoneStoreLocal]: 59,
      [ZoneNear]: 99,
      [ZoneMid]: 129,
      [ZoneFar]: 179,
    },
    courierMaxSizeClass: SizeMedium,
    courierMaxUnits: 8,
    weightKgBySizeClass: {
      [SizeSmall]: 1.5,
      [SizeMedium]: 4,
      [SizeLarge]: 12,
      [SizeXL]: 30,
    },
    ownVehicleFeeByZone: {
      [ZoneStoreLocal]: 299,
      [ZoneNear]: 399,
      [ZoneMid]: 549,
      [ZoneFar]: 799,
    },
    ownVehicleMinSubtotal: 2500,
    freeDeliveryMinSubtotal: 0,
    freeDeliveryMaxZone: ZoneNear,
    bulkMinUnits: 10,
    bulkMinSubtotal: 15000,
  };
}

// Parcel weight for Shiprocket. Each line adds its size weight times quantity. Rounded to paise-style 2 decimals.
export function estimatedWeightKg(policy, items) {
  let kg = 0;
  for (const it of items ?? []) {
    kg += (policy.weightKgBySizeClass[normalizeSize(it.sizeClass)] || 0) * Number(it.quantity || 0);
  }
  return round2(kg);
}

// The option object for one channel, or null if the quote has no such option.
export function quoteOption(quote, channel) {
  return (quote.options ?? []).find((o) => o.channel === channel) ?? null;
}

// Fee the shopper pays for that channel, and whether it can be selected.
// A missing channel is { fee: 0, ok: false }, which checkout treats as "not offered".
export function quoteFee(quote, channel) {
  const opt = quoteOption(quote, channel);
  if (!opt) return { fee: 0, ok: false };
  return { fee: opt.fee, ok: opt.available };
}

// Kilometres between two lat/lng points. Used for the store-to-customer distance.
function haversineKm(lat1, lng1, lat2, lng2) {
  const earth = 6371;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return earth * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function radians(deg) {
  return (deg * Math.PI) / 180;
}

// Rupees to two decimals, so 99.005 does not become a long float on the order.
function round2(v) {
  return Math.round(v * 100) / 100;
}

// Which ring a distance falls in. Past farMaxKm the address is outside retail delivery.
function zoneForKm(policy, km) {
  if (km <= policy.storeLocalMaxKm) return ZoneStoreLocal;
  if (km <= policy.nearMaxKm) return ZoneNear;
  if (km <= policy.midMaxKm) return ZoneMid;
  if (km <= policy.farMaxKm) return ZoneFar;
  return ZoneOutside;
}

// Places the destination in a zone. Checkout calls this before it offers a fee.
// GPS wins. A known pin centroid is next. A Hyderabad pin with no centroid is mid.
// A pin outside 500/501/502 is outside. Any other serviceable pin is unknown and priced as far.
export function resolveZone(policy, dest) {
  if (dest?.lat != null && dest?.lng != null) {
    const dist = haversineKm(policy.storeLat, policy.storeLng, dest.lat, dest.lng);
    return { km: dist, zone: zoneForKm(policy, dist), source: SourceCoordinates };
  }
  const centroid = centroidForPincode(dest?.pincode);
  if (centroid) {
    const dist = haversineKm(policy.storeLat, policy.storeLng, centroid.lat, centroid.lng);
    return { km: dist, zone: zoneForKm(policy, dist), source: SourcePincode };
  }
  if (cityPincode(dest?.pincode)) return { km: null, zone: ZoneMid, source: SourcePincodePrefix };
  if (!serviceablePincode(dest?.pincode)) return { km: null, zone: ZoneOutside, source: SourceNone };
  return { km: null, zone: ZoneUnknown, source: SourceNone };
}

// True when the zone is inside the farthest ring the shop still delivers to.
function withinRetailRange(policy, zone) {
  if (zone === ZoneUnknown || !zoneDeliverable(zone)) return false;
  return zoneRankOf(zone) <= zoneRankOf(policy.retailMaxZone);
}

// Free courier delivery only applies when a minimum is configured and the zone is close enough.
function freeDeliveryApplies(policy, zone) {
  return policy.freeDeliveryMinSubtotal > 0 && zoneDeliverable(zone) && zoneRankOf(zone) <= zoneRankOf(policy.freeDeliveryMaxZone);
}

// Always available and free. The shopper can come to the nursery even when delivery is refused.
function storePickupOption() {
  return { channel: ChannelStorePickup, label: "Visit Store", available: true, fee: 0, feeWaived: false, reason: "" };
}

// Home delivery by courier. Unavailable, with a reason, when the cart is bulky, large, too many plants, or too far.
// An unknown zone is charged the far-zone fee. A waived fee is labeled FREE Delivery.
function courierOption(policy, items, zone, bulkRequired, courierQuote) {
  const opt = { channel: ChannelCourier, label: "Home Delivery", available: false, fee: 0, feeWaived: false, reason: "" };
  let fee = policy.courierFeeByZone[zone];
  if (zone === ZoneUnknown) fee = policy.courierFeeByZone[ZoneFar];
  // The first matching reason wins. Later checks are skipped so the shopper sees one explanation.
  if (bulkRequired) opt.reason = "bulk_order";
  else if (!withinRetailRange(policy, zone)) opt.reason = "outside_delivery_radius";
  else if (courierQuote?.checked && !courierQuote.serviceable) opt.reason = "courier_not_serviceable";
  else if (cartHasBulky(items)) opt.reason = "item_too_bulky";
  else if (sizeRankOf(cartMaxSize(items)) > sizeRankOf(policy.courierMaxSizeClass)) opt.reason = "plant_too_large";
  else if (cartUnits(items) > policy.courierMaxUnits) opt.reason = "too_many_plants";
  else {
    opt.available = true;
    opt.fee = round2(fee || 0);
    if (freeDeliveryApplies(policy, zone) && cartSubtotal(items) >= policy.freeDeliveryMinSubtotal) {
      opt.fee = 0;
      opt.feeWaived = true;
      opt.label = "FREE Delivery";
    }
  }
  if (!opt.reason) delete opt.reason;
  else if (!opt.available) {
    /* keep reason */
  }
  if (!opt.reason) opt.reason = undefined;
  return cleanOption(opt);
}

// Nursery van. Refused for bulk carts, addresses outside the retail rings, and orders under the minimum.
// An unknown zone pays the far-zone van fee. There is no free-delivery waiver on this channel.
function ownVehicleOption(policy, items, zone, bulkRequired) {
  const opt = { channel: ChannelOwnVehicle, label: "Growman Delivery", available: false, fee: 0, feeWaived: false };
  if (bulkRequired) opt.reason = "bulk_order";
  else if (!withinRetailRange(policy, zone)) opt.reason = "outside_delivery_radius";
  else if (cartSubtotal(items) < policy.ownVehicleMinSubtotal) opt.reason = "below_minimum_order";
  else {
    let fee = policy.ownVehicleFeeByZone[zone];
    if (zone === ZoneUnknown) fee = policy.ownVehicleFeeByZone[ZoneFar];
    opt.available = true;
    opt.fee = round2(fee || 0);
  }
  return cleanOption(opt);
}

// Always offered. When the cart is not actually bulk, the reason is blank and then removed.
function bulkQuoteOption(bulkRequired) {
  return cleanOption({
    channel: ChannelBulkQuote,
    label: "Get Bulk Quote",
    available: true,
    fee: 0,
    feeWaived: false,
    reason: bulkRequired ? "quote_required" : "",
  });
}

// Drop an empty reason so the JSON does not say reason: "".
function cleanOption(opt) {
  if (!opt.reason) delete opt.reason;
  return opt;
}

// Full quote, including a Shiprocket answer when checkout already asked. courierQuote may be {}.
// Returns the zone, the cart totals, four options, and the channel the app should highlight.
export function quoteWith(policy, items, dest, courierQuote = {}) {
  const resolved = resolveZone(policy, dest);
  const subtotal = cartSubtotal(items);
  const units = cartUnits(items);
  const maxSizeClass = cartMaxSize(items);
  // Bulk means staff must quote: too many plants, a high subtotal, an xl plant, or an address we do not deliver to.
  const bulkRequired =
    units >= policy.bulkMinUnits ||
    subtotal >= policy.bulkMinSubtotal ||
    maxSizeClass === SizeXL ||
    !withinRetailRange(policy, resolved.zone);

  const pickup = storePickupOption();
  const courier = courierOption(policy, items, resolved.zone, bulkRequired, courierQuote);
  const own = ownVehicleOption(policy, items, resolved.zone, bulkRequired);
  const bulk = bulkQuoteOption(bulkRequired);

  const q = {
    zone: resolved.zone,
    distanceKm: resolved.km,
    distanceSource: resolved.source,
    subtotal,
    units,
    maxSizeClass,
    bulkRequired,
    options: [pickup, courier, own, bulk],
    recommended: ChannelBulkQuote,
    storeVisitSuggested: false,
    amountForFreeDelivery: 0,
    estimatedDeliveryDays: 0,
  };

  // Prefer a bulk quote when required, then store pickup for the closest ring, then courier, then the van.
  if (bulkRequired) q.recommended = ChannelBulkQuote;
  else if (resolved.zone === ZoneStoreLocal && pickup.available) q.recommended = ChannelStorePickup;
  else if (courier.available) q.recommended = ChannelCourier;
  else if (own.available) q.recommended = ChannelOwnVehicle;
  else if (pickup.available) q.recommended = ChannelStorePickup;
  else q.recommended = ChannelBulkQuote;

  // Suggest a visit when the address is in the near ring or closer and pickup is open.
  q.storeVisitSuggested = pickup.available && zoneRankOf(resolved.zone) <= zoneRankOf(ZoneNear);

  // How much more the cart needs before courier delivery becomes free. Zero when free delivery does not apply.
  if (freeDeliveryApplies(policy, resolved.zone) && courier.available && !courier.feeWaived) {
    const gap = policy.freeDeliveryMinSubtotal - subtotal;
    if (gap > 0) q.amountForFreeDelivery = round2(gap);
  }

  // Courier cost and name stay off the JSON the shopper sees. Days are shown when Shiprocket sent them.
  if (courier.available && courierQuote?.checked && courierQuote.serviceable) {
    Object.defineProperty(q, "courierCost", { value: round2(courierQuote.rateINR), enumerable: false });
    Object.defineProperty(q, "courierName", { value: courierQuote.courierName || "", enumerable: false });
    if (courierQuote.estimatedDays) q.estimatedDeliveryDays = courierQuote.estimatedDays;
  }
  if (!q.estimatedDeliveryDays) delete q.estimatedDeliveryDays;

  return q;
}

// Quote without a live courier check. Checkout calls quoteWith once Shiprocket has answered.
export function quote(policy, items, dest) {
  return quoteWith(policy, items, dest, {});
}

export { haversineKm };
