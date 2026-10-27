// Shared catalog queries used by product lists, category pages, and search.
//
// A product card is the short shape the grids show: price, stock, tags,
// sizes, category, and brand. After an admin changes the catalog, the
// cached product, category, brand, tag, and catalog pages are dropped so
// the shop shows the new data.

import { ProductSize, Category, Brand } from "../models/index.js";
import * as cache from "../cache/cache.js";

// Columns and relations for a product card. Stock on the product and on each size is included.
export function productCardQuery() {
  return {
    attributes: [
      "id", "name", "slug", "shortDesc", "price", "mrp", "currency",
      "imageKey", "status", "featured", "tags", "stock",
      "categoryId", "subcategoryId", "brandId", "createdAt", "updatedAt",
    ],
    include: [
      { model: ProductSize, as: "sizes", attributes: ["id", "label", "price", "stock", "productId", "imageKeys"] },
      { model: Category, as: "category", attributes: ["id", "name", "slug"] },
      { model: Brand, as: "brand", attributes: ["id", "name", "slug"] },
    ],
  };
}

// Forget cached catalog pages after a product, category, review, or brand change.
export async function invalidateCatalog() {
  if (!this.cache) return;
  await this.cache.deletePattern("products:*");
  await this.cache.deletePattern("categories:*");
  await this.cache.delete(cache.KeyPrefixBrands, cache.KeyPrefixTags, cache.KeyPrefixCatalog);
}
