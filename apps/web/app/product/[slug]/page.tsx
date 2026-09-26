// app/product/[slug]/page.tsx
import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ProductPageClient from "./productClient";
import JsonLd from "../../../components/seo/JsonLd";
import { apiFetch } from "../../../lib/api";
import type { Product } from "../../../lib/types";
import {
  createBreadcrumbs,
  createProductMetadata,
} from "../../../lib/seo/metadata";
import {
  createBreadcrumbJsonLd,
  createProductJsonLd,
} from "../../../lib/seo/jsonLd";

/**
 * Load one product by slug, returning null when it does not exist.
 *
 * `cache` means `generateMetadata` and the page body share a single request
 * per render instead of hitting the backend twice. Prices and stock stay
 * uncached across requests so inventory is never stale.
 */
const getProduct = cache(async (slug: string): Promise<Product | null> => {
  try {
    const response = await apiFetch(`/products/${slug}`, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as Product;
  } catch (error) {
    console.warn(`Failed to load product "${slug}":`, error);
    return null;
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);

  // No metadata is fabricated for a product that does not exist; the page
  // itself returns a real 404 below.
  if (!product) {
    return {
      title: "Product not found",
      robots: { index: false, follow: false },
    };
  }

  return createProductMetadata(product);
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ size?: string }>;
}) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const product = await getProduct(resolvedParams.slug);

  // Missing products must return HTTP 404, not a 200 "not found" page.
  if (!product) {
    notFound();
  }

  const breadcrumbs = createBreadcrumbs([
    { name: "Plants", path: "/categories" },
    ...(product.category
      ? [
          {
            name: product.category.name,
            path: `/categories/${product.category.slug}`,
          },
        ]
      : []),
    ...(product.category && product.subcategory
      ? [
          {
            name: product.subcategory.name,
            path: `/categories/${product.category.slug}/${product.subcategory.slug}`,
          },
        ]
      : []),
    { name: product.name, path: `/product/${product.slug}` },
  ]);

  return (
    <>
      <JsonLd
        id="product-jsonld"
        data={[
          createProductJsonLd(product),
          createBreadcrumbJsonLd(breadcrumbs),
        ]}
      />
      <ProductPageClient
        product={product}
        searchParams={resolvedSearchParams}
        productSlug={resolvedParams.slug}
      />
    </>
  );
}
