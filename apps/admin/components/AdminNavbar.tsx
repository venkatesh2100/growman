"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { apiFetch } from "../lib/api";

type ProductHit = {
  id: number;
  name: string;
  slug: string;
  category?: { name: string };
};

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export default function AdminNavbar() {
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ProductHit[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const quickSlug = useMemo(() => toSlug(search), [search]);
  
  
  useEffect(() => {
    if (search.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setIsLoading(true);
        const res = await apiFetch(
          `/products/search?q=${encodeURIComponent(search)}&page=1&pageSize=8`
        );
        if (!res.ok) {
          setResults([]);
          setOpen(false);
          return;
        }
        const data = await res.json();
        const items = Array.isArray(data?.data) ? data.data : [];
        setResults(items);
        setOpen(items.length > 0);
      } catch {
        setResults([]);
        setOpen(false);
      } finally {
        setIsLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  if (pathname === "/login") {
    return null;
  }

  return (
    <header className="sticky top-0 z-40 border-b border-emerald-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link href="/" className="shrink-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
            Growman
          </p>
          <p className="text-lg font-bold text-slate-900">Admin</p>
        </Link>

        <nav className="hidden items-center gap-2 md:flex">
          <Link
            href="/"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Dashboard
          </Link>
          <Link
            href="/product/add"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Add Product
          </Link>
          <Link
            href="/products"
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Products
          </Link>
        </nav>

        <div ref={searchContainerRef} className="relative ml-auto w-full max-w-xl">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setOpen(results.length > 0)}
            placeholder="Search product for quick overview..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />

          {open && (
            <div className="absolute top-full mt-2 w-full rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
              {isLoading ? (
                <p className="px-2 py-3 text-sm text-slate-500">Searching...</p>
              ) : (
                <>
                  {results.map((product) => (
                    <a
                      key={product.id}
                      href={`https://growman.live/product/${product.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-lg px-3 py-2 hover:bg-emerald-50"
                    >
                      <p className="text-sm font-medium text-slate-900">
                        {product.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {product.category?.name || "Product"} - {product.slug}
                      </p>
                    </a>
                  ))}

                  {quickSlug && (
                    <a
                      href={`https://growman.live/product/${quickSlug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 block rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
                    >
                      Open quick overview: /product/{quickSlug}
                    </a>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
