"use client";

import { useEffect } from "react";
import ButtonLink from "../../components/ui/ButtonLink";

/**
 * Checkout gets its own boundary because the generic "try again" is not
 * reassuring enough here: a customer who sees an error on the payment step
 * needs to know whether they have been charged.
 *
 * The honest answer is that we cannot tell from the client, so the copy
 * points them at the orders page, which reads the server's record. It
 * deliberately does not tell them to retry the payment, since that is the
 * one action that could double-charge them.
 */
export default function CheckoutError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[checkout-error]", error.digest ?? "(no digest)", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="font-space text-2xl font-semibold tracking-tight text-green-900 sm:text-3xl">
        Checkout ran into a problem
      </h1>

      <div className="mt-5 w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-left">
        <p className="text-sm font-semibold text-amber-900">
          Before you try again, check your orders
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-amber-800">
          If you had already reached the payment screen, the order may have
          gone through. Open your orders first so you don&rsquo;t pay twice.
          Anything that failed before payment left your cart untouched.
        </p>
      </div>

      <div className="mt-6 flex w-full flex-col gap-2.5 sm:flex-row sm:justify-center">
        <ButtonLink href="/orders">Check my orders</ButtonLink>
        <ButtonLink href="/cart" tone="secondary">
          Back to cart
        </ButtonLink>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center justify-center rounded-full px-5 py-2.5 text-[15px] font-medium text-gray-600 transition-colors hover:text-green-900"
        >
          Reload checkout
        </button>
      </div>

      <p className="mt-8 text-sm text-gray-500">
        Still stuck? Reach us and quote
        {error.digest ? ` reference ${error.digest}` : " the time of the error"}
        .{" "}
        <ButtonLink href="/help-center" tone="ghost" size="sm">
          Contact support
        </ButtonLink>
      </p>
    </main>
  );
}
