import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Breadcrumbs from "../../../components/seo/Breadcrumbs";
import JsonLd from "../../../components/seo/JsonLd";
import { getAllPosts, getPostBySlug } from "../../../lib/seo/blog";
import { getCategories } from "../../../lib/seo/catalog";
import { createBreadcrumbs, createPageMetadata } from "../../../lib/seo/metadata";
import { createArticleJsonLd } from "../../../lib/seo/jsonLd";

/** Articles are static content, so every one is pre-rendered at build time. */
export async function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) {
    return {
      title: "Article not found",
      robots: { index: false, follow: false },
    };
  }

  return createPageMetadata({
    title: post.title,
    description: post.description,
    path: `/blog/${post.slug}`,
    type: "article",
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function BlogArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) {
    notFound();
  }

  // Only link to categories that exist in the catalog, so an article can never
  // link to a 404 if a category is renamed or removed.
  const categories = await getCategories();
  const relatedCategories = post.relatedCategories
    .map((categorySlug) =>
      categories.find((category) => category.slug === categorySlug)
    )
    .filter((category): category is NonNullable<typeof category> =>
      Boolean(category)
    );

  const otherPosts = getAllPosts().filter((entry) => entry.slug !== post.slug);

  return (
    <main className="mx-auto max-w-3xl px-4 pt-6 pb-16 sm:px-6 sm:pt-8">
        <JsonLd
          id="article-jsonld"
          data={createArticleJsonLd({
            title: post.title,
            description: post.description,
            path: `/blog/${post.slug}`,
            publishedAt: post.publishedAt,
            updatedAt: post.updatedAt,
          })}
        />

        <Breadcrumbs
          items={createBreadcrumbs([
            { name: "Plant Care Guides", path: "/blog" },
            { name: post.title, path: `/blog/${post.slug}` },
          ])}
          className="mb-6"
        />

        <article>
          <header>
            <h1 className="font-space text-3xl font-semibold tracking-tight text-green-900 sm:text-4xl">
              {post.title}
            </h1>
            <p className="mt-3 text-base leading-relaxed text-gray-600">
              {post.description}
            </p>
            <p className="mt-4 text-xs text-gray-500">
              Published{" "}
              <time dateTime={post.publishedAt}>
                {formatDate(post.publishedAt)}
              </time>
              {post.updatedAt && (
                <>
                  <span aria-hidden="true"> · </span>
                  Updated{" "}
                  <time dateTime={post.updatedAt}>
                    {formatDate(post.updatedAt)}
                  </time>
                </>
              )}
              <span aria-hidden="true"> · </span>
              {post.readingMinutes} min read
              <span aria-hidden="true"> · </span>
              By the Growman team
            </p>
          </header>

          <div className="mt-8 space-y-8">
            {post.sections.map((section) => (
              <section key={section.heading}>
                <h2 className="font-space text-xl font-semibold text-green-900">
                  {section.heading}
                </h2>
                {section.paragraphs.map((paragraph) => (
                  <p
                    key={paragraph.slice(0, 40)}
                    className="mt-3 text-[15px] leading-relaxed text-gray-700"
                  >
                    {paragraph}
                  </p>
                ))}
                {section.bullets && (
                  <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-gray-700 marker:text-emerald-600">
                    {section.bullets.map((bullet) => (
                      <li key={bullet.slice(0, 40)}>{bullet}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </article>

        {relatedCategories.length > 0 && (
          <section className="mt-12 rounded-2xl border border-emerald-100 bg-white p-5 sm:p-6">
            <h2 className="text-base font-semibold text-green-900">
              Browse plants mentioned in this guide
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {relatedCategories.map((category) => (
                <li key={category.id}>
                  <Link
                    href={`/categories/${category.slug}`}
                    className="inline-block rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
                  >
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {otherPosts.length > 0 && (
          <section className="mt-8">
            <h2 className="text-base font-semibold text-green-900">
              More plant care guides
            </h2>
            <ul className="mt-3 space-y-2">
              {otherPosts.map((entry) => (
                <li key={entry.slug}>
                  <Link
                    href={`/blog/${entry.slug}`}
                    className="text-sm font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
                  >
                    {entry.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
    </main>
  );
}
