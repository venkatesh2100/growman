"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, MessageCircle } from "lucide-react";
import { apiFetch, searchProducts } from "../../lib/api";
import type { Product } from "../../lib/types";
import ProductCard from "../../components/productspage/ProductCard";
import { useAuthStore } from "../../lib/store/authStore";

type ScoredProduct = Product & { _score: number };

function getSearchableText(product: Product): string[] {
  return [
    product.name ?? "",
    product.slug ?? "",
    product.description ?? "",
    product.shortDescription ?? "",
    product.fullDescription ?? "",
    product.specifications ?? "",
    product.category?.name ?? "",
    product.subcategory?.name ?? "",
    product.brand?.name ?? "",
    ...(product.tags ?? []),
  ];
}

function scoreProduct(product: Product, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  const name = (product.name ?? "").toLowerCase();
  const desc = [
    product.description ?? "",
    product.shortDescription ?? "",
    product.fullDescription ?? "",
    product.specifications ?? "",
  ]
    .join(" ")
    .toLowerCase();
  const tags = (product.tags ?? []).join(" ").toLowerCase();
  const category = `${product.category?.name ?? ""} ${product.subcategory?.name ?? ""}`.toLowerCase();
  const brand = (product.brand?.name ?? "").toLowerCase();

  if (name === q) return 120;
  if (name.startsWith(q)) return 95;
  if (name.includes(q)) return 80;
  if (tags.includes(q)) return 65;
  if (desc.includes(q)) return 55;
  if (category.includes(q) || brand.includes(q)) return 45;

  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;

  let tokenHits = 0;
  for (const token of tokens) {
    const haystack = getSearchableText(product).join(" ").toLowerCase();
    if (haystack.includes(token)) tokenHits += 1;
  }

  return tokenHits > 0 ? 20 + tokenHits * 8 : 0;
}

