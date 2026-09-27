"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Minus,
  Phone,
  Plus,
  Search,
  X,
} from "lucide-react";
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
const PAGE_SIZE = 40;

function BulkImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(!src);
  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-100">
        <span className="text-[10px] text-gray-400">No image</span>
      </div>
    );
  }
  return (
    <OptimizedImage
      src={src}
      alt={alt}
      fill
      sizes="80px"
      className="object-cover"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/** Page numbers to render, collapsing long runs into ellipses. */
function pageWindow(current: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current - 1, current, current + 1]);
  return Array.from(pages)
    .filter((p) => p >= 1 && p <= total)
    .sort((a, b) => a - b);
}

function BulkPagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  const pages = pageWindow(page, totalPages);
  const arrow =
    "inline-flex h-9 w-9 items-center justify-center rounded-lg border transition disabled:pointer-events-none disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-300";

  return (
    <nav
      aria-label="Variety pagination"
      className="mt-6 flex flex-col items-center gap-3 border-t border-gray-200 pt-5 sm:flex-row sm:justify-between"
    >
      <p className="text-sm text-gray-500">
        Page <span className="font-semibold text-gray-900">{page}</span> of{" "}
        <span className="font-semibold text-gray-900">{totalPages}</span>
      </p>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onChange(page - 1)}
          disabled={page === 1}
          aria-label="Previous page"
          className={`${arrow} border-gray-300 bg-white text-gray-700 hover:border-emerald-500 hover:text-emerald-700`}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {pages.map((p, index) => {
          const previous = pages[index - 1];
          return (
            <span key={p} className="flex items-center gap-1.5">
              {previous != null && p - previous > 1 ? (
                <span aria-hidden className="px-0.5 text-gray-400">
                  …
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => onChange(p)}
                aria-current={p === page ? "page" : undefined}
                className={`h-9 min-w-9 rounded-lg border px-2.5 text-sm font-semibold transition ${
                  p === page
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-gray-300 bg-white text-gray-700 hover:border-emerald-500 hover:text-emerald-700"
                }`}
              >
                {p}
              </button>
            </span>
          );
        })}

        <button
          type="button"
          onClick={() => onChange(page + 1)}
          disabled={page === totalPages}
          aria-label="Next page"
          className={`${arrow} border-gray-300 bg-white text-gray-700 hover:border-emerald-500 hover:text-emerald-700`}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
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
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [enquiryOpen, setEnquiryOpen] = useState(false);
  const gridTop = useRef<HTMLDivElement>(null);

  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category).filter(Boolean))).sort(),
    [items]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (item) =>
        (!category || item.category === category) &&
        (!selectedOnly || (quantities[item.key] ?? 0) > 0) &&
        (!q ||
          item.name.toLowerCase().includes(q) ||
          item.size.toLowerCase().includes(q) ||
          item.itemCode.toLowerCase().includes(q))
    );
  }, [items, query, category, selectedOnly, quantities]);

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const rangeStart = visible.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, visible.length);
  const pageItems = useMemo(
    () => visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [visible, safePage]
  );

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

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

  const goToPage = useCallback((next: number) => {
    setPage(next);
    gridTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const closeEnquiry = useCallback(() => setEnquiryOpen(false), []);
  const clearAll = useCallback(() => {
    setQuantities({});
    setSelectedOnly(false);
  }, []);

  const filterChip =
    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition";

  return (
    <div className="pb-28">
      <div ref={gridTop} className="scroll-mt-4" />

      <div className="rounded-xl border border-gray-200 bg-white p-3 sm:p-4">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <label className="relative flex-1">
            <span className="sr-only">Search plants</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search by plant, size or item code"
              className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-9 pr-3 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500"
            />
          </label>
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by category"
            className="rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500 sm:w-56"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-gray-100 pt-3">
          <p className="text-sm text-gray-500">
            {visible.length > 0
              ? `Showing ${rangeStart}–${rangeEnd} of ${visible.length} ${
                  visible.length === 1 ? "variety" : "varieties"
                }`
              : "No varieties"}
          </p>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {selected.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedOnly((v) => !v);
                    setPage(1);
                  }}
                  aria-pressed={selectedOnly}
                  className={`${filterChip} ${
                    selectedOnly
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  }`}
                >
                  {selected.length} selected
                </button>
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-sm font-medium text-gray-500 hover:text-gray-800"
                >
                  Clear
                </button>
              </>
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
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <p className="text-gray-600">
            {selectedOnly
              ? "Nothing selected in this filter."
              : "No varieties match your search."}
          </p>
          <button
            type="button"
            onClick={() => setEnquiryOpen(true)}
            className="mt-2 text-sm font-medium text-emerald-600 hover:text-emerald-700"
          >
            Request a plant that isn&apos;t listed
          </button>
        </div>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
            {pageItems.map((item) => {
              const qty = quantities[item.key] ?? 0;
              const lineTotal = item.price * qty;
              const productUrl = `/product/${item.slug}`;
              return (
                <li
                  key={item.key}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-2.5 p-3 transition-colors sm:flex-nowrap sm:gap-4 sm:p-4 ${
                    qty > 0 ? "bg-emerald-50/60" : "hover:bg-gray-50"
                  }`}
                >
                  <Link
                    href={productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-gray-50 sm:h-16 sm:w-16"
                  >
                    <BulkImage src={item.image} alt={item.name} />
                  </Link>

                  <div className="min-w-0 flex-1">
                    <Link
                      href={productUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900 hover:text-emerald-800 sm:truncate">
                        {item.name}
                      </h3>
                    </Link>
                    <p className="mt-0.5 truncate text-xs text-gray-500">
                      {[item.category, item.size, item.itemCode].filter(Boolean).join(" · ")}
                    </p>
                  </div>

                  <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end sm:gap-5">
                    <div className="sm:w-28 sm:text-right">
                      {item.price > 0 ? (
                        <p className="text-sm font-semibold text-gray-900">
                          {formatPrice(item.price)}
                          <span className="text-xs font-normal text-gray-500"> /unit</span>
                        </p>
                      ) : (
                        <p className="text-xs text-gray-500">Rate on request</p>
                      )}
                      {lineTotal > 0 ? (
                        <p className="text-xs font-medium text-emerald-700">
                          ₹{Math.round(lineTotal).toLocaleString("en-IN")} total
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <div className="hidden items-center gap-0.5 sm:flex">
                        {STEPS.map((step) => (
                          <button
                            key={step}
                            type="button"
                            onClick={() => addQty(item.key, step)}
                            aria-label={`Add ${step} to ${item.name}`}
                            className="rounded-md px-1.5 py-1 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
                          >
                            +{step}
                          </button>
                        ))}
                      </div>

                      <div className="flex w-28 items-center rounded-lg border border-gray-300 bg-white focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500">
                        <button
                          type="button"
                          onClick={() => addQty(item.key, -1)}
                          disabled={qty === 0}
                          aria-label={`Decrease quantity for ${item.name}`}
                          className="px-2 py-1.5 text-gray-600 hover:text-emerald-700 disabled:text-gray-300"
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
                          className="w-full min-w-0 border-0 bg-transparent py-1.5 text-center text-sm font-semibold text-gray-900 placeholder:font-normal placeholder:text-gray-400 focus:outline-none focus:ring-0"
                        />
                        <button
                          type="button"
                          onClick={() => addQty(item.key, 1)}
                          aria-label={`Increase quantity for ${item.name}`}
                          className="px-2 py-1.5 text-gray-600 hover:text-emerald-700"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => setQty(item.key, 0)}
                        disabled={qty === 0}
                        aria-label={`Clear quantity for ${item.name}`}
                        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:invisible"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="flex w-full items-center gap-1 sm:hidden">
                    {STEPS.map((step) => (
                      <button
                        key={step}
                        type="button"
                        onClick={() => addQty(item.key, step)}
                        aria-label={`Add ${step} to ${item.name}`}
                        className="flex-1 rounded-md bg-emerald-50 py-1.5 text-xs font-semibold text-emerald-700 transition touch-manipulation active:bg-emerald-100"
                      >
                        +{step}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>

          <BulkPagination page={safePage} totalPages={totalPages} onChange={goToPage} />
        </>
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
