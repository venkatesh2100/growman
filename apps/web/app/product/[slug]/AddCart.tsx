"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, Minus, Plus, ShoppingCart } from "lucide-react";
import { Product, ProductSize } from "../../../lib/types";
import { apiFetch } from "../../../lib/api";
import { useAuthStore } from "../../../lib/store/authStore";
import { useCartStore } from "../../../lib/store/cartStore";
import { toast } from "../../../lib/toast";
import { buildCartLine } from "../../../lib/cart";

export default function AddToCart({
  product,
  selectedSize,
}: {
  product: Product;
  selectedSize: ProductSize;
}) {
  const router = useRouter();
  const addItem = useCartStore((state) => state.addItem);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [quantity, setQuantity] = useState(1);
  const [isWishlisted, setIsWishlisted] = useState(false);
  const [wishlistBusy, setWishlistBusy] = useState(false);
  const outOfStock = selectedSize.stock <= 0;

  // Keep the chosen quantity within what the newly selected size has.
  useEffect(() => {
    setQuantity((q) => Math.max(1, Math.min(q, selectedSize.stock || 1)));
  }, [selectedSize.id, selectedSize.stock]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    const check = async () => {
      try {
        const res = await apiFetch("/wishlist");
        if (!res.ok) return;
        const data = await res.json();
        const list: Array<{ id: number }> = Array.isArray(data) ? data : data.data || [];
        if (!cancelled) setIsWishlisted(list.some((p) => p.id === product.id));
      } catch {
        // The heart just stays unfilled; saving still works.
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, product.id]);

  const addToCart = (announce: boolean) => {
    if (outOfStock) {
      toast("This size is out of stock.", "error");
      return false;
    }
    addItem(buildCartLine(product, selectedSize, Math.min(quantity, selectedSize.stock)));
    if (announce) toast(`${product.name} (${selectedSize.label}) added to cart`);
    return true;
  };

  const buyNow = () => {
    if (addToCart(false)) router.push("/checkout");
  };

  const toggleWishlist = async () => {
    if (!isAuthenticated) {
      router.push(`/login?redirect=${encodeURIComponent(`/product/${product.slug}`)}`);
      return;
    }
    setWishlistBusy(true);
    const next = !isWishlisted;
    try {
      const res = next
        ? await apiFetch("/wishlist", {
            method: "POST",
            body: JSON.stringify({ productId: product.id }),
          })
        : await apiFetch(`/wishlist/${product.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("wishlist update failed");
      setIsWishlisted(next);
      toast(next ? "Saved to your wishlist" : "Removed from your wishlist");
    } catch {
      toast("Couldn't update your wishlist. Please try again.", "error");
    } finally {
      setWishlistBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium text-gray-700">Quantity</span>
        <div className="flex items-center rounded-xl border border-emerald-200 bg-white">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            disabled={quantity <= 1 || outOfStock}
            aria-label="Decrease quantity"
            className="flex h-10 w-10 items-center justify-center text-gray-700 hover:bg-emerald-50/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-10 text-center text-sm font-semibold text-green-900" aria-live="polite">
            {quantity}
          </span>
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.min(selectedSize.stock, q + 1))}
            disabled={quantity >= selectedSize.stock || outOfStock}
            aria-label="Increase quantity"
            className="flex h-10 w-10 items-center justify-center text-gray-700 hover:bg-emerald-50/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={() => addToCart(true)}
          disabled={outOfStock}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 active:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-gray-400 sm:text-base"
        >
          <ShoppingCart className="h-4 w-4" />
          {outOfStock ? "Out of stock" : "Add to cart"}
        </button>
        <button
          type="button"
          onClick={buyNow}
          disabled={outOfStock}
          className="flex flex-1 items-center justify-center rounded-lg border-2 border-emerald-700 bg-white px-5 py-3 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400 sm:text-base"
        >
          Buy now
        </button>
        <button
          type="button"
          onClick={() => void toggleWishlist()}
          disabled={wishlistBusy}
          aria-pressed={isWishlisted}
          aria-label={isWishlisted ? "Remove from wishlist" : "Save to wishlist"}
          className={`flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-xl border transition-colors disabled:opacity-60 ${
            isWishlisted
              ? "border-rose-200 bg-rose-50 text-rose-600"
              : "border-emerald-200 bg-white text-gray-600 hover:text-green-900"
          }`}
        >
          <Heart className={`h-5 w-5 ${isWishlisted ? "fill-rose-500" : ""}`} />
        </button>
      </div>
    </div>
  );
}
