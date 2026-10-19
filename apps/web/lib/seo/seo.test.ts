import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isPrivatePath, siteConfig } from "./site";
import {
  buildCanonicalUrl,
  createBreadcrumbs,
  createCategoryMetadata,
  createProductDescription,
  createProductMetadata,
  getProductImages,
  getProductPrice,
  getProductStock,
  truncateForMeta,
} from "./metadata";
import {
  createArticleJsonLd,
  createBreadcrumbJsonLd,
  createLocalBusinessJsonLd,
  createOrganizationJsonLd,
  createProductJsonLd,
} from "./jsonLd";
import { getAllPosts, getPostBySlug, posts } from "./blog";
import robots from "../../app/robots";
import type { Product } from "../types";
import type { ProductReview } from "../reviews";

/** Minimal product fixture; individual tests override only what they exercise. */
function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 68,
    createdAt: "2026-09-08T16:37:58Z",
    updatedAt: "2026-09-08T16:37:58Z",
    name: "Ashoka Tree (Polyalthia longifolia)",
    slug: "ashoka-tree-polyalthia-longifolia",
    description: "A tall, elegant evergreen tree with drooping green foliage.",
    price: 350,
    currency: "INR",
    imageUrl: "https://storage.googleapis.com/growman/products/ashoka.webp",
    featured: false,
    stock: 527,
    categoryId: 1,
    category: {
      id: 1,
      createdAt: "",
      updatedAt: "",
      name: "Outdoor Plants",
      slug: "outdoor-plants",
    },
    sizes: [],
    attributes: [],
    reviews: [],
    ...overrides,
  } as Product;
}

describe("canonical URLs", () => {
  it("uses the https growman.live origin", () => {
    assert.equal(siteConfig.url, "https://growman.live");
    assert.ok(buildCanonicalUrl("/shop").startsWith("https://growman.live/"));
  });

  it("has no trailing slash, and the homepage is the bare origin", () => {
    assert.equal(buildCanonicalUrl("/"), "https://growman.live");
    assert.equal(
      buildCanonicalUrl("/categories/indoor-plants/"),
      "https://growman.live/categories/indoor-plants"
    );
  });

  it("drops query parameters so filtered variants consolidate", () => {
    assert.equal(
      buildCanonicalUrl("/product/money-plant?sort=price&size=3"),
      "https://growman.live/product/money-plant"
    );
  });

  it("keeps only explicitly allowed parameters, for pagination", () => {
    assert.equal(
      buildCanonicalUrl("/shop?page=3&category=indoor", ["page"]),
      "https://growman.live/shop?page=3"
    );
  });

  it("strips fragments", () => {
    assert.equal(
      buildCanonicalUrl("/shop#shop-products"),
      "https://growman.live/shop"
    );
  });
});

describe("private routes", () => {
  const privateRoutes = [
    "/account",
    "/account/settings",
    "/cart",
    "/checkout",
    "/orders",
    "/login",
    "/signup",
    "/wishlist",
    "/product/add",
    "/search",
    "/api/products",
  ];

  it("recognises every authenticated or transactional path", () => {
    for (const route of privateRoutes) {
      assert.equal(isPrivatePath(route), true, `${route} should be private`);
    }
  });

  it("never treats public commercial pages as private", () => {
    for (const route of [
      "/",
      "/shop",
      "/categories",
      "/categories/indoor-plants",
      "/categories/indoor-plants/bonsai",
      "/product/money-plant",
      "/blog",
      "/blog/how-often-to-water-indoor-plants",
      "/about",
    ]) {
      assert.equal(isPrivatePath(route), false, `${route} should be public`);
    }
  });
});

describe("robots.txt", () => {
  const output = robots();

  it("advertises the sitemap", () => {
    assert.equal(output.sitemap, "https://growman.live/sitemap.xml");
  });

  it("allows crawling of the site root", () => {
    const rule = Array.isArray(output.rules) ? output.rules[0]! : output.rules!;
    assert.equal(rule.allow, "/");
  });

  it("disallows private areas but nothing that blocks rendering", () => {
    const rule = Array.isArray(output.rules) ? output.rules[0]! : output.rules!;
    const disallow = (rule.disallow ?? []) as string[];

    for (const path of ["/account", "/checkout", "/cart", "/search"]) {
      assert.ok(disallow.includes(path), `${path} should be disallowed`);
    }
    // Blocking these would stop Google indexing products or rendering pages.
    for (const path of ["/", "/product", "/categories", "/_next/", "/blog"]) {
      assert.ok(
        !disallow.includes(path),
        `${path} must not be disallowed`
      );
    }
  });

  it("anchors /product/add so product slugs beginning with 'add' stay crawlable", () => {
    const rule = Array.isArray(output.rules) ? output.rules[0]! : output.rules!;
    const disallow = (rule.disallow ?? []) as string[];
    assert.ok(disallow.includes("/product/add$"));
    assert.ok(!disallow.includes("/product/add"));
  });
});

