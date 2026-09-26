import type { Product, Review } from "../types";
import { business, siteConfig } from "./site";
import {
  absoluteUrl,
  buildCanonicalUrl,
  createProductDescription,
  getProductImages,
  getProductStock,
  type BreadcrumbItem,
} from "./metadata";

/** A JSON-LD node, kept loose because Schema.org shapes vary per type. */
export type JsonLdObject = Record<string, unknown>;

const SCHEMA_CONTEXT = "https://schema.org";

/**
 * Organization node describing Growman itself. Referenced by `@id` from other
 * nodes so the brand is declared exactly once per page.
 */
export function createOrganizationJsonLd(): JsonLdObject {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "Organization",
    "@id": `${siteConfig.url}/#organization`,
    name: siteConfig.name,
    alternateName: [...siteConfig.alternateName],
    legalName: business.legalName,
    description: siteConfig.description,
    disambiguatingDescription: siteConfig.disambiguatingDescription,
    url: siteConfig.url,
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl("/icons/icon-512x512.png"),
      width: 512,
      height: 512,
    },
    email: business.email,
    telephone: business.telephone,
    address: {
      "@type": "PostalAddress",
      addressLocality: business.address.locality,
      addressRegion: business.address.region,
      addressCountry: business.address.country,
    },
    areaServed: {
      "@type": "Country",
      name: business.areaServed,
    },
    sameAs: [...business.sameAs],
  };
}

/**
 * WebSite node identifying the site and its publisher.
 *
 * No SearchAction is declared: /search is disallowed in robots.txt, so
 * advertising it would contradict that, and Google retired the sitelinks
 * search box in 2023.
 */
export function createWebSiteJsonLd(): JsonLdObject {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "WebSite",
    "@id": `${siteConfig.url}/#website`,
    name: siteConfig.name,
    alternateName: [...siteConfig.alternateName],
    url: siteConfig.url,
    description: siteConfig.description,
    inLanguage: "en-IN",
    publisher: { "@id": `${siteConfig.url}/#organization` },
  };
}

/**
 * LocalBusiness node for the nursery. Uses only the address granularity that
 * is actually published (locality + region); no street address is claimed
 * because none is known.
 *
 * TODO: add `streetAddress`, `postalCode` and `geo` once the exact nursery
 * address is confirmed — Google needs them for a Google Business Profile match.
 */
export function createLocalBusinessJsonLd(): JsonLdObject {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "GardenStore",
    "@id": `${siteConfig.url}/#localbusiness`,
    name: siteConfig.name,
    alternateName: [...siteConfig.alternateName],
    url: siteConfig.url,
    image: absoluteUrl(siteConfig.ogImage),
    logo: absoluteUrl("/icons/icon-512x512.png"),
    description: siteConfig.description,
    disambiguatingDescription: siteConfig.disambiguatingDescription,
    hasMap: business.mapsUrl,
    email: business.email,
    telephone: business.telephone,
    priceRange: "₹₹",
    currenciesAccepted: "INR",
    parentOrganization: {
      "@type": "Organization",
      name: business.parentOrganization,
    },
    address: {
      "@type": "PostalAddress",
      addressLocality: business.address.locality,
      addressRegion: business.address.region,
      addressCountry: business.address.country,
    },
    areaServed: {
      "@type": "Country",
      name: business.areaServed,
    },
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: [...business.openingHours.days],
        opens: business.openingHours.opens,
        closes: business.openingHours.closes,
      },
    ],
    sameAs: [...business.sameAs],
  };
}

