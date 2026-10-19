"use client";

import { useEffect } from "react";
import ButtonLink from "../../components/ui/ButtonLink";

/**
 * Orders failing to load is worrying in a way that a catalog page failing
 * is not, so this says plainly that the order records are unaffected.
 */
export default function OrdersError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[orders-error]", error.digest ?? "(no digest)", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="font-space text-2xl font-semibold tracking-tight text-green-900 sm:text-3xl">
        We couldn&rsquo;t load your orders
      </h1>
      <p className="mt-3 text-[15px] text-gray-600">
        Nothing has happened to your orders — we just couldn&rsquo;t fetch
        them right now. Every order confirmation is also in your email.
      </p>

      <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center justify-center rounded-full bg-green-700 px-5 py-2.5 text-[15px] font-medium text-white transition-colors hover:bg-green-800"
        >
          Try again
        </button>
        <ButtonLink href="/help-center" tone="secondary">
          Contact support
        </ButtonLink>
      </div>

      {error.digest && (
        <p className="mt-8 text-xs text-gray-400">Reference: {error.digest}</p>
      )}
    </main>
  );
}
