import type { MetadataRoute } from "next";

/**
 * The admin panel is an internal tool with no public content, so the entire
 * host is disallowed. No sitemap is advertised.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: "/",
      },
    ],
  };
}
