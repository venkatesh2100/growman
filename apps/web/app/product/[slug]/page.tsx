// app/product/[slug]/page.tsx
import { notFound } from "next/navigation";
import ProductPageClient from "./productClient";
import { apiFetch } from "../../../lib/api";
import type { Product } from "../../../lib/types";

export default async function Page({ 
  params, 
  searchParams 
}: { 
  params: { slug: string }; 
  searchParams: { size?: string }; 
}) {
  const response = await apiFetch(`/products/${params.slug}`, { cache: "no-store" });
  if (!response.ok) {
    return notFound();
  }

  const product: Product = await response.json();

  return (
    <ProductPageClient
      product={product}
      searchParams={searchParams}
      productSlug={params.slug}
    />
  );
}
