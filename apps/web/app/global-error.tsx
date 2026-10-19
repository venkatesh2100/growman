"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for errors thrown in the root layout itself.
 *
 * It replaces the entire document, which is why it renders its own `<html>`
 * and `<body>` and cannot use any of the app's layout, fonts or providers —
 * none of those are mounted at this point. Styles are inline for the same
 * reason: a failure in the global stylesheet import is one of the things
 * that lands a user here.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only handle on the server-side stack, which Next
    // withholds from the client in production. Without logging it there is
    // no way to correlate a user's report with the actual error.
    console.error("[global-error]", error.digest ?? "(no digest)", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          backgroundColor: "#f8faf8",
          color: "#14532d",
        }}
      >
        <main style={{ maxWidth: "32rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>
            Something went wrong
          </h1>
          <p
            style={{
              marginTop: "0.75rem",
              fontSize: "0.9375rem",
              lineHeight: 1.6,
              color: "#4b5563",
            }}
          >
            We hit an unexpected problem loading Growman. Your cart and any
            order you have already placed are safe.
          </p>

          <div
            style={{
              marginTop: "1.5rem",
              display: "flex",
              gap: "0.625rem",
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                borderRadius: "9999px",
                border: "none",
                backgroundColor: "#15803d",
                color: "#ffffff",
                padding: "0.625rem 1.25rem",
                fontSize: "0.9375rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            {/* A plain anchor, not next/link: the router may be part of
                what failed. */}
            <a
              href="/"
              style={{
                borderRadius: "9999px",
                border: "1px solid #bbf7d0",
                backgroundColor: "#ffffff",
                color: "#14532d",
                padding: "0.625rem 1.25rem",
                fontSize: "0.9375rem",
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              Go to the homepage
            </a>
          </div>

          {error.digest && (
            <p
              style={{
                marginTop: "1.5rem",
                fontSize: "0.75rem",
                color: "#9ca3af",
              }}
            >
              Reference: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
