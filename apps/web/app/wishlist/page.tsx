"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Heart, Loader2 } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { Product } from "../../lib/types";
import { useAuthStore } from "../../lib/store/authStore";
import { useRouter } from "next/navigation";
import ProductCard from "../../components/productspage/ProductCard";

export default function WishlistPage() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push("/login?redirect=/wishlist");
      return;
    }

    const load = async () => {
      try {
        const res = await apiFetch("/wishlist");
        if (!res.ok) throw new Error("Failed to fetch wishlist");
        const data = await res.json();
        const list = Array.isArray(data) ? data : data.data || [];
        setProducts(list);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isAuthenticated, router]);

  return (
    <main className="min-h-screen bg-[#F7F8FA] py-10">
      <div className="mx-auto max-w-5xl px-4">
        <h1 className="text-2xl font-bold text-emerald-950">My Wishlist</h1>
        <p className="mt-1 text-sm text-gray-600">Your saved plants and favorites.</p>

        {loading ? (
          <div className="mt-8 flex items-center justify-center text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading wishlist...
          </div>
        ) : products.length === 0 ? (
          <div className="mt-8 rounded-xl border border-emerald-100 bg-white p-8 text-center shadow-sm">
            <Heart className="mx-auto h-8 w-8 text-gray-300" />
            <p className="mt-3 text-sm text-gray-600">No products in wishlist yet.</p>
            <Link
              href="/shop"
              className="mt-4 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Browse Plants
            </Link>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