/** BreadcrumbList matching the visible breadcrumb trail. */
export function createBreadcrumbJsonLd(
  items: BreadcrumbItem[]
): JsonLdObject {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

function availabilityUrl(inStock: boolean): string {
  return inStock
    ? "https://schema.org/InStock"
    : "https://schema.org/OutOfStock";
}

/**
 * Rating summary derived strictly from reviews the backend returned. Returns
 * null when there are none, so no page ever claims a rating it doesn't have.
 */
function createAggregateRating(reviews: Review[]): JsonLdObject | null {
  const rated = reviews.filter(
    (review) => Number.isFinite(Number(review.rating)) && Number(review.rating) > 0
  );
  if (rated.length === 0) return null;

  const total = rated.reduce((sum, review) => sum + Number(review.rating), 0);
  return {
    "@type": "AggregateRating",
    ratingValue: Number((total / rated.length).toFixed(1)),
    reviewCount: rated.length,
    bestRating: 5,
    worstRating: 1,
  };
}

/** Review nodes for genuine reviews only; empty array when there are none. */
function createReviewNodes(reviews: Review[]): JsonLdObject[] {
  return reviews
    .filter((review) => Number(review.rating) > 0 && review.comment?.trim())
    .slice(0, 10)
    .map((review) => ({
      "@type": "Review",
      reviewRating: {
        "@type": "Rating",
        ratingValue: Number(review.rating),
        bestRating: 5,
        worstRating: 1,
      },
      reviewBody: review.comment,
      datePublished: review.createdAt,
      ...(review.user?.name
        ? { author: { "@type": "Person", name: review.user.name } }
        : {}),
    }));
}

/**
 * Product structured data built only from fields the catalog actually
 * provides. Sizes become an AggregateOffer when they are priced differently,
 * which is how Google expects variant pricing to be expressed.
 */
export function createProductJsonLd(product: Product): JsonLdObject {
  const url = buildCanonicalUrl(`/product/${product.slug}`);
  const images = getProductImages(product).map((image) => absoluteUrl(image));
  const currency = product.currency || "INR";

  const sizes = (product.sizes ?? []).filter(
    (size) => Number.isFinite(Number(size.price)) && Number(size.price) > 0
  );

  const offers: JsonLdObject =
    sizes.length > 1
      ? {
          "@type": "AggregateOffer",
          url,
          priceCurrency: currency,
          lowPrice: Math.min(...sizes.map((size) => Number(size.price))).toFixed(2),
          highPrice: Math.max(...sizes.map((size) => Number(size.price))).toFixed(2),
          offerCount: sizes.length,
          availability: availabilityUrl(getProductStock(product) > 0),
          offers: sizes.map((size) => ({
            "@type": "Offer",
            url: `${url}?size=${size.id}`,
            name: size.label,
            sku: `${product.id}-${size.id}`,
            priceCurrency: currency,
            price: Number(size.price).toFixed(2),
            availability: availabilityUrl(Number(size.stock) > 0),
            itemCondition: "https://schema.org/NewCondition",
          })),
        }
      : {
          "@type": "Offer",
          url,
          priceCurrency: currency,
          price: Number(sizes[0]?.price ?? product.price).toFixed(2),
          availability: availabilityUrl(getProductStock(product) > 0),
          itemCondition: "https://schema.org/NewCondition",
          seller: { "@id": `${siteConfig.url}/#organization` },
        };

  const aggregateRating = createAggregateRating(product.reviews ?? []);
  const reviews = createReviewNodes(product.reviews ?? []);

  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "Product",
    name: product.name,
    url,
    description: createProductDescription(product),
    // The catalog has no dedicated SKU or GTIN column, so the stable database
    // id is used as the merchant identifier. GTINs are never invented.
    sku: String(product.id),
    ...(images.length > 0 ? { image: images } : {}),
    ...(product.brand?.name
      ? { brand: { "@type": "Brand", name: product.brand.name } }
      : {}),
    ...(product.category?.name ? { category: product.category.name } : {}),
    ...(product.attributes && product.attributes.length > 0
      ? {
          additionalProperty: product.attributes.map((attribute) => ({
            "@type": "PropertyValue",
            name: attribute.name,
            value: attribute.value,
          })),
        }
      : {}),
    offers,
    ...(aggregateRating ? { aggregateRating } : {}),
    ...(reviews.length > 0 ? { review: reviews } : {}),
  };
}

/** ItemList summarising the products shown on a listing page. */
export function createItemListJsonLd(options: {
  name: string;
  path: string;
  items: Array<{ name: string; path: string }>;
}): JsonLdObject {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "ItemList",
    name: options.name,
    url: buildCanonicalUrl(options.path),
    numberOfItems: options.items.length,
    itemListElement: options.items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: buildCanonicalUrl(item.path),
    })),
  };
}

/** CollectionPage node for category listings. */
export function createCollectionPageJsonLd(options: {
  name: string;
  description: string;
  path: string;
}): JsonLdObject {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "CollectionPage",
    name: options.name,
    description: options.description,
    url: buildCanonicalUrl(options.path),
    isPartOf: { "@id": `${siteConfig.url}/#website` },
  };
}

/**
 * FAQPage node built from the questions and answers actually rendered on the
 * page. Passing anything not visible to users would violate Google's FAQ
 * guidelines, so callers must supply the same array they render.
 */
export function createFaqJsonLd(
  faqs: ReadonlyArray<{ q: string; a: string }>
): JsonLdObject {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  };
}

/** Article node for blog posts. */
export function createArticleJsonLd(options: {
  title: string;
  description: string;
  path: string;
  image?: string;
  publishedAt: string;
  updatedAt?: string;
}): JsonLdObject {
  const url = buildCanonicalUrl(options.path);
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "Article",
    headline: options.title,
    description: options.description,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    datePublished: options.publishedAt,
    dateModified: options.updatedAt ?? options.publishedAt,
    inLanguage: "en-IN",
    // The blog is written and maintained by the Growman team; no individual
    // author names are invented.
    author: { "@id": `${siteConfig.url}/#organization` },
    publisher: { "@id": `${siteConfig.url}/#organization` },
    ...(options.image ? { image: absoluteUrl(options.image) } : {}),
  };
}
