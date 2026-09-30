import Link from "next/link";
import type { ProductSize } from "../../../lib/types";
import { formatPrice } from "../../../lib/format";

export default function SizeSelector({
  sizes,
  selectedSize,
  productSlug,
}: {
  sizes: ProductSize[];
  selectedSize: ProductSize;
  productSlug: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {sizes.map((size) => {
        const selected = selectedSize.id === size.id;
        const soldOut = size.stock <= 0;
        return (
          <Link
            key={size.id}
            href={`/product/${productSlug}?size=${size.id}`}
            scroll={false}
            replace
            aria-current={selected ? "true" : undefined}
            className={`rounded-xl border px-3 py-2.5 transition-colors ${
              selected
                ? "border-emerald-700 bg-emerald-50/60 ring-1 ring-emerald-700"
                : "border-emerald-100 bg-white hover:border-emerald-300"
            }`}
          >
            <span className={`block text-sm font-medium ${soldOut ? "text-gray-400" : "text-green-900"}`}>
              {size.label}
            </span>
            {size.dimension ? (
              <span className="block text-xs text-gray-500">{size.dimension}</span>
            ) : null}
            <span className="mt-1 block text-sm font-semibold text-green-900">
              {formatPrice(size.price)}
            </span>
            {soldOut ? <span className="block text-xs text-gray-500">Out of stock</span> : null}
          </Link>
        );
      })}
    </div>
  );
}
