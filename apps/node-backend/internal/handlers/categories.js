// Shop categories and the products filed under them.
//
// The category list, one category, its subcategories, and the product cards
// for a category or subcategory are all cached. Product cards include sizes,
// and image keys are turned into public image URLs before the JSON is stored.
// A subcategory's products are only returned when that subcategory belongs
// to the category in the URL.

import { error } from "../../pkg/httpjson/httpjson.js";
import {
  servePublic,
  AllCategoriesTTL,
  CategoryDetailTTL,
  KeyPrefixAllCategories,
  KeyPrefixCategoryDetail,
  KeyPrefixSubcategories,
  KeyPrefixCatProducts,
  KeyPrefixSubcatProducts,
} from "../cache/cache.js";
import { Category, Subcategory, Product } from "../models/index.js";

// Product cards for a category stay cached for ten minutes.
const PRODUCTS_TTL = 10 * 60 * 1000;

// Thrown when the slug does not match. The cache helper turns this into a 404.
function notFound() {
  const err = new Error("not found");
  err.code = "NOT_FOUND";
  return err;
}

// The cache helper uses this to tell a missing category apart from a database failure.
function isNotFound(err) {
  return err?.code === "NOT_FOUND";
}

// The shared product-card query, with sizes loaded separately so many sizes do not multiply rows.
function cardFind(handler, extra = {}) {
  const base = handler.productCardQuery();
  const include = (base.include || []).map((entry) => (
    entry.as === "sizes" ? { ...entry, separate: true } : entry
  ));
  return { ...base, ...extra, include, subQuery: false };
}

// The API calls the short and full blurbs shortDescription and fullDescription.
function wireProduct(body) {
  if (!body || typeof body !== "object") return body;
  if (Object.prototype.hasOwnProperty.call(body, "shortDesc")) body.shortDescription = body.shortDesc;
  if (Object.prototype.hasOwnProperty.call(body, "fullDesc")) body.fullDescription = body.fullDesc;
  return body;
}

// Serve a cached JSON body. On a miss, load() runs and the result is stored for ttl.
async function serveCached(handler, req, res, key, ttl, load, errorMsg, notFoundMsg) {
  try {
    const raw = await handler.cache.getOrLoadRaw(key, ttl, load);
    servePublic(req, res, raw);
  } catch (err) {
    if (notFoundMsg && isNotFound(err)) {
      error(res, 404, notFoundMsg);
      return;
    }
    console.error(err);
    error(res, 500, errorMsg);
  }
}

// Every category, A to Z, with its subcategories. The whole list is cached.
export async function listCategories(req, res) {
  await serveCached(this, req, res, KeyPrefixAllCategories, AllCategoriesTTL, async () => {
    const categories = await Category.findAll({
      order: [["name", "ASC"]],
      include: [{ model: Subcategory, as: "subcategories", separate: true }],
    });
    return JSON.stringify(categories.map((category) => category.toJSON()));
  }, "failed to fetch categories");
}

// One category and its subcategories, looked up by slug.
export async function getCategory(req, res) {
  const slug = req.params.slug || "";
  const key = KeyPrefixCategoryDetail + slug;
  await serveCached(this, req, res, key, CategoryDetailTTL, async () => {
    const category = await Category.findOne({
      where: { slug },
      include: [{ model: Subcategory, as: "subcategories", separate: true }],
    });
    if (!category) throw notFound();
    return JSON.stringify(category.toJSON());
  }, "failed to fetch category", "category not found");
}

// Subcategories of the category with this slug, A to Z.
export async function listSubcategories(req, res) {
  const slug = req.params.slug || "";
  const key = KeyPrefixSubcategories + slug;
  await serveCached(this, req, res, key, CategoryDetailTTL, async () => {
    const category = await Category.findOne({
      attributes: ["id", "slug"],
      where: { slug },
    });
    if (!category) throw notFound();
    const subcategories = await Subcategory.findAll({
      where: { categoryId: category.id },
      order: [["name", "ASC"]],
    });
    return JSON.stringify(subcategories.map((subcategory) => subcategory.toJSON()));
  }, "failed to fetch subcategories", "category not found");
}

// Up to 200 newest products in this category. Image URLs are filled in before the list is cached.
export async function productsByCategory(req, res) {
  const slug = req.params.slug || "";
  const key = KeyPrefixCatProducts + slug;
  await serveCached(this, req, res, key, PRODUCTS_TTL, async () => {
    const category = await Category.findOne({
      attributes: ["id", "slug"],
      where: { slug },
    });
    if (!category) throw notFound();
    const products = await Product.findAll(cardFind(this, {
      where: { categoryId: category.id },
      order: [["createdAt", "DESC"]],
      limit: 200,
    }));
    return JSON.stringify(this.resolveProductImageURLsSlice(products).map(wireProduct));
  }, "failed to fetch products", "category not found");
}

// Up to 200 newest products in this subcategory. The subcategory must belong to the category in the URL.
export async function productsBySubcategory(req, res) {
  const catSlug = req.params.slug || "";
  const subSlug = req.params.subSlug || "";
  const key = KeyPrefixSubcatProducts + catSlug + ":" + subSlug;
  await serveCached(this, req, res, key, PRODUCTS_TTL, async () => {
    const category = await Category.findOne({
      attributes: ["id", "slug"],
      where: { slug: catSlug },
    });
    if (!category) throw notFound();
    const subcategory = await Subcategory.findOne({
      attributes: ["id", "slug", "categoryId"],
      where: { slug: subSlug, categoryId: category.id },
    });
    if (!subcategory) throw notFound();
    const products = await Product.findAll(cardFind(this, {
      where: { subcategoryId: subcategory.id },
      order: [["createdAt", "DESC"]],
      limit: 200,
    }));
    return JSON.stringify(this.resolveProductImageURLsSlice(products).map(wireProduct));
  }, "failed to fetch products", "category not found");
}
