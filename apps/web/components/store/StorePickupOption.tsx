"use client";

import Link from "next/link";
import { useState } from "react";
import { FileText, Phone, Store } from "lucide-react";
import { business } from "../../lib/seo/site";
import { useCartStore } from "../../lib/store/cartStore";
import StorePickupDialog from "./StorePickupDialog";

/**
 * "Pick up at store" alternative to paying online, plus the two other ways the
 * nursery takes an order: a phone call and a bulk quotation.
 *
 * Rendered under the pay action on both the cart and checkout so the same three
 * routes are offered wherever a shopper hesitates. The cart is left untouched
 * when a pickup request is sent — nothing has been paid, so the shopper can
 * still check out online if they change their mind.
 */
export default function StorePickupOption({ className = "" }: { className?: string }) {
  const items = useCartStore((state) => state.items);
  const [open, setOpen] = useState(false);

  return (
    <div className={className}>
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-gray-200" />
        <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
          or
        </span>
        <span className="h-px flex-1 bg-gray-200" />
      </div>

      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={items.length === 0}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-600 bg-white py-2.5 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 active:bg-emerald-100 disabled:opacity-50 touch-manipulation sm:py-3 sm:text-base"
      >
        <Store className="h-4 w-4 sm:h-5 sm:w-5" />
        Pick up at store
      </button>
      <p className="mt-2 text-[11px] text-gray-500 sm:text-xs">
        We set your plants aside at our {business.address.locality} nursery for
        you to visit and collect. Nothing is paid online — the store calls you to
        confirm the amount and a time.
      </p>

      <div className="mt-3 flex flex-col gap-1.5 text-xs sm:text-sm">
        <a
          href={`tel:${business.telephone}`}
          className="inline-flex items-center gap-1.5 font-medium text-emerald-700 hover:text-emerald-800"
        >
          <Phone className="h-3.5 w-3.5" />
          Contact us about this order
        </a>
        <Link
          href="/bulk"
          className="inline-flex items-center gap-1.5 font-medium text-emerald-700 hover:text-emerald-800"
        >
          <FileText className="h-3.5 w-3.5" />
          Buying in bulk? Request a quotation
        </Link>
      </div>

      {open ? (
        <StorePickupDialog items={items} onClose={() => setOpen(false)} />
      ) : null}
    </div>
  );
}
