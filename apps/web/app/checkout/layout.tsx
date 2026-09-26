import type { Metadata } from "next";
import { createNoindexMetadata } from "../../lib/seo/metadata";

/**
 * Metadata-only layout: this route is part of an authenticated or
 * transactional flow, so it must never be indexed. `follow` is retained so
 * crawlers can still traverse the site navigation rendered inside it.
 */
export const metadata: Metadata = createNoindexMetadata("Checkout");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
