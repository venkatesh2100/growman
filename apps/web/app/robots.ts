import type { MetadataRoute } from "next";
import { siteConfig } from "../lib/seo/site";

/**
 * Serves /robots.txt.
 *
 * Only authenticated, transactional and internal routes are disallowed.
 * Product, category and blog pages stay fully crawlable, as do `/_next/`
 * assets and images — blocking those would stop Google rendering the site.
 *
 * Entries are prefix matches, so `/account` also covers `/account/orders`.
 * `/product/add$` is anchored deliberately: an unanchored `/product/add`
 * would also block a real product whose slug happened to begin with "add".
 */
const DISALLOW = [
  "/account",
  "/cart",
  "/checkout",
  "/orders",
  "/order-success",
  "/login",
  "/signup",
  "/forgot-password",
  "/wishlist",
  "/product/add$",
  // Internal search results: `?q=` would otherwise yield unbounded thin URLs.
  "/search",
  "/api/",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: DISALLOW,
      },
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  };
}
