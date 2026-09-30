import Link from 'next/link';
import type { Metadata } from 'next';
import ButtonLink from '../components/ui/ButtonLink';
import { getIndexableCollections } from '../lib/seo/catalog';

/**
 * Custom 404. Rendered on the server so it still returns a real HTTP 404
 * status, and it offers routes onward into the catalog instead of dead-ending
 * or redirecting to the homepage.
 */
export const metadata: Metadata = {
  title: 'Page Not Found',
  description: 'The page you were looking for does not exist.',
  robots: { index: false, follow: true },
};

export default async function NotFound() {
  const collections = await getIndexableCollections();

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 py-16 text-center">
      <p className="text-sm font-semibold tracking-[0.14em] text-emerald-700 uppercase">Error 404</p>
      <h1 className="mt-2 font-space text-3xl font-semibold tracking-tight text-green-900 sm:text-4xl">
        We couldn&rsquo;t find that page
      </h1>
      <p className="mt-3 max-w-md text-[15px] text-gray-600">
        The link may be out of date, or the page may have moved. You can browse the catalog or
        search for a plant instead.
      </p>

      <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
        <ButtonLink href="/shop">Browse plants</ButtonLink>
        <ButtonLink href="/search" tone="secondary">
          Search the catalog
        </ButtonLink>
        <ButtonLink href="/" tone="ghost">
          Go to the homepage
        </ButtonLink>
      </div>

      {collections.length > 0 && (
        <section className="mt-12 w-full" aria-labelledby="categories-heading">
          <h2 id="categories-heading" className="text-sm font-semibold text-green-900">
            Plant categories
          </h2>
          <ul className="mt-3 flex flex-wrap justify-center gap-2">
            {collections.map(({ category }) => (
              <li key={category.id}>
                <Link
                  href={`/categories/${category.slug}`}
                  className="inline-block rounded-full border border-emerald-100 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-700 hover:border-emerald-300 hover:text-green-900"
                >
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
