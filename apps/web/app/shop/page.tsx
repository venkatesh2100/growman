import { Suspense } from 'react';
import type { Metadata } from 'next';
import PlantsLoading from '../../components/loading';
import ShopProducts from './ShopProducts';
import HeroSlider from './HeroSlider';
import Breadcrumbs from '../../components/seo/Breadcrumbs';
import Footer from '../../components/hompage/footer';
import { createBreadcrumbs, createPageMetadata } from '../../lib/seo/metadata';
import { hasShopFilter } from '../../lib/shopFilters';

// export const dynamic = 'force-dynamic';

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
    title: `Shop All Plants Online${pageSuffix}`,
    description:
      pageNumber > 1
        ? `Page ${pageNumber} of Growman's plant catalog — indoor, outdoor, flowering, ornamental, fruit and medicinal plants delivered across India.`
        : "Browse Growman's full plant catalog — indoor, outdoor, flowering, ornamental, fruit and medicinal plants, grown at our nursery and delivered across India.",
    // Paginated pages are self-canonical; page one drops the parameter.
    path: pageNumber > 1 ? `/shop?page=${pageNumber}` : '/shop',
    canonicalParams: ['page'],
  });
}

export default function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return (
    <main className="min-h-screen bg-gray-50">
      <HeroSlider />

      <div className="max-w-7xl mx-auto pt-6 sm:pt-8 md:pt-10 px-3 sm:px-4 pb-10 sm:pb-14">
        {/* The page previously had no h1 at all. It is rendered outside the
            Suspense boundary so it is in the HTML immediately, ahead of the
            product list. */}
        <header className="mb-6">
          <Breadcrumbs
            items={createBreadcrumbs([{ name: 'Shop', path: '/shop' }])}
            className="mb-3"
          />
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-green-800 mb-2">
            Shop All Plants
          </h1>
          <p className="max-w-3xl text-sm sm:text-base text-gray-600">
            The full Growman catalog — indoor foliage, outdoor and avenue
            plants, flowering and ornamental varieties, fruit and medicinal
            plants. Every listing shows the sizes and prices currently
            available.
          </p>
        </header>

        <Suspense fallback={<PlantsLoading />}>
          <ShopProducts searchParams={searchParams} />
        </Suspense>
      </div>

      <Footer />
    </main>
  );
}
