import type { Metadata } from "next";
import Link from "next/link";
import JsonLd from "../../components/seo/JsonLd";
import { PageHeader, PageShell } from "../../components/layout/Page";
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
    <PageShell width="narrow">
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

      <PageHeader
        breadcrumbs={createBreadcrumbs([{ name: "Plant Care Guides", path: "/blog" }])}
        title="Plant Care Guides"
        description="Care advice written for Indian conditions: light, heat, watering and the monsoon."
      />

      <ul className="space-y-4">
        {posts.map((post) => (
          <li key={post.slug}>
            <article className="group relative rounded-2xl border border-emerald-100 bg-white p-5 transition-colors hover:border-emerald-300 sm:p-6">
              <h2 className="font-space text-lg font-semibold text-green-900 sm:text-xl">
                <Link
                  href={`/blog/${post.slug}`}
                  className="after:absolute after:inset-0 group-hover:text-emerald-800"
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
          Browse the plant catalog →
        </Link>
      </p>
    </PageShell>
  );
}
