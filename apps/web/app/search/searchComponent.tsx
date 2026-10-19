"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { MessageCircle, Search } from "lucide-react";
import { apiFetch, readJson, searchProducts } from "../../lib/api";
import type { Product } from "../../lib/types";
import ProductCard from "../../components/productspage/ProductCard";
import { ProductCardSkeleton } from "../../components/loading/SkeletonLoader";
import { buttonClass } from "../../components/ui/buttonStyles";
import { useAuthStore } from "../../lib/store/authStore";

const GRID = "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 lg:gap-5";
const FIELD =
  "w-full rounded-xl border border-emerald-200 bg-white px-4 py-2.5 text-sm text-green-900 placeholder:text-gray-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20";

type ProfileResponse = {
  name?: string;
  email?: string;
  phone?: string;
};

export default function Searchcomponent() {
  const searchParams = useSearchParams();
  const query = (searchParams.get("q") ?? "").trim();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const checkAuth = useAuthStore((state) => state.checkAuth);
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [requestName, setRequestName] = useState(query);
  const [requestDetails, setRequestDetails] = useState("");
  const [requesterName, setRequesterName] = useState("");
  const [requesterEmail, setRequesterEmail] = useState("");
  const [requesterPhone, setRequesterPhone] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestMessage, setRequestMessage] = useState("");

  useEffect(() => {
    setRequestName(query);
  }, [query]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const fetchProfile = async () => {
      try {
        const response = await apiFetch("/auth/me");
        if (!response.ok) return;
        const user = await readJson<ProfileResponse>(response);
        setRequesterName(user?.name || "");
        setRequesterEmail(user?.email || "");
        setRequesterPhone(user?.phone || "");
      } catch {
        // ignore
      }
    };

    fetchProfile();
  }, [isAuthenticated]);

  useEffect(() => {
    if (!query) {
      setProducts([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    searchProducts(query, 1, 24, controller.signal)
      .then((result) => {
        startTransition(() => {
          setProducts(result.data);
          setTotal(result.pagination.total);
        });
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setProducts([]);
        setTotal(0);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [query]);

  const openProductEnquiry = () => {
    const message = `I'm looking for "${query}". Can you help me find it or add it to the catalog?`;
    window.dispatchEvent(new CustomEvent("growman:chatbot-prefill", { detail: { message } }));
  };

  const submitProductRequest = async () => {
    if (!isAuthenticated) {
      setRequestMessage("Sign in to submit a product request.");
      return;
    }
    if (!requestName.trim()) {
      setRequestMessage("Add a product name.");
      return;
    }
    setRequestSubmitting(true);
    setRequestMessage("");
    try {
      const response = await apiFetch("/requested-products", {
        method: "POST",
        body: JSON.stringify({
          productName: requestName.trim(),
          details: requestDetails.trim() || `Search: ${query}`,
          source: "search_page",
          requesterName: requesterName.trim(),
          requesterEmail: requesterEmail.trim(),
          requesterPhone: requesterPhone.trim(),
          adminNotes: adminNotes.trim(),
        }),
      });
      if (!response.ok) {
        throw new Error("Failed to submit product request");
      }
      setRequestMessage("Request sent. We'll get back to you.");
      setRequestDetails("");
      setAdminNotes("");
    } catch {
      setRequestMessage("Couldn't send the request. Try again.");
    } finally {
      setRequestSubmitting(false);
    }
  };

  const showLoading = loading || isPending;

  return (
    <div className="mx-auto max-w-7xl px-4 pt-6 pb-16 sm:px-6 sm:pt-8 lg:px-8">
      <h1 className="font-space text-2xl font-semibold tracking-tight text-green-900 sm:text-3xl">
        {query ? <>Results for &ldquo;{query}&rdquo;</> : "Search"}
      </h1>
      <p className="mt-1.5 text-sm text-gray-600" aria-live="polite">
        {!query
          ? "Search by plant name, common name or category."
          : showLoading
            ? "Searching…"
            : `${total} ${total === 1 ? "result" : "results"}`}
      </p>

      {/* key resets the field when the query changes from the header search */}
      <form action="/search" role="search" className="mt-5 flex max-w-xl gap-2" key={query}>
        <label htmlFor="search-page-input" className="sr-only">
          Search plants
        </label>
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            aria-hidden
          />
          <input
            id="search-page-input"
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Money plant, bonsai, hibiscus…"
            className={`${FIELD} pl-10`}
          />
        </div>
        <button type="submit" className={buttonClass("primary")}>
          Search
        </button>
      </form>

      {query && showLoading && (
        <div className={`mt-8 ${GRID}`}>
          {Array.from({ length: 8 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      )}

      {query && !showLoading && (
        <div className="mt-8 space-y-10">
          {products.length > 0 ? (
            <section aria-label="Search results">
              <div className={GRID}>
                {products.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            </section>
          ) : (
            <section className="rounded-2xl border border-emerald-100 bg-white px-5 py-6">
              <h2 className="text-base font-semibold text-green-900">
                No plants match &ldquo;{query}&rdquo;
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                Check the spelling, try a common name, or{" "}
                <Link href="/shop" className="font-medium text-emerald-700 hover:text-emerald-900">
                  browse the full catalog
                </Link>
                .
              </p>
            </section>
          )}

          <section
            aria-labelledby="request-heading"
            className="rounded-2xl border border-emerald-100 bg-white p-5 sm:p-6"
          >
            <div className="max-w-xl">
              <h2
                id="request-heading"
                className="font-space text-lg font-semibold tracking-tight text-green-900"
              >
                Looking for something we don&apos;t list?
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                Tell us what you need and we&apos;ll check whether the nursery can source it.
              </p>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="request-name" className="mb-1.5 block text-sm font-medium text-gray-700">
                  Plant or product
                </label>
                <input
                  id="request-name"
                  value={requestName}
                  onChange={(e) => setRequestName(e.target.value)}
                  className={FIELD}
                />
              </div>
              <div>
                <label htmlFor="request-details" className="mb-1.5 block text-sm font-medium text-gray-700">
                  Details <span className="font-normal text-gray-500">(optional)</span>
                </label>
                <input
                  id="request-details"
                  value={requestDetails}
                  onChange={(e) => setRequestDetails(e.target.value)}
                  placeholder="Size, quantity, variety"
                  className={FIELD}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {isAuthenticated ? (
                <button
                  type="button"
                  onClick={submitProductRequest}
                  disabled={requestSubmitting}
                  className={buttonClass("primary")}
                >
                  {requestSubmitting ? "Sending…" : "Send request"}
                </button>
              ) : (
                <Link
                  href={`/login?redirect=${encodeURIComponent(`/search?q=${encodeURIComponent(query)}`)}`}
                  className={buttonClass("primary")}
                >
                  Sign in to send a request
                </Link>
              )}
              <button type="button" onClick={openProductEnquiry} className={buttonClass("secondary")}>
                <MessageCircle className="h-4 w-4" aria-hidden />
                Ask Dootha
              </button>
            </div>

            {requestMessage ? (
              <p className="mt-3 text-sm text-green-950/55" role="status">
                {requestMessage}
              </p>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
