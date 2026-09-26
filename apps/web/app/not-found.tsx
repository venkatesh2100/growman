import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
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
    <main className="bg-green-50 flex flex-col items-center justify-center text-center px-4 py-12">
      <Image
        src="/404.png"
        alt=""
        aria-hidden="true"
        width={300}
        height={300}
        sizes="300px"
        className="h-auto"
      />
      <h1 className="text-4xl sm:text-5xl font-extrabold text-green-800 mb-4">
        Oops! Page not found
      </h1>
      <p className="text-lg text-green-700 max-w-md mb-6">
        The page you&rsquo;re looking for might have been pruned or never
        planted. Try one of these instead.
      </p>

      <div className="flex flex-col sm:flex-row gap-4">
        <Link
          href="/"
          className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg transition duration-200 shadow"
        >
          Back to home
        </Link>
        <Link
          href="/shop"
          className="border border-green-600 text-green-700 hover:bg-green-100 px-6 py-3 rounded-lg transition duration-200"
        >
          Browse all plants
        </Link>
        <Link
          href="/search"
          className="border border-green-600 text-green-700 hover:bg-green-100 px-6 py-3 rounded-lg transition duration-200"
        >
          Search the catalog
        </Link>
      </div>

      {collections.length > 0 && (
        <section className="mt-10 w-full max-w-2xl">
          <h2 className="text-lg font-semibold text-green-800 mb-3">
            Plant categories
          </h2>
          <ul className="flex flex-wrap justify-center gap-2">
            {collections.map(({ category }) => (
              <li key={category.id}>
                <Link
                  href={`/categories/${category.slug}`}
                  className="inline-block rounded-full bg-white px-3 py-1.5 text-sm font-medium text-emerald-800 border border-emerald-100 hover:bg-emerald-50"
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