describe("product metadata", () => {
  it("generates a unique title and canonical per product", () => {
    const metadata = createProductMetadata(makeProduct());
    assert.equal(
      metadata.title,
      "Ashoka Tree (Polyalthia longifolia) | Buy Online"
    );
    assert.equal(
      metadata.alternates?.canonical,
      "https://growman.live/product/ashoka-tree-polyalthia-longifolia"
    );
  });

  it("does not repeat the brand, which the layout title template appends", () => {
    const title = String(createProductMetadata(makeProduct()).title);
    assert.equal(title.match(/Growman/g), null);
  });

  it("derives descriptions from product data rather than boilerplate", () => {
    const first = createProductDescription(
      makeProduct({ shortDescription: "Compact indoor foliage plant." })
    );
    const second = createProductDescription(
      makeProduct({
        name: "Money Plant",
        shortDescription: "Trailing vine for shelves and hanging pots.",
      })
    );
    assert.notEqual(first, second);
    assert.equal(first, "Compact indoor foliage plant.");
  });

  it("composes a description from real fields when none is written", () => {
    const description = createProductDescription(
      makeProduct({
        description: undefined,
        shortDescription: undefined,
        fullDescription: undefined,
        sizes: [
          { id: 1, price: 350, stock: 4, label: "13 X 13" },
          { id: 2, price: 900, stock: 2, label: "18 X 18" },
        ] as Product["sizes"],
      })
    );
    assert.match(description, /Ashoka Tree/);
    assert.match(description, /₹350/);
    assert.ok(!description.includes("undefined"));
  });

  it("clips descriptions to a length search engines display", () => {
    const long = "Monstera deliciosa ".repeat(40);
    assert.ok(truncateForMeta(long).length <= 155);
  });

  it("uses summary_large_image and the product's own images for social cards", () => {
    const metadata = createProductMetadata(makeProduct());
    const twitter = metadata.twitter as { card?: string } | null | undefined;
    assert.equal(twitter?.card, "summary_large_image");
    const images = metadata.openGraph?.images as Array<{ url: string }>;
    assert.equal(
      images[0]?.url,
      "https://storage.googleapis.com/growman/products/ashoka.webp"
    );
  });

  it("falls back to the brand image when a product has none", () => {
    const metadata = createProductMetadata(
      makeProduct({ imageUrl: undefined, sizes: [] })
    );
    const images = metadata.openGraph?.images as Array<{ url: string }>;
    assert.equal(images[0]?.url, "https://growman.live/growman.png");
  });
});

describe("category metadata", () => {
  it("produces distinct descriptions for different categories", () => {
    const indoor = createCategoryMetadata({
      name: "Indoor Plants",
      path: "/categories/indoor-plants",
      description: "Indoor plants bring greenery into low-light rooms.",
      productCount: 12,
    });
    const outdoor = createCategoryMetadata({
      name: "Outdoor Plants",
      path: "/categories/outdoor-plants",
      description: "Outdoor plants are grown for terraces and gardens.",
      productCount: 20,
    });

    assert.notEqual(indoor.description, outdoor.description);
    assert.notEqual(indoor.title, outdoor.title);
    assert.equal(
      indoor.alternates?.canonical,
      "https://growman.live/categories/indoor-plants"
    );
  });
});

describe("breadcrumbs", () => {
  it("starts at Home and uses canonical URLs throughout", () => {
    const items = createBreadcrumbs([
      { name: "Plants", path: "/categories" },
      { name: "Indoor Plants", path: "/categories/indoor-plants" },
    ]);

    assert.deepEqual(items, [
      { name: "Home", url: "https://growman.live" },
      { name: "Plants", url: "https://growman.live/categories" },
      {
        name: "Indoor Plants",
        url: "https://growman.live/categories/indoor-plants",
      },
    ]);
  });

  it("emits positions in order", () => {
    const jsonLd = createBreadcrumbJsonLd(
      createBreadcrumbs([{ name: "Plants", path: "/categories" }])
    ) as { itemListElement: Array<{ position: number; item: string }> };

    assert.deepEqual(
      jsonLd.itemListElement.map((entry) => entry.position),
      [1, 2]
    );
  });
});

