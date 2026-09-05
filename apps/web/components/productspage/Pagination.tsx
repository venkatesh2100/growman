import Link from "next/link";

type PaginationProps = {
  page: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  /** Existing query params to preserve (category, tag, etc.) — page is overwritten. */
  searchParams?: { [key: string]: string | string[] | undefined };
  basePath?: string;
  hash?: string;
};

function buildHref(
  basePath: string,
  searchParams: { [key: string]: string | string[] | undefined } | undefined,
  page: number,
  hash?: string
): string {
  const params = new URLSearchParams();
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (key === "page" || value == null) continue;
      if (Array.isArray(value)) {
        value.forEach((v) => params.append(key, v));
      } else {
        params.set(key, value);
      }
    }
  }
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  const path = qs ? `${basePath}?${qs}` : basePath;
  return hash ? `${path}#${hash}` : path;
}

function pageWindow(current: number, total: number): number[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = new Set<number>([1, total, current - 1, current, current + 1]);
  return Array.from(pages)
    .filter((p) => p >= 1 && p <= total)
    .sort((a, b) => a - b);
}

export default function Pagination({
  page,
  totalPages,
  hasNext,
  hasPrev,
  searchParams,
  basePath = "/shop",
  hash = "shop-products",
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = pageWindow(page, totalPages);

  return (
    <nav
      className="mt-8 flex flex-col items-center gap-3 border-t border-emerald-100 pt-6 sm:flex-row sm:justify-between"
      aria-label="Product pagination"
    >
      <p className="text-sm text-slate-600">
        Page <span className="font-semibold text-slate-900">{page}</span> of{" "}
        <span className="font-semibold text-slate-900">{totalPages}</span>
      </p>

      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <Link
          href={buildHref(basePath, searchParams, Math.max(1, page - 1), hash)}
          aria-disabled={!hasPrev}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
            hasPrev
              ? "border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50"
              : "pointer-events-none border-slate-200 bg-slate-50 text-slate-400"
          }`}
        >
          Previous
        </Link>

        {pages.map((p, idx) => {
          const prev = pages[idx - 1];
          const showEllipsis = prev != null && p - prev > 1;
          return (
            <span key={p} className="flex items-center gap-1.5">
              {showEllipsis ? (
                <span className="px-1 text-slate-400" aria-hidden>
                  …
                </span>
              ) : null}
              <Link
                href={buildHref(basePath, searchParams, p, hash)}
                aria-current={p === page ? "page" : undefined}
                className={`min-w-9 rounded-lg border px-3 py-1.5 text-center text-sm font-medium transition ${
                  p === page
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50"
                }`}
              >
                {p}
              </Link>
            </span>
          );
        })}

        <Link
          href={buildHref(basePath, searchParams, page + 1, hash)}
          aria-disabled={!hasNext}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
            hasNext
              ? "border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50"
              : "pointer-events-none border-slate-200 bg-slate-50 text-slate-400"
          }`}
        >
          Next
        </Link>
      </div>
    </nav>
  );
}
