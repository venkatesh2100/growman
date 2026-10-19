"use client";

import { useEffect, useState } from "react";
import { Heart, X } from "lucide-react";
import { apiFetch, readJson } from "../../lib/api";
import { Product } from "../../lib/types";
import { useAuthStore } from "../../lib/store/authStore";
import { toast } from "../../lib/toast";
import AccountShell from "../../components/account/AccountShell";
import ProductGrid from "../../components/productspage/ProductGrid";
import ButtonLink from "../../components/ui/ButtonLink";

type WishlistResponse = Product[] | { data?: Product[] };

export default function WishlistPage() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [removing, setRemoving] = useState<number | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    const load = async () => {
      try {
        const res = await apiFetch("/wishlist");
        if (!res.ok) throw new Error("Failed to fetch wishlist");
        const data = await readJson<WishlistResponse>(res);
        setProducts(Array.isArray(data) ? data : data.data || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [isAuthenticated]);

  const remove = async (product: Product) => {
    setRemoving(product.id);
    try {
      const res = await apiFetch(`/wishlist/${product.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("remove failed");
      setProducts((prev) => prev.filter((p) => p.id !== product.id));
      toast(`${product.name} removed from your wishlist`);
    } catch {
      toast("Couldn't update your wishlist. Please try again.", "error");
    } finally {
      setRemoving(null);
    }
  };

  return (
    <AccountShell
      title="Wishlist"
      description={
        !loading && products.length > 0
          ? `${products.length} saved ${products.length === 1 ? "plant" : "plants"}`
          : "Plants you've saved for later."
      }
    >
      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="aspect-[3/4] animate-pulse rounded-2xl border border-emerald-100 bg-white"
            />
          ))}
        </div>
      ) : (
        <ProductGrid
          products={products}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3"
          renderAction={(product) => (
            <button
              type="button"
              onClick={() => void remove(product)}
              disabled={removing === product.id}
              aria-label={`Remove ${product.name} from wishlist`}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-gray-600 shadow-sm ring-1 ring-emerald-100 transition-colors hover:text-green-900 disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          emptyState={
            <div className="rounded-2xl border border-emerald-100 bg-white px-6 py-12 text-center">
              <Heart className="mx-auto h-9 w-9 text-gray-300" />
              <h2 className="mt-4 text-base font-semibold text-green-900">
                Your wishlist is empty
              </h2>
              <p className="mx-auto mt-1 max-w-xs text-sm text-gray-600">
                Tap the heart on any plant to save it here.
              </p>
              <ButtonLink href="/shop" className="mt-6">
                Browse plants
              </ButtonLink>
            </div>
          }
        />
      )}
    </AccountShell>
  );
}
