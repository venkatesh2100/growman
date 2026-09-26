"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { FileText, Minus, Phone, Plus, Search, X } from "lucide-react";
import OptimizedImage from "../../components/ui/OptimizedImage";
import { formatPrice } from "../../lib/format";
import QuotationEnquiry, { type EnquiryLine } from "./QuotationEnquiry";

export type BulkItem = {
  key: string;
  productId: number;
  sizeId: number;
  itemCode: string;
  name: string;
  size: string;
  slug: string;
  category: string;
  price: number;
  image: string;
};

type Props = {
  items: BulkItem[];
  /** Dialled by the call links. The digits are never printed on the page. */
  phone: string;
};

const STEPS = [10, 50, 100] as const;
const MAX_QTY = 100000;

function BulkImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(!src);
  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-100">
        <span className="text-xs text-gray-400">No image</span>
      </div>
    );
  }
  return (
    <OptimizedImage
      src={src}
      alt={alt}
      fill
      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
      className="object-cover"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Bulk quotation builder. Nothing here is a cart or a payment — quantities
 * are collected into a quotation enquiry that the store prices and confirms.
 */
export default function BulkOrderList({ items, phone }: Props) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [enquiryOpen, setEnquiryOpen] = useState(false);

  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category).filter(Boolean))).sort(),
    [items]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (item) =>
        (!category || item.category === category) &&
        (!q ||
          item.name.toLowerCase().includes(q) ||
          item.size.toLowerCase().includes(q) ||
          item.itemCode.toLowerCase().includes(q))
    );
  }, [items, query, category]);

  const selected: EnquiryLine[] = useMemo(
    () =>
      items.flatMap((item) => {
        const quantity = quantities[item.key] ?? 0;
        return quantity > 0 ? [{ ...item, quantity }] : [];
      }),
    [items, quantities]
  );
  const totalUnits = selected.reduce((sum, i) => sum + i.quantity, 0);
  const estimate = selected.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const updateQty = useCallback(
    (key: string, compute: (current: number) => number) => {
      setQuantities((prev) => {
        const next = Math.min(MAX_QTY, Math.max(0, Math.floor(compute(prev[key] ?? 0)) || 0));
        const copy = { ...prev };
        if (next === 0) delete copy[key];
        else copy[key] = next;
        return copy;
      });
    },
    []
  );
  const setQty = useCallback(
    (key: string, value: number) => updateQty(key, () => value),
    [updateQty]
  );
  const addQty = (key: string, delta: number) => updateQty(key, (current) => current + delta);

  const closeEnquiry = useCallback(() => setEnquiryOpen(false), []);
  const clearAll = useCallback(() => setQuantities({}), []);

  return (
    <div className="pb-28">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Search plants</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by plant, size or item code"
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500"
          />
        </label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500 sm:w-56"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          {visible.length} {visible.length === 1 ? "variety" : "varieties"}
          {selected.length > 0
            ? ` · ${selected.length} selected`
            : ""}
        </p>
        {selected.length > 0 ? (
          <button
            type="button"
            onClick={clearAll}
            className="text-sm font-medium text-emerald-600 hover:text-emerald-700"
          >
            Clear selection
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setEnquiryOpen(true)}
            className="text-sm font-medium text-emerald-600 hover:text-emerald-700"
          >
            Plant not listed? Request it
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
          <p>No varieties match your search.</p>
          <button
            type="button"
            onClick={() => setEnquiryOpen(true)}
            className="mt-2 text-sm font-medium text-emerald-600 hover:text-emerald-700"
          >
            Request a plant that isn&apos;t listed
          </button>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          {visible.map((item) => {
            const qty = quantities[item.key] ?? 0;
            return (
              <li
                key={item.key}
                className={`flex flex-col overflow-hidden rounded-xl bg-white ${
                  qty > 0
                    ? "border-2 border-emerald-600"
                    : "border border-gray-200"
                }`}
              >
                <Link
                  href={`/product/${item.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative block aspect-square bg-gray-50"
                >
                  <BulkImage src={item.image} alt={item.name} />
                  {item.size ? (
                    <span className="absolute left-1 top-1 bg-white/95 px-1.5 py-0.5 text-[10px] font-semibold text-gray-800 sm:left-2 sm:top-2 sm:text-xs">
                      {item.size}
                    </span>
                  ) : null}
                </Link>

                <div className="flex flex-1 flex-col p-2.5 sm:p-3">
                  {item.category ? (
                    <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-emerald-700 sm:text-[11px]">
                      {item.category}
                    </p>
                  ) : null}
                  <h3 className="line-clamp-2 min-h-10 text-sm font-semibold leading-snug text-slate-900">
                    {item.name}
                  </h3>
                  <p className="mt-0.5 text-[10px] text-gray-400 sm:text-[11px]">{item.itemCode}</p>

                  {item.price > 0 ? (
                    <p className="mt-1.5 text-base font-semibold text-gray-900">
                      {formatPrice(item.price)}
                      <span className="text-xs font-normal text-gray-500"> /unit</span>
                    </p>
                  ) : (
                    <p className="mt-1.5 text-xs text-gray-500">Rate on request</p>
                  )}

                  <div className="mt-auto pt-3">
                    <div className="flex items-center gap-1.5">
                      <div className="flex min-w-0 flex-1 items-center overflow-hidden rounded-lg border border-gray-300 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500">
                        <button
                          type="button"
                          onClick={() => addQty(item.key, -1)}
                          disabled={qty === 0}
                          aria-label={`Decrease quantity for ${item.name}`}
                          className="p-2 text-gray-600 hover:text-emerald-700 disabled:text-gray-300"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <label className="sr-only" htmlFor={`qty-${item.key}`}>
                          Quantity for {item.name}
                        </label>
                        <input
                          id={`qty-${item.key}`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          value={qty === 0 ? "" : qty}
                          onChange={(e) => setQty(item.key, Number(e.target.value))}
                          placeholder="Qty"
                          className="w-full min-w-0 border-0 py-1.5 text-center text-sm focus:outline-none focus:ring-0"
                        />
                        <button
                          type="button"
                          onClick={() => addQty(item.key, 1)}
                          aria-label={`Increase quantity for ${item.name}`}
                          className="p-2 text-gray-600 hover:text-emerald-700"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {qty > 0 ? (
                        <button
                          type="button"
                          onClick={() => setQty(item.key, 0)}
                          aria-label={`Clear quantity for ${item.name}`}
                          className="shrink-0 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-1.5">
                      {STEPS.map((step) => (
                        <button
                          key={step}
                          type="button"
                          onClick={() => addQty(item.key, step)}
                          className="rounded-lg border border-emerald-600 bg-white py-1.5 text-[11px] font-semibold text-emerald-600 transition touch-manipulation hover:bg-emerald-50 active:scale-95 active:bg-emerald-100 sm:text-xs"
                        >
                          +{step}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {selected.length > 0 && !enquiryOpen ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white px-3 py-3">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-gray-900">
              <p>
                <span className="font-semibold">{selected.length}</span>{" "}
                {selected.length === 1 ? "variety" : "varieties"} ·{" "}
                <span className="font-semibold">{totalUnits.toLocaleString("en-IN")}</span> units
              </p>
              {estimate > 0 ? (
                <p className="text-xs text-gray-500">
                  Est. ₹{Math.round(estimate).toLocaleString("en-IN")} at listed rates
                </p>
              ) : null}
            </div>
            <div className="flex gap-2">
              <a
                href={`tel:${phone}`}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-600 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-600 transition hover:bg-emerald-50 active:bg-emerald-100 sm:flex-none"
              >
                <Phone className="h-4 w-4" />
                <span className="sm:hidden">Call</span>
                <span className="hidden sm:inline">Contact us</span>
              </a>
              <button
                type="button"
                onClick={() => setEnquiryOpen(true)}
                className="inline-flex flex-[2] items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 active:bg-emerald-800 sm:flex-none"
              >
                <FileText className="h-4 w-4" />
                Request quotation
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {enquiryOpen ? (
        <QuotationEnquiry
          lines={selected}
          phone={phone}
          onQuantityChange={setQty}
          onClose={closeEnquiry}
          onSent={clearAll}
        />
      ) : null}
    </div>
  );
}
