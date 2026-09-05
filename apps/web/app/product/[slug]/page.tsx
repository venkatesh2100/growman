// app/product/[slug]/page.tsx
import { notFound } from "next/navigation";
import ProductPageClient from "./productClient";
import { apiFetch } from "../../../lib/api";
import type { Product } from "../../../lib/types";

export default async function Page({ 
  params, 
  searchParams 
}: { 
  params: Promise<{ slug: string }>; 
  searchParams: Promise<{ size?: string }>; 
}) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const response = await apiFetch(`/products/${resolvedParams.slug}`, { cache: "no-store" });
  if (!response.ok) {
    return notFound();
  }

  const product: Product = await response.json();
// console.log(product);
  return (
    <ProductPageClient
      product={product}
      searchParams={resolvedSearchParams}
      productSlug={resolvedParams.slug}
    />
  );
}
