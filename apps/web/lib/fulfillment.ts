import { apiFetch } from "./api";
import { UserFacingError } from "./errors";
import type { CartItem } from "./store/cartStore";

/**
 * Delivery quoting for checkout. Mirrors the backend rules engine in
 * apps/go-backend/internal/fulfillment: the server decides which channels a
 * cart can use and what each costs, and refuses an order whose amount does
 * not match its own arithmetic. Nothing here recomputes a fee — this module
 * only asks and renders.
 */

export type FulfillmentChannel =
  | "store_pickup"
  | "courier"
  | "own_vehicle"
  | "bulk_quote";

export type DeliveryZone =
  | "store_local"
  | "near"
  | "mid"
  | "far"
  | "outside"
  | "unknown";

export interface FulfillmentOption {
  channel: FulfillmentChannel;
  available: boolean;
  label: string;
  fee: number;
  feeWaived: boolean;
  reason?: string;
}

export interface FulfillmentQuote {
  zone: DeliveryZone;
  distanceKm: number | null;
  distanceSource: "coordinates" | "pincode" | "none";
  subtotal: number;
  units: number;
  maxSizeClass: "small" | "medium" | "large" | "xl";
  options: FulfillmentOption[];
  recommended: FulfillmentChannel;
  storeVisitSuggested: boolean;
  bulkRequired: boolean;
  amountForFreeDelivery: number;
  estimatedDeliveryDays?: number;
}

export interface QuoteDestination {
  pincode: string;
  latitude?: number;
  longitude?: number;
}

/** The line-item shape both /checkout/quote and /checkout/create-order take. */
export function toOrderItems(cart: CartItem[]) {
  return cart
    .filter((item) => item.productId && item.productId > 0)
    .map((item) => ({
      productId: item.productId,
      productSizeId: item.productSizeId,
      quantity: item.quantity,
      price: item.price,
    }));
}

/**
 * Fetches delivery options for a cart and destination. Pass a signal so a
 * quote made obsolete by further typing can be dropped.
 */
export async function fetchDeliveryQuote(
  cart: CartItem[],
  destination: QuoteDestination,
  signal?: AbortSignal,
): Promise<FulfillmentQuote> {
  const res = await apiFetch("/checkout/quote", {
    method: "POST",
    signal,
    body: JSON.stringify({
      items: toOrderItems(cart),
      destination: {
        pincode: destination.pincode,
        latitude: destination.latitude,
        longitude: destination.longitude,
      },
    }),
  });
  if (!res.ok) {
    throw new UserFacingError("Couldn't check delivery for this address.");
  }
  const data = (await res.json()) as { quote: FulfillmentQuote };
  return data.quote;
}

export function findOption(
  quote: FulfillmentQuote | null,
  channel: FulfillmentChannel,
): FulfillmentOption | undefined {
  return quote?.options.find((option) => option.channel === channel);
}

/** Channels the customer can pay for here; a bulk quote is priced by sales. */
export const payableChannels: FulfillmentChannel[] = [
  "store_pickup",
  "courier",
  "own_vehicle",
];

export function isPayable(channel: FulfillmentChannel): boolean {
  return payableChannels.includes(channel);
}

/** Channels that actually bring the plants to the customer. */
const deliveryChannels: FulfillmentChannel[] = ["courier", "own_vehicle"];

/**
 * Picks the delivery the customer gets, with no option list to choose from.
 *
 * Store pickup is deliberately never picked: it is free, so auto-applying
 * it would quietly turn a delivery order into a collection one. An address
 * with no delivery available returns null, which checkout reads as "this
 * order needs a quote".
 */
export function pickDeliveryOption(
  quote: FulfillmentQuote | null,
): FulfillmentOption | null {
  if (!quote) return null;

  const available = quote.options.filter(
    (option) => option.available && deliveryChannels.includes(option.channel),
  );
  if (available.length === 0) return null;

  // The server's recommendation already accounts for plant size and load,
  // so prefer it and only fall back to the cheapest.
  const recommended = available.find(
    (option) => option.channel === quote.recommended,
  );
  return (
    recommended ??
    available.reduce((cheapest, option) =>
      option.fee < cheapest.fee ? option : cheapest,
    )
  );
}
