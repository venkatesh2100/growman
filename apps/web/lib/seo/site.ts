/**
 * Single source of truth for site-wide SEO values.
 *
 * Every value in `business` is taken from information already published on the
 * site (see `app/about/page.tsx` and `components/hompage/footer.tsx`). Nothing
 * here may be invented — if a field is unknown, leave it out rather than
 * guessing, because these values feed structured data that Google treats as
 * factual claims about the business.
 */

/** Canonical production origin. Override only for preview deployments. */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://growman.live"
).replace(/\/$/, "");

export const siteConfig = {
  name: "Growman",
  /**
   * Other names people use for the site. Google reads these from the WebSite
   * node to pick the site name shown in results, which matters because
   * "Growman" is shared with unrelated products and companies.
   */
  alternateName: ["Growman Live", "growman.live", "Growman Plant Store"],
  url: SITE_URL,
  // Brand first so a search for "growman" matches the start of the title.
  title: "Growman – Buy Plants Online in India | Indoor & Outdoor Plants",
  description:
    "Growman (growman.live) is an online plant store and nursery in Hyderabad. Buy indoor, outdoor, flowering, fruit and medicinal plants delivered across India.",
  /** Distinguishes this Growman from unrelated brands sharing the name. */
  disambiguatingDescription:
    "Growman is an online plant store and plant nursery based in Hyderabad, Telangana, India, selling live plants through growman.live and the Growman Android app.",
  /** Used for Open Graph / Twitter when a page has no image of its own. */
  ogImage: "/growman.png",
  locale: "en_IN",
} as const;

/**
 * Real, already-published business details. Consumed by LocalBusiness and
 * Organization structured data.
 */
export const business = {
  legalName: "Growman",
  /** Published on /about and in the footer. */
  parentOrganization: "Shiridi Sai Nursery",
  email: "growman.live@gmail.com",
  /** E.164 form of the published number +91 95535 70568. */
  telephone: "+919553570568",
  address: {
    locality: "Hyderabad",
    region: "Telangana",
    country: "IN",
  },
  /** Google Maps link for the Hyderabad store (from /about StoreLocatorMap). */
  mapsUrl: "https://maps.app.goo.gl/DUgWr7F8qkq79rDA7",
  /** Published as "9 AM – 7 PM (IST)", all days. */
  openingHours: {
    days: [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ],
    opens: "09:00",
    closes: "19:00",
  },
  areaServed: "India",
  /**
   * Only profiles whose URLs are actually known. The footer also renders a
   * Twitter icon, but it points at a malformed handle
   * (twitter.com/growman.live), so it is deliberately excluded from `sameAs`
   * until a real profile URL is confirmed.
   *
   * TODO: add the verified Facebook and X/Twitter profile URLs once known.
   */
  sameAs: [
    "https://www.instagram.com/growman.live/",
    "https://play.google.com/store/apps/details?id=com.venky2100.growman",
  ],
} as const;

/** Opening hours as shown to customers, e.g. "9 AM – 7 PM". */
export const openingHoursDisplay = "9 AM – 7 PM (IST), all days";

/**
 * Paths that must never be indexed or appear in the sitemap: authenticated
 * areas, transactional funnels and internal tooling.
 *
 * `/delete-account` is deliberately absent — it is a public information page
 * required by Google Play policy, so it stays crawlable and is only marked
 * noindex.
 */
export const PRIVATE_PATHS = [
  "/account",
  "/cart",
  "/checkout",
  "/orders",
  "/order-success",
  "/login",
  "/signup",
  "/forgot-password",
  "/wishlist",
  "/product/add",
  "/search",
  "/api",
] as const;

/** True when `path` is inside a private area and therefore not indexable. */
export function isPrivatePath(path: string): boolean {
  return PRIVATE_PATHS.some(
    (priv) => path === priv || path.startsWith(`${priv}/`)
  );
}
