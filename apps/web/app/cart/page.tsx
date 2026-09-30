"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Minus, Plus, ShieldCheck, ShoppingBag } from "lucide-react";
import { useCartStore } from "../../lib/store/cartStore";
import { formatPrice } from "../../lib/format";
import Thumbnail from "../../components/ui/Thumbnail";
import ButtonLink from "../../components/ui/ButtonLink";
import StorePickupOption from "../../components/store/StorePickupOption";

export default function CartPage() {
  const cart = useCartStore((state) => state.items);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const removeItem = useCartStore((state) => state.removeItem);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(true);
  }, []);

  if (!loaded) {
    return <div className="min-h-[70vh]" />;
  }

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  // Savings against MRP, only where the product actually lists one above its price.
  const savings = cart.reduce(
    (sum, item) =>
      item.mrp && item.mrp > item.price ? sum + (item.mrp - item.price) * item.quantity : sum,
    0
  );

  if (cart.length === 0) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-emerald-100 bg-white p-8 text-center sm:p-10">
          <ShoppingBag className="mx-auto mb-4 h-10 w-10 text-gray-400" />
          <h1 className="mb-2 font-space text-xl font-semibold text-green-900 sm:text-2xl">
            Your cart is empty
          </h1>
          <p className="mb-6 text-sm text-gray-600">
            Browse the catalog and add plants to see them here.
          </p>
          <ButtonLink href="/shop" className="w-full">
            Browse plants
          </ButtonLink>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[70vh] pb-28 lg:pb-0">
      <div className="mx-auto max-w-6xl px-4 pt-6 pb-16 sm:px-6 sm:pt-8 lg:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-space text-2xl font-semibold tracking-tight text-green-900 sm:text-3xl">
              Cart
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              {itemCount} {itemCount === 1 ? "item" : "items"}
            </p>
          </div>
          <Link
            href="/shop"
            className="text-sm font-medium text-emerald-700 hover:text-emerald-900"
          >
            Continue shopping
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
          <section aria-label="Items in your cart">
            <ul className="divide-y divide-emerald-50 rounded-2xl border border-emerald-100 bg-white">
              {cart.map((item) => (
                <li key={item.id} className="flex gap-4 p-4 sm:p-5">
                  <Thumbnail
                    src={item.image}
                    size={96}
                    alt={item.name}
                    className="h-20 w-20 rounded-xl sm:h-24 sm:w-24"
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="line-clamp-2 text-sm font-semibold text-green-900 sm:text-base">
                          {item.name}
                        </h2>
                        {item.label ? (
                          <p className="mt-0.5 text-xs text-gray-500 sm:text-sm">{item.label}</p>
                        ) : null}
                        <p className="mt-1 flex items-baseline gap-1.5 text-sm">
                          <span className="text-gray-700">{formatPrice(item.price)}</span>
                          {item.mrp && item.mrp > item.price ? (
                            <span className="text-xs text-gray-400 line-through">
                              {formatPrice(item.mrp)}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold text-green-900 sm:text-base">
                        {formatPrice(item.price * item.quantity)}
                      </p>
                    </div>

                    <div className="mt-auto flex items-center gap-4 pt-3">
                      <div className="flex items-center rounded-lg border border-emerald-200">
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          disabled={item.quantity <= 1}
                          aria-label={`Decrease quantity of ${item.name}`}
                          className="flex h-8 w-8 touch-manipulation items-center justify-center text-gray-700 hover:bg-emerald-50/60 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span
                          className="w-8 text-center text-sm font-medium text-green-900"
                          aria-live="polite"
                        >
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          aria-label={`Increase quantity of ${item.name}`}
                          className="flex h-8 w-8 touch-manipulation items-center justify-center text-gray-700 hover:bg-emerald-50/60"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="text-sm text-gray-500 underline-offset-2 hover:text-green-900 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <aside aria-labelledby="cart-summary-heading">
            <div className="rounded-2xl border border-emerald-100 bg-white p-5 lg:sticky lg:top-32">
              <h2 id="cart-summary-heading" className="text-base font-semibold text-green-900">
                Order summary
              </h2>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between text-gray-700">
                  <dt>Subtotal</dt>
                  <dd>{formatPrice(subtotal)}</dd>
                </div>
                {savings > 0 ? (
                  <div className="flex justify-between text-emerald-800">
                    <dt>You save</dt>
                    <dd>{formatPrice(savings)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between text-gray-700">
                  <dt>Delivery</dt>
                  <dd className="text-gray-500">Calculated at checkout</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-gray-500">
                The delivery fee depends on your address and the size of the plants.
              </p>

              <div className="mt-5 hidden lg:block">
                <ButtonLink href="/checkout" className="w-full" size="lg">
                  Proceed to checkout
                </ButtonLink>
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-500">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" />
                Secure payment by Razorpay
              </p>

              <StorePickupOption className="mt-5" />
            </div>
          </aside>
        </div>
      </div>

      <div className="safe-area-pb fixed inset-x-0 bottom-0 z-40 border-t border-emerald-100 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-4">
          <div className="min-w-0">
            <p className="text-xs text-gray-500">Subtotal</p>
            <p className="font-space text-lg leading-tight font-semibold text-green-900">
              {formatPrice(subtotal)}
            </p>
          </div>
          <ButtonLink href="/checkout" className="flex-1">
            Checkout
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
