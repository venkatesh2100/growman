import type { Metadata } from "next";
import Link from "next/link";
import Footer from "../../components/hompage/footer";
import Breadcrumbs from "../../components/seo/Breadcrumbs";
import JsonLd from "../../components/seo/JsonLd";
import { getAllPosts } from "../../lib/seo/blog";
import { createBreadcrumbs, createPageMetadata } from "../../lib/seo/metadata";
import { createItemListJsonLd } from "../../lib/seo/jsonLd";

export const metadata: Metadata = createPageMetadata({
  title: "Plant Care Guides",
  description:
    "Practical plant care guidance for Indian homes and balconies — choosing indoor plants, watering correctly, and looking after outdoor plants through summer and the monsoon.",
  path: "/blog",
});

/** Format an ISO date for display and for the `datetime` attribute. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function BlogIndexPage() {
  const posts = getAllPosts();

  return (
    <>
      <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <JsonLd
          id="blog-itemlist"
          data={createItemListJsonLd({
            name: "Growman plant care guides",
            path: "/blog",
            items: posts.map((post) => ({
              name: post.title,
              path: `/blog/${post.slug}`,
            })),
          })}
        />

        <Breadcrumbs
          items={createBreadcrumbs([{ name: "Plant Care Guides", path: "/blog" }])}
          className="mb-6"
        />

        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-green-900">
          Plant Care Guides
        </h1>
        <p className="mt-3 max-w-2xl text-sm sm:text-base leading-relaxed text-gray-600">
          Guidance written for Indian growing conditions — the light, heat and
          monsoon humidity that actually determine whether a plant thrives.
        </p>

        <ul className="mt-8 space-y-6">
          {posts.map((post) => (
            <li
              key={post.slug}
              className="rounded-2xl border border-emerald-100/80 bg-white p-5 sm:p-6"
            >
              <article>
                <h2 className="text-xl font-semibold text-green-900">
                  <Link
                    href={`/blog/${post.slug}`}
                    className="hover:text-emerald-700 hover:underline"
                  >
                    {post.title}
                  </Link>
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">
                  {post.description}
                </p>
                <p className="mt-3 text-xs text-gray-500">
                  <time dateTime={post.publishedAt}>
                    {formatDate(post.publishedAt)}
                  </time>
                  <span aria-hidden="true"> · </span>
                  {post.readingMinutes} min read
                </p>
              </article>
            </li>
          ))}
        </ul>

        <p className="mt-10 text-sm">
          <Link
            href="/shop"
            className="font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
          >
            Browse plants at Growman →
          </Link>
        </p>
      </main>
      <Footer />
    </>
  );
}
