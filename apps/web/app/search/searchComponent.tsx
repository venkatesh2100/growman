"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { apiFetch, searchProducts } from "../../lib/api";
import type { Product } from "../../lib/types";
import ProductCard from "../../components/productspage/ProductCard";
import { ProductCardSkeleton } from "../../components/loading/SkeletonLoader";
import { useAuthStore } from "../../lib/store/authStore";

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
        const user = await response.json();
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
    <main className="min-h-screen bg-[#F9FAFB] px-4 py-6 md:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <h1 className="font-space text-2xl font-bold tracking-tight text-green-900">Search</h1>
        {query ? (
          <p className="mt-1 text-sm text-gray-500">
            {showLoading
              ? `Searching for “${query}”…`
              : `${total} result${total === 1 ? "" : "s"} for “${query}”`}
          </p>
        ) : (
          <p className="mt-1 text-sm text-gray-500">Search plants, pots, seeds, and more.</p>
        )}

        {!query && (
          <div className="mt-8 rounded-2xl border border-emerald-100/80 bg-white px-5 py-6 text-sm text-gray-500">
            Type a name in the navbar search to get started.
          </div>
        )}

        {query && showLoading && (
          <div className="mt-6 grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-6 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        )}

        {query && !showLoading && (
          <div className="mt-6 space-y-8">
            {products.length > 0 ? (
              <section>
                <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-6 lg:grid-cols-4">
                  {products.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>
              </section>
            ) : (
              <section className="rounded-2xl border border-emerald-100/80 bg-white px-5 py-4">
                <h2 className="text-lg font-semibold text-green-900">No products found</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Try another keyword, or tell us what you need below.
                </p>
              </section>
            )}

            <section className="rounded-2xl border border-emerald-100/80 bg-white p-5 sm:p-6">
              <div className="max-w-xl">
                <h3 className="font-space text-lg font-semibold tracking-tight text-green-900">
                  Can&apos;t find it?
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  Ask Dootha or send us the product details.
                </p>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <input
                  value={requestName}
                  onChange={(e) => setRequestName(e.target.value)}
                  placeholder="Product name"
                  className="rounded-2xl border border-emerald-100 bg-[#F9FAFB] px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-emerald-200"
                />
                <input
                  value={requestDetails}
                  onChange={(e) => setRequestDetails(e.target.value)}
                  placeholder="Size, brand, notes (optional)"
                  className="rounded-2xl border border-emerald-100 bg-[#F9FAFB] px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-emerald-200"
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={openProductEnquiry}
                  className="inline-flex items-center gap-2 rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800"
                >
                  <MessageCircle className="h-4 w-4" />
                  Ask Dootha
                </button>
                {isAuthenticated ? (
                  <button
                    type="button"
                    onClick={submitProductRequest}
                    disabled={requestSubmitting}
                    className="inline-flex items-center rounded-2xl border border-emerald-100 bg-[#F9FAFB] px-4 py-2.5 text-sm font-semibold text-green-900 transition-colors hover:bg-emerald-50 disabled:opacity-50"
                  >
                    {requestSubmitting ? "Sending…" : "Request product"}
                  </button>
                ) : (
                  <Link
                    href={`/login?redirect=${encodeURIComponent(`/search?q=${query}`)}`}
                    className="inline-flex items-center rounded-2xl border border-emerald-100 bg-[#F9FAFB] px-4 py-2.5 text-sm font-semibold text-green-900 transition-colors hover:bg-emerald-50"
                  >
                    Sign in to request
                  </Link>
                )}
              </div>

              {requestMessage ? (
                <p className="mt-3 text-sm text-green-950/55">{requestMessage}</p>
              ) : null}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
