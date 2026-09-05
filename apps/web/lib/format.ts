/** Format a price as a rupee amount with no decimals, e.g. `₹499`. */
export function formatPrice(value: number | null | undefined): string {
  const n = Number(value);
  return `₹${Number.isFinite(n) ? n.toFixed(0) : "0"}`;
}

export interface DiscountInfo {
  /** The MRP to show struck through, or null if there's no valid discount. */
  effectiveMrp: number | null;
  hasDiscount: boolean;
  /** Rounded percentage off, 0 when there's no discount. */
  percent: number;
}

/** Compare a selling price against an MRP and derive the discount to display, if any. */
export function getDiscount(
  price: number | null | undefined,
  mrp: number | null | undefined
): DiscountInfo {
  const numericPrice = Number(price);
  const numericMrp = Number(mrp);
  const validPrice = Number.isFinite(numericPrice) ? numericPrice : null;
  const effectiveMrp = Number.isFinite(numericMrp) && numericMrp > 0 ? numericMrp : null;

  const hasDiscount =
    effectiveMrp !== null && validPrice !== null && validPrice > 0 && effectiveMrp > validPrice;

  const percent = hasDiscount ? Math.round((1 - (validPrice as number) / (effectiveMrp as number)) * 100) : 0;

  return { effectiveMrp, hasDiscount, percent };
}