describe("Product structured data", () => {
  it("is valid JSON and serialises without error", () => {
    const jsonLd = createProductJsonLd(makeProduct());
    const roundTripped = JSON.parse(JSON.stringify(jsonLd));
    assert.equal(roundTripped["@type"], "Product");
    assert.equal(roundTripped["@context"], "https://schema.org");
  });

  it("carries real price, currency and availability", () => {
    const jsonLd = createProductJsonLd(
      makeProduct({
        sizes: [{ id: 72, price: 350, stock: 412, label: "13 X 13" }] as Product["sizes"],
      })
    ) as { offers: Record<string, unknown> };

    assert.equal(jsonLd.offers.priceCurrency, "INR");
    assert.equal(jsonLd.offers.price, "350.00");
    assert.equal(jsonLd.offers.availability, "https://schema.org/InStock");
  });

  it("reports out of stock honestly", () => {
    const jsonLd = createProductJsonLd(
      makeProduct({
        stock: 0,
        sizes: [{ id: 72, price: 350, stock: 0, label: "13 X 13" }] as Product["sizes"],
      })
    ) as { offers: Record<string, unknown> };

    assert.equal(jsonLd.offers.availability, "https://schema.org/OutOfStock");
  });

  it("expresses multiple sizes as an AggregateOffer price range", () => {
    const jsonLd = createProductJsonLd(
      makeProduct({
        sizes: [
          { id: 1, price: 350, stock: 5, label: "13 X 13" },
          { id: 2, price: 1200, stock: 2, label: "18 X 18" },
        ] as Product["sizes"],
      })
    ) as { offers: Record<string, unknown> };

    assert.equal(jsonLd.offers["@type"], "AggregateOffer");
    assert.equal(jsonLd.offers.lowPrice, "350.00");
    assert.equal(jsonLd.offers.highPrice, "1200.00");
    assert.equal(jsonLd.offers.offerCount, 2);
  });

  it("never invents ratings or reviews", () => {
    const jsonLd = createProductJsonLd(makeProduct({ ratingAverage: 0, ratingCount: 0 }));
    assert.equal("aggregateRating" in jsonLd, false);
    assert.equal("review" in jsonLd, false);
  });

  it("omits aggregateRating when nothing has been rated, even with a stray average", () => {
    const jsonLd = createProductJsonLd(makeProduct({ ratingAverage: 4.5, ratingCount: 0 }));
    assert.equal("aggregateRating" in jsonLd, false);
  });

  it("uses the product's own rating aggregate", () => {
    const jsonLd = createProductJsonLd(
      makeProduct({ ratingAverage: 4.5, ratingCount: 12 })
    ) as { aggregateRating: Record<string, unknown> };

    assert.equal(jsonLd.aggregateRating.ratingValue, 4.5);
    assert.equal(jsonLd.aggregateRating.reviewCount, 12);
    assert.equal(jsonLd.aggregateRating.bestRating, 5);
  });

  it("marks up only the approved reviews the page renders", () => {
    const published: ProductReview[] = [
      {
        id: 1,
        rating: 5,
        title: "Thriving",
        comment: "Arrived healthy and well packed.",
        author: "Asha",
        verifiedPurchase: true,
        images: [],
        createdAt: "2026-02-01T00:00:00Z",
      },
      {
        id: 2,
        rating: 4,
        title: "",
        comment: "Good size for the price.",
        author: "Ravi",
        verifiedPurchase: false,
        images: [],
        createdAt: "2026-02-02T00:00:00Z",
      },
    ];

    const jsonLd = createProductJsonLd(
      makeProduct({ ratingAverage: 4.5, ratingCount: 2 }),
      published
    ) as { review: Array<Record<string, unknown>> };

    assert.equal(jsonLd.review.length, 2);
    assert.deepEqual(jsonLd.review[0]!.author, { "@type": "Person", name: "Asha" });
    assert.equal(jsonLd.review[0]!.name, "Thriving");
    assert.equal("name" in jsonLd.review[1]!, false);
  });

  it("omits a GTIN, which is never fabricated, and uses the catalog id as SKU", () => {
    const jsonLd = createProductJsonLd(makeProduct());
    assert.equal("gtin" in jsonLd, false);
    assert.equal("gtin13" in jsonLd, false);
    assert.equal((jsonLd as { sku: string }).sku, "68");
  });
});

