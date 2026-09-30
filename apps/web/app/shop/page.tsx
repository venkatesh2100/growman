import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import PlantsLoading from '../../components/loading';
import ShopProducts from './ShopProducts';
import Breadcrumbs from '../../components/seo/Breadcrumbs';
import { createBreadcrumbs, createPageMetadata } from '../../lib/seo/metadata';
import { buildFilterHref, hasShopFilter, type ShopFilter } from '../../lib/shopFilters';

/**
 * Query-parameter policy for the shop:
 *
 * - `/shop` is the canonical entry point and is indexable.
 * - `/shop?page=N` is self-canonical and indexable, so Google can crawl
 *   through the whole catalog rather than stopping at page one.
 * - Any faceted combination (category, brand, tag, price) is noindex/follow.
 *   Those views duplicate the dedicated category pages, and indexing every
 *   filter combination would generate large numbers of near-identical URLs.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<Metadata> {
  const resolved = await searchParams;
  const filtered = hasShopFilter(resolved);

  const rawPage = Array.isArray(resolved.page) ? resolved.page[0] : resolved.page;
  const page = Number(rawPage);
  const pageNumber = Number.isFinite(page) && page > 1 ? page : 1;

  if (filtered) {
    return {
      title: 'Shop Plants',
      description:
        'Filtered view of the Growman plant catalog. Browse our full collection or a specific plant category.',
      robots: { index: false, follow: true },
    };
  }

  const pageSuffix = pageNumber > 1 ? ` — Page ${pageNumber}` : '';

  return createPageMetadata({
    title: `Shop Plants Online${pageSuffix}`,
    description:
      pageNumber > 1
        ? `Page ${pageNumber} of Growman's plant catalog: indoor, outdoor, flowering, ornamental, fruit and medicinal plants delivered across India.`
        : "Browse Growman's plant catalog: indoor, outdoor, flowering, ornamental, fruit and medicinal plants, grown at our Hyderabad nursery and delivered across India.",
    // Paginated pages are self-canonical; page one drops the parameter.
    path: pageNumber > 1 ? `/shop?page=${pageNumber}` : '/shop',
    canonicalParams: ['page'],
  });
}

/** Shortcuts to the filters shoppers use most; every one maps to a non-empty catalog view. */
const QUICK_FILTERS: Array<{ label: string; filter: ShopFilter }> = [
  { label: 'Indoor', filter: { type: 'category', value: 'indoor-plants' } },
  { label: 'Outdoor', filter: { type: 'category', value: 'outdoor-plants' } },
  { label: 'Flowering', filter: { type: 'tag', value: 'flowering' } },
  { label: 'Air-purifying', filter: { type: 'tag', value: 'air purify' } },
  { label: 'Low light', filter: { type: 'tag', value: 'low-light' } },
  { label: 'Easy care', filter: { type: 'tag', value: 'stress-free' } },
  { label: 'Bonsai', filter: { type: 'tag', value: 'bonsai' } },
  { label: 'Fruit', filter: { type: 'category', value: 'fruit-plants' } },
  { label: 'Medicinal', filter: { type: 'category', value: 'medicinal' } },
  { label: 'Gifts', filter: { type: 'tag', value: 'gift' } },
];

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const resolved = await searchParams;
  const activeTag = single(resolved.tag)?.toLowerCase();
  const activeCategory = single(resolved.category);
  const unfiltered = !hasShopFilter(resolved);

  const chipClass = (active: boolean) =>
    `shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
      active
        ? 'border-emerald-600 bg-emerald-600 text-white'
        : 'border-emerald-100 bg-white text-gray-700 hover:border-emerald-300 hover:text-green-900'
    }`;

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 pt-6 pb-16 sm:px-6 sm:pt-8 lg:px-8">
        {/* The h1 is rendered outside the Suspense boundary so it is in the
            HTML immediately, ahead of the product list. */}
        <header className="mb-6">
          <Breadcrumbs items={createBreadcrumbs([{ name: 'Shop', path: '/shop' }])} className="mb-3" />
          <h1 className="font-space text-2xl font-semibold tracking-tight text-green-900 sm:text-3xl">
            Shop plants
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-gray-600 sm:text-[15px]">
            Indoor and outdoor plants, flowering and ornamental varieties, fruit and
            medicinal plants. Each listing shows the sizes and prices available today.
          </p>

          <nav aria-label="Quick filters" className="mt-5">
            <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
              <li>
                <Link href="/shop" className={chipClass(unfiltered)} aria-current={unfiltered ? 'page' : undefined}>
                  All
                </Link>
              </li>
              {QUICK_FILTERS.map(({ label, filter }) => {
                const active =
                  filter.type === 'tag'
                    ? activeTag === filter.value.toLowerCase()
                    : filter.type === 'category' && activeCategory === filter.value;
                return (
                  <li key={label}>
                    <Link
                      href={buildFilterHref(filter)}
                      className={chipClass(active)}
                      aria-current={active ? 'page' : undefined}
                    >
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </header>

        <Suspense fallback={<PlantsLoading />}>
          <ShopProducts searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
