"use client";

import { useEffect } from "react";
import ButtonLink from "../../components/ui/ButtonLink";

/**
 * The cart lives in persisted client storage, so a render error here does
 * not lose it — worth saying, because a blank cart page reads as "my cart
 * was emptied".
 */
export default function CartError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[cart-error]", error.digest ?? "(no digest)", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="font-space text-2xl font-semibold tracking-tight text-green-900 sm:text-3xl">
        We couldn&rsquo;t show your cart
      </h1>
      <p className="mt-3 text-[15px] text-gray-600">
        Your items are still saved on this device — this is a display problem,
        not a lost cart. Reloading should bring it back.
      </p>

      <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center justify-center rounded-full bg-green-700 px-5 py-2.5 text-[15px] font-medium text-white transition-colors hover:bg-green-800"
        >
          Reload cart
        </button>
        <ButtonLink href="/shop" tone="secondary">
          Keep shopping
        </ButtonLink>
      </div>

      {error.digest && (
        <p className="mt-8 text-xs text-gray-400">Reference: {error.digest}</p>
      )}
    </main>
  );
}