describe("product helpers", () => {
  it("reports the lowest offered price across sizes", () => {
    const price = getProductPrice(
      makeProduct({
        price: 999,
        sizes: [
          { id: 1, price: 900, stock: 1, label: "A" },
          { id: 2, price: 350, stock: 1, label: "B" },
        ] as Product["sizes"],
      })
    );
    assert.equal(price, 350);
  });

  it("sums stock across sizes", () => {
    const stock = getProductStock(
      makeProduct({
        sizes: [
          { id: 1, price: 900, stock: 4, label: "A" },
          { id: 2, price: 350, stock: 6, label: "B" },
        ] as Product["sizes"],
      })
    );
    assert.equal(stock, 10);
  });

  it("collects images without duplicates, primary first", () => {
    const images = getProductImages(
      makeProduct({
        imageUrl: "https://example.com/a.webp",
        sizes: [
          {
            id: 1,
            price: 1,
            stock: 1,
            label: "A",
            images: ["https://example.com/a.webp", "https://example.com/b.webp"],
          },
        ] as Product["sizes"],
      })
    );
    assert.deepEqual(images, [
      "https://example.com/a.webp",
      "https://example.com/b.webp",
    ]);
  });
});

describe("Organization and LocalBusiness structured data", () => {
  it("only lists social profiles whose URLs are confirmed", () => {
    const organization = createOrganizationJsonLd() as { sameAs: string[] };
    assert.ok(
      organization.sameAs.includes("https://www.instagram.com/growman.live/")
    );
    // The footer's Twitter icon pointed at a malformed handle, so it is excluded.
    assert.ok(!organization.sameAs.some((url) => url.includes("twitter.com")));
    assert.ok(!organization.sameAs.some((url) => url.includes("facebook.com")));
  });

  it("claims only the address granularity that is actually published", () => {
    const localBusiness = createLocalBusinessJsonLd() as {
      address: Record<string, unknown>;
      telephone: string;
    };
    assert.equal(localBusiness.address.addressLocality, "Hyderabad");
    assert.equal(localBusiness.address.addressRegion, "Telangana");
    assert.equal(localBusiness.address.addressCountry, "IN");
    // No street address or postcode is known, so none is asserted.
    assert.equal("streetAddress" in localBusiness.address, false);
    assert.equal("postalCode" in localBusiness.address, false);
    assert.equal(localBusiness.telephone, "+919553570568");
  });

  it("serialises to valid JSON", () => {
    for (const node of [
      createOrganizationJsonLd(),
      createLocalBusinessJsonLd(),
    ]) {
      assert.doesNotThrow(() => JSON.parse(JSON.stringify(node)));
    }
  });
});

describe("blog content model", () => {
  it("has unique slugs, titles and descriptions", () => {
    assert.equal(new Set(posts.map((post) => post.slug)).size, posts.length);
    assert.equal(new Set(posts.map((post) => post.title)).size, posts.length);
    assert.equal(
      new Set(posts.map((post) => post.description)).size,
      posts.length
    );
  });

  it("orders the index newest first", () => {
    const dates = getAllPosts().map((post) =>
      new Date(post.publishedAt).getTime()
    );
    assert.deepEqual(dates, [...dates].sort((a, b) => b - a));
  });

  it("returns undefined for an unknown slug so the page can 404", () => {
    assert.equal(getPostBySlug("no-such-article"), undefined);
  });

  it("only links to categories that exist in the catalog", () => {
    // Slugs confirmed against the live /categories endpoint.
    const realCategorySlugs = new Set([
      "avenue",
      "fruit-plants",
      "indoor-plants",
      "medicinal",
      "ornamental-plants",
      "outdoor-plants",
    ]);
    for (const post of posts) {
      for (const slug of post.relatedCategories) {
        assert.ok(
          realCategorySlugs.has(slug),
          `${post.slug} links to unknown category "${slug}"`
        );
      }
    }
  });

  it("builds Article data with a publication date and no invented author", () => {
    const post = posts[0]!;
    const jsonLd = createArticleJsonLd({
      title: post.title,
      description: post.description,
      path: `/blog/${post.slug}`,
      publishedAt: post.publishedAt,
    }) as { datePublished: string; author: Record<string, string> };

    assert.equal(jsonLd.datePublished, post.publishedAt);
    // Credited to the organisation, never to a fabricated person.
    assert.equal(jsonLd.author["@id"], "https://growman.live/#organization");
  });
});
