import type { Metadata } from "next";
import { createNoindexMetadata } from "../../lib/seo/metadata";

/**
 * Kept crawlable because Google Play requires a publicly reachable
 * account-deletion URL, but noindex because it has no search value.
 */
export const metadata: Metadata = createNoindexMetadata("Delete Your Account");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