export default function Searchcomponent() {
  const searchParams = useSearchParams();
  const query = (searchParams.get("q") ?? "").trim();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const checkAuth = useAuthStore((state) => state.checkAuth);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
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
        // no-op, form fields stay user-editable when not authenticated
      }
    };

    fetchProfile();
  }, [isAuthenticated]);

  useEffect(() => {
    let cancelled = false;

    const runSearch = async () => {
      if (!query) {
        setProducts([]);
        return;
      }

      setLoading(true);
      try {
        const [primary, expanded] = await Promise.all([
          searchProducts(query, 1, 40),
          searchProducts(query.split(/\s+/)[0] || query, 1, 40),
        ]);

        if (cancelled) return;

        const merged = [...primary.data, ...expanded.data];
        const deduped = new Map<number, Product>();
        for (const item of merged) deduped.set(item.id, item);
        setProducts(Array.from(deduped.values()));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    runSearch();
    return () => {
      cancelled = true;
    };
  }, [query]);

  const { exactMatches, relatedMatches } = useMemo(() => {
    const scored: ScoredProduct[] = products
      .map((product) => ({ ...product, _score: scoreProduct(product, query) }))
      .filter((product) => product._score > 0)
      .sort((a, b) => b._score - a._score);

    const exact = scored.filter((product) => product._score >= 60);
    const related = scored.filter((product) => product._score < 60);

    return { exactMatches: exact, relatedMatches: related };
  }, [products, query]);

  const openProductEnquiry = () => {
    const message = `I am looking for the exact product "${query}". Please help me find it or add it to Growman catalog.`;
    window.dispatchEvent(new CustomEvent("growman:chatbot-prefill", { detail: { message } }));
  };

  const submitProductRequest = async () => {
    if (!isAuthenticated) {
      setRequestMessage("Please login or create an account to submit a product request.");
      return;
    }
    if (!requestName.trim()) {
      setRequestMessage("Product name is required.");
      return;
    }
    setRequestSubmitting(true);
    setRequestMessage("");
    try {
      const response = await apiFetch("/requested-products", {
        method: "POST",
        body: JSON.stringify({
          productName: requestName.trim(),
          details: requestDetails.trim() || `Search keyword: ${query}`,
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
      setRequestMessage("Request submitted. Our team will review and add it if available.");
      setRequestDetails("");
      setAdminNotes("");
    } catch {
      setRequestMessage("Could not submit request right now. Please try again.");
    } finally {
      setRequestSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen px-4 py-6 md:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-2xl font-bold text-green-900">Search Results</h1>
        <p className="mt-1 text-sm text-emerald-700">
          Showing results for <span className="font-semibold">"{query || "all products"}"</span>
        </p>

        {!query && (
          <div className="mt-8 rounded-2xl border border-emerald-100 bg-white p-6 text-gray-600">
            Enter a product name, tag, or description in search.
          </div>
        )}

        {loading && (
          <div className="mt-8 flex items-center gap-2 text-emerald-700">
            <Loader2 className="h-5 w-5 animate-spin" />
            Searching products...
          </div>
        )}

        {!loading && query && (
          <div className="mt-6 space-y-8">
            {exactMatches.length > 0 ? (
              <section>
                <h2 className="text-xl font-semibold text-green-800">Matching products</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Matches found from name, description, tags, and related product attributes.
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-6 lg:grid-cols-4">
                  {exactMatches.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>
              </section>
            ) : (
              <section className="rounded-2xl  p-5">
                <h2 className="text-lg font-semibold ">No exact product match found</h2>
                <p className="mt-1 text-sm ">
                  We could not find an exact match for "{query}". Showing related products below.
                </p>
              </section>
            )}

            {relatedMatches.length > 0 && (
              <section>
                <h2 className="text-xl font-semibold text-green-800">Related products</h2>
                <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-6 lg:grid-cols-4">
                  {relatedMatches.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>
              </section>
            )}

            {exactMatches.length === 0 && relatedMatches.length === 0 && (
              <section className="rounded-2xl border border-gray-200 bg-white p-6">
                <h2 className="text-lg font-semibold text-gray-900">No products found</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Try a different keyword, or request this product from us.
                </p>
              </section>
            )}

            <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
              <h3 className="text-base font-semibold text-emerald-900">Need exact product enquiry?</h3>
              <p className="mt-1 text-sm text-emerald-800">
                Ask Dootha to find the exact product or request us to add it to catalog.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={openProductEnquiry}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                >
                  <MessageCircle className="h-4 w-4" />
                  Ask exact product enquiry
                </button>
                {isAuthenticated ? (
                  <button
                    onClick={submitProductRequest}
                    disabled={requestSubmitting}
                    className="inline-flex items-center rounded-xl border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
                  >
                    {requestSubmitting ? "Submitting..." : "Request to add product"}
                  </button>
                ) : null}
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                <input
                  value={requestName}
                  onChange={(e) => setRequestName(e.target.value)}
                  placeholder="Requested product name"
                  className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-emerald-500"
                />
                <input
                  value={requestDetails}
                  onChange={(e) => setRequestDetails(e.target.value)}
                  placeholder="Details (brand, size, use-case)"
                  className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-emerald-500"
                />
              </div>
              {!isAuthenticated && (
                <div className="mt-3 rounded-xl border border-emerald-200 bg-white p-3">
                  <p className="text-sm text-emerald-900">
                    Please login or create an account to request adding this product.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link
                      href={`/login?redirect=${encodeURIComponent(`/search?q=${query}`)}`}
                      className="inline-flex items-center rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                    >
                      Login
                    </Link>
                    <Link
                      href={`/signup?redirect=${encodeURIComponent(`/search?q=${query}`)}`}
                      className="inline-flex items-center rounded-lg border border-emerald-300 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
                    >
                      Create account
                    </Link>
                  </div>
                </div>
              )}
              {requestMessage && (
                <p className="mt-2 text-sm text-emerald-900">{requestMessage}</p>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
