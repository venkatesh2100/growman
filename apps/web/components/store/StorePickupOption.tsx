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
        <span className="h-px flex-1 bg-emerald-100" />
        <span className="text-[11px] font-medium tracking-wide text-gray-400 uppercase">
          or
        </span>
        <span className="h-px flex-1 bg-emerald-100" />
      </div>

      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={items.length === 0}
        className="mt-3 flex w-full touch-manipulation items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white py-2.5 text-sm font-semibold text-green-900 transition-colors hover:bg-emerald-50/60 disabled:opacity-50"
      >
        <Store className="h-4 w-4 text-emerald-700" />
        Pick up at the nursery
      </button>
      <p className="mt-2 text-xs text-gray-500">
        We set your plants aside at our {business.address.locality} nursery.
        Nothing is paid online: the store calls you to confirm the amount and a
        pickup time.
      </p>

      <div className="mt-4 flex flex-col gap-2 border-t border-emerald-50 pt-4 text-sm">
        <a
          href={`tel:${business.telephone}`}
          className="inline-flex items-center gap-2 font-medium text-emerald-700 hover:text-emerald-900"
        >
          <Phone className="h-3.5 w-3.5" />
          Call us about this order
        </a>
        <Link
          href="/bulk"
          className="inline-flex items-center gap-2 font-medium text-emerald-700 hover:text-emerald-900"
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
