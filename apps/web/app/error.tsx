"use client";

import { useEffect } from "react";
import ButtonLink from "../components/ui/ButtonLink";

/**
 * Default boundary for any route that does not define its own. The root
 * layout survives, so the navbar and footer stay mounted and the user can
 * navigate away rather than being stranded.
 *
 * Routes where losing the page costs the customer something — checkout,
 * cart, orders — define their own boundary with recovery advice specific to
 * that step.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[error-boundary]", error.digest ?? "(no digest)", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 py-16 text-center">
      <p className="text-sm font-semibold tracking-[0.14em] text-emerald-700 uppercase">
        Something went wrong
      </p>
      <h1 className="mt-2 font-space text-3xl font-semibold tracking-tight text-green-900 sm:text-4xl">
        This page didn&rsquo;t load
      </h1>
      <p className="mt-3 max-w-md text-[15px] text-gray-600">
        The problem is on our side, not yours. Trying again usually works — if
        it doesn&rsquo;t, the catalog and your account are still reachable from
        the links below.
      </p>

      <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center justify-center rounded-full bg-green-700 px-5 py-2.5 text-[15px] font-medium text-white transition-colors hover:bg-green-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700"
        >
          Try again
        </button>
        <ButtonLink href="/shop" tone="secondary">
          Browse plants
        </ButtonLink>
        <ButtonLink href="/" tone="ghost">
          Go to the homepage
        </ButtonLink>
      </div>

      {error.digest && (
        <p className="mt-8 text-xs text-gray-400">Reference: {error.digest}</p>
      )}
    </main>
  );
}
