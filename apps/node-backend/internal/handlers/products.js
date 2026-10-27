// The shop catalog: product lists, product pages, search, and admin create, update, and delete.
//
// List, detail, related, featured, and search responses are cached. A product
// card carries its sizes, category, and brand, and image keys are turned into
// public image URLs before the JSON is stored. Creating a product can also
// create the category or subcategory named in the form. Stock, price, GST,
// and the featured flag live on the product row the admin saves.

import { Op, literal } from "sequelize";
import { json, error, decode } from "../../pkg/httpjson/httpjson.js";
import { parsePagination, buildPaginationMeta } from "../../pkg/pagination/pagination.js";
import {
  servePublic,
  hashKey,
  FeaturedProductsTTL,
  ProductDetailTTL,
  RelatedProductsTTL,
  KeyPrefixFeaturedProducts,
  KeyPrefixProductDetail,
  KeyPrefixRelatedProducts,
  KeyPrefixProductList,
  KeyPrefixProductSearch,
} from "../cache/cache.js";
import {
  Product,
  ProductSize,
  Attribute,
  Category,
  Subcategory,
  Brand,
  Review,
  User,
} from "../models/index.js";

// Full catalog pages stay cached for ten minutes. Search results expire sooner.
const LIST_TTL = 10 * 60 * 1000;
const SEARCH_TTL = 3 * 60 * 1000;
// Search SQL refers to the product table by this alias.
const PRODUCT_ALIAS = '"Product"';

// Columns an admin may set on a product. Anything else in the body is ignored.
const PRODUCT_KEYS = [
  "name", "slug", "description", "shortDesc", "fullDesc", "specifications", "taxInfo",
  "price", "mrp", "currency", "imageKey", "status", "featured", "tags", "stock",
  "trackInventory", "lowStockThreshold", "ratingAverage", "ratingCount",
  "hsnCode", "gstRate", "sizeClass", "bulky", "categoryId", "subcategoryId", "brandId",
];

// Thrown when a slug does not match a product or its category. The cache helper turns this into a 404.
function notFound() {
  const err = new Error("not found");
  err.code = "NOT_FOUND";
  return err;
}

// The cache helper uses this to tell a missing product apart from a database failure.
function isNotFound(err) {
  return err?.code === "NOT_FOUND";
}

// The shared product-card query, with sizes loaded in a separate query so a product with many sizes does not multiply rows.
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

// Apply the public description names to every product in a list.
function wireProducts(rows) {
  return (rows || []).map(wireProduct);
}

// The admin form may send either the API names or the column names. Both land on shortDesc and fullDesc.
function normalizeProductBody(body) {
  const src = { ...(body || {}) };
  if (Object.prototype.hasOwnProperty.call(src, "shortDescription")) src.shortDesc = src.shortDescription;
  if (Object.prototype.hasOwnProperty.call(src, "fullDescription")) src.fullDesc = src.fullDescription;
  return src;
}

// Keep only the product columns we know about.
function pickProduct(body) {
  const src = normalizeProductBody(body);
  const out = {};
  for (const key of PRODUCT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(src, key)) out[key] = src[key];
  }
  return out;
}

// Empty category, subcategory, and brand ids become null. A non-number stays null too.
function optionalId(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// One sellable size: label, price, stock, and its own image keys.
function sizeInput(size, productId) {
  const row = {
    label: size?.label ?? "",
    price: size?.price ?? 0,
    stock: size?.stock ?? 0,
    imageKeys: Array.isArray(size?.imageKeys) ? size.imageKeys : [],
  };
  if (productId) row.productId = productId;
  if (size?.sizeClass !== undefined) row.sizeClass = size.sizeClass;
  if (size?.bulky !== undefined) row.bulky = size.bulky;
  return row;
}

// A product attribute is a name and value pair, such as "Light" and "Indirect sun".
function attributeInput(attr, productId) {
  return {
    name: attr?.name ?? "",
    value: attr?.value ?? "",
    productId,
  };
}

// A URL slug is the lower-case name with spaces and underscores turned into dashes.
// Any other character is dropped.
export function generateSlug(name) {
  let slug = String(name ?? "").toLowerCase().replaceAll(" ", "-").replaceAll("_", "-");
  let out = "";
  for (const character of slug) {
    if ((character >= "a" && character <= "z") || (character >= "0" && character <= "9") || character === "-") out += character;
  }
  return out;
}

// A shopper's search text is escaped so % and _ are matched literally inside ILIKE.
function escapeLike(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

// After an admin edit, drop cached product, category, brand, and tag pages. A cache failure is logged and ignored.
async function safeInvalidate(handler) {
  try {
    await handler.invalidateCatalog();
  } catch (err) {
    console.error(err);
  }
}

// Serve a cached JSON body. On a miss, load() runs and the result is stored for ttl.
// A not-found error becomes the given 404 sentence. Any other failure becomes the 500 sentence.
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

// Newest products, one page at a time. The page of cards is cached.
export async function listProducts(req, res) {
  const pagination = parsePagination(req);
  const key = `${KeyPrefixProductList}p${pagination.page}:s${pagination.pageSize}`;
  await serveCached(this, req, res, key, LIST_TTL, async () => {
    const [total, products] = await Promise.all([
      Product.count(),
      Product.findAll(cardFind(this, {
        order: [["createdAt", "DESC"]],
        offset: pagination.offset,
        limit: pagination.pageSize,
      })),
    ]);
    // Image URLs are filled in before the page is cached, so the browser gets links it can load.
    const data = wireProducts(this.resolveProductImageURLsSlice(products));
    return JSON.stringify({
      data,
      pagination: buildPaginationMeta(pagination.page, pagination.pageSize, total),
    });
  }, "failed to fetch products");
}

// One product page, looked up by slug. The slug is capped at 180 characters.
export async function getProduct(req, res) {
  const slug = req.params.slug || "";
  if (!slug || Array.from(slug).length > 180) {
    error(res, 400, "invalid slug");
    return;
  }
  const key = KeyPrefixProductDetail + slug;
  await serveCached(this, req, res, key, ProductDetailTTL, async () => {
    const product = await this.loadProductDetail(slug);
    return JSON.stringify(wireProduct(this.resolveProductImageURLs(product)));
  }, "failed to fetch product", "product not found");
}

// Load the product and the pieces the product page shows: sizes, attributes, reviews, category, subcategory, and brand.
export async function loadProductDetail(slug) {
  const product = await Product.findOne({ where: { slug } });
  if (!product) throw notFound();

  const jobs = [
    ProductSize.findAll({ where: { productId: product.id } }),
    Attribute.findAll({ where: { productId: product.id } }),
    // The twelve newest reviews travel with the product. The public review list is a separate route.
    Review.findAll({
      where: { productId: product.id },
      order: [["createdAt", "DESC"]],
      limit: 12,
    }),
  ];
  const categoryJob = product.categoryId > 0
    ? Category.findOne({
      attributes: ["id", "name", "slug", "description"],
      where: { id: product.categoryId },
    })
    : Promise.resolve(null);
  const subId = optionalId(product.subcategoryId);
  const subcategoryJob = subId
    ? Subcategory.findOne({
      attributes: ["id", "name", "slug", "categoryId"],
      where: { id: subId },
    })
    : Promise.resolve(null);
  const brandId = optionalId(product.brandId);
  const brandJob = brandId
    ? Brand.findOne({
      attributes: ["id", "name", "slug"],
      where: { id: brandId },
    })
    : Promise.resolve(null);

  const [sizes, attributes, reviews, category, subcategoryRow, brandRow] = await Promise.all([
    ...jobs,
    categoryJob,
    subcategoryJob,
    brandJob,
  ]);

  // A product that points at a missing category is treated as missing.
  if (product.categoryId > 0 && !category) throw notFound();

  let subcategory = subcategoryRow;
  if (subId && !subcategory) subcategory = null;
  let brand = brandRow;
  if (brandId && !brand) brand = null;

  // Attach each reviewer's name. A missing account does not hide the review.
  if (reviews.length) {
    const userIds = [...new Set(reviews.map((rev) => rev.userId))];
    try {
      const users = await User.findAll({
        attributes: ["id", "name"],
        where: { id: userIds },
      });
      const byId = new Map(users.map((user) => [user.id, user]));
      for (const rev of reviews) {
        const user = byId.get(rev.userId);
        if (user) rev.setDataValue("user", user);
      }
    } catch {
      /* a missing author must not hide the review */
    }
  }

  product.setDataValue("sizes", sizes);
  product.setDataValue("attributes", attributes);
  product.setDataValue("reviews", reviews);
  product.setDataValue("category", category);
  product.setDataValue("subcategory", subcategory);
  product.setDataValue("brand", brand);
  return product;
}

// Admin: create a product. A new category or subcategory name is created when the form asks for one.
export async function createProduct(req, res) {
  const body = decode(req, res, "invalid payload");
  if (!body) return;

  try {
    let categoryId = optionalId(body.categoryId) || 0;
    let subcategoryId = optionalId(body.subcategoryId);

    // "New category" finds an existing slug or inserts the name the admin typed.
    if (body.newCategory && categoryId === 0) {
      const categorySlug = generateSlug(body.newCategory);
      try {
        const [category] = await Category.findOrCreate({
          where: { slug: categorySlug },
          defaults: { name: body.newCategory, slug: categorySlug, description: "" },
        });
        if (category.name !== body.newCategory) {
          await category.update({ name: body.newCategory });
        }
        categoryId = Number(category.id);
      } catch (err) {
        console.log(`[DB] Error creating/finding category: ${err.message}`);
        error(res, 500, "failed to create category");
        return;
      }
    }

    // A new subcategory is filed under the category chosen above.
    if (body.newSubcategory && categoryId > 0) {
      const subcategorySlug = generateSlug(body.newSubcategory);
      try {
        const [subcategory] = await Subcategory.findOrCreate({
          where: { slug: subcategorySlug, categoryId },
          defaults: { name: body.newSubcategory, slug: subcategorySlug, categoryId },
        });
        if (subcategory.name !== body.newSubcategory) {
          await subcategory.update({ name: body.newSubcategory });
        }
        subcategoryId = Number(subcategory.id);
      } catch (err) {
        console.log(`[DB] Error creating/finding subcategory: ${err.message}`);
        error(res, 500, "failed to create subcategory");
        return;
      }
    }

    if (!categoryId) {
      error(res, 400, "categoryId is required");
      return;
    }

    try {
      const category = await Category.findOne({ where: { id: categoryId } });
      if (!category) {
        error(res, 400, "category not found");
        return;
      }
    } catch (err) {
      console.log(`[DB] Error verifying category: ${err.message}`);
      error(res, 500, "failed to verify category");
      return;
    }

    // The subcategory must belong to that same category.
    if (subcategoryId) {
      try {
        const subcategory = await Subcategory.findOne({
          where: { id: subcategoryId, categoryId },
        });
        if (!subcategory) {
          error(res, 400, "subcategory not found or doesn't belong to category");
          return;
        }
      } catch (err) {
        console.log(`[DB] Error verifying subcategory: ${err.message}`);
        error(res, 500, "failed to verify subcategory");
        return;
      }
    }

    if (!subcategoryId) subcategoryId = null;
    const fields = pickProduct(body);
    fields.categoryId = categoryId;
    fields.subcategoryId = subcategoryId;
    if (!Object.prototype.hasOwnProperty.call(body, "brandId") || body.brandId == null || body.brandId === "") {
      fields.brandId = null;
    } else {
      fields.brandId = optionalId(body.brandId);
    }

    // Sizes and attributes are inserted with the product in one create.
    const include = [];
    if (Array.isArray(body.sizes)) {
      fields.sizes = body.sizes.map((size) => sizeInput(size));
      include.push({ model: ProductSize, as: "sizes" });
    }
    if (Array.isArray(body.attributes)) {
      fields.attributes = body.attributes.map((attr) => ({
        name: attr?.name ?? "",
        value: attr?.value ?? "",
      }));
      include.push({ model: Attribute, as: "attributes" });
    }

    let created;
    try {
      created = await Product.create(fields, include.length ? { include } : undefined);
    } catch (err) {
      console.log(`[DB] Error creating product: ${err.message}`);
      error(res, 500, "failed to create product");
      return;
    }

    await safeInvalidate(this);
    json(res, 201, wireProduct(created.toJSON()));
  } catch (err) {
    console.error(err);
    error(res, 500, "failed to create product");
  }
}

// Admin: update the product with this slug. Sizes and attributes with an id are updated; the rest are created.
export async function updateProduct(req, res) {
  const slug = req.params.slug;
  let existing;
  try {
    existing = await Product.findOne({ where: { slug } });
  } catch {
    error(res, 404, "product not found");
    return;
  }
  if (!existing) {
    error(res, 404, "product not found");
    return;
  }

  const body = decode(req, res, "invalid payload");
  if (!body) return;

  const fields = pickProduct(body);
  delete fields.id;
  if (Object.prototype.hasOwnProperty.call(fields, "categoryId")) {
    fields.categoryId = optionalId(fields.categoryId) || fields.categoryId;
  }
  if (Object.prototype.hasOwnProperty.call(fields, "subcategoryId")) {
    fields.subcategoryId = optionalId(fields.subcategoryId);
  }
  if (Object.prototype.hasOwnProperty.call(fields, "brandId")) {
    fields.brandId = optionalId(fields.brandId);
  }

  try {
    // Product, stock on each size, and attributes commit together.
    await this.sequelize.transaction(async (transaction) => {
      await existing.update(fields, { transaction });
      if (Array.isArray(body.sizes)) {
        for (const size of body.sizes) {
          const row = sizeInput(size, existing.id);
          if (size?.id) {
            await ProductSize.update(row, { where: { id: size.id }, transaction });
          } else {
            await ProductSize.create(row, { transaction });
          }
        }
      }
      if (Array.isArray(body.attributes)) {
        for (const attr of body.attributes) {
          const row = attributeInput(attr, existing.id);
          if (attr?.id) {
            await Attribute.update(row, { where: { id: attr.id }, transaction });
          } else {
            await Attribute.create(row, { transaction });
          }
        }
      }
    });
    await existing.reload();
    await safeInvalidate(this);
    json(res, 200, wireProduct(existing.toJSON()));
  } catch (err) {
    console.error(err);
    error(res, 500, "failed to update product");
  }
}

// Admin: remove the product with this slug, then clear the catalog cache.
export async function deleteProduct(req, res) {
  const slug = req.params.slug;
  try {
    await Product.destroy({ where: { slug } });
    await safeInvalidate(this);
    json(res, 200, { status: "deleted" });
  } catch (err) {
    console.error(err);
    error(res, 500, "failed to delete product");
  }
}

// Up to four other products in the same category, newest first.
export async function relatedProducts(req, res) {
  const slug = req.params.slug || "";
  const key = KeyPrefixRelatedProducts + slug;
  await serveCached(this, req, res, key, RelatedProductsTTL, async () => {
    const product = await Product.findOne({
      attributes: ["id", "slug", "categoryId"],
      where: { slug },
    });
    if (!product) throw notFound();
    const related = await Product.findAll(cardFind(this, {
      where: { categoryId: product.categoryId, slug: { [Op.ne]: slug } },
      order: [["createdAt", "DESC"]],
      limit: 4,
    }));
    return JSON.stringify(wireProducts(this.resolveProductImageURLsSlice(related)));
  }, "failed to fetch related products", "product not found");
}

// Products marked featured. One extra row is fetched so the page can say whether another page exists.
export async function featuredProducts(req, res) {
  const pagination = parsePagination(req);
  const key = `${KeyPrefixFeaturedProducts}:page:${pagination.page}:size:${pagination.pageSize}`;
  await serveCached(this, req, res, key, FeaturedProductsTTL, async () => {
    const limit = pagination.pageSize + 1;
    let products = await Product.findAll(cardFind(this, {
      where: { featured: true },
      order: [["createdAt", "DESC"]],
      offset: pagination.offset,
      limit,
    }));
    const hasNext = products.length > pagination.pageSize;
    if (hasNext) products = products.slice(0, pagination.pageSize);
    let total = pagination.offset + products.length;
    if (hasNext) total += 1;
    const meta = buildPaginationMeta(pagination.page, pagination.pageSize, total);
    meta.hasNext = hasNext;
    return JSON.stringify({
      data: wireProducts(this.resolveProductImageURLsSlice(products)),
      pagination: meta,
    });
  }, "failed to fetch featured products");
}

// Search name, short description, tags, category name, brand name, and the long description.
// An exact name ranks first, then a name that starts with the words, then a name that contains them.
export async function searchProducts(req, res) {
  const rawQ = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q;
  let query = String(rawQ ?? "").trim();
  if (!query) {
    json(res, 200, {
      data: [],
      pagination: buildPaginationMeta(1, 20, 0),
    });
    return;
  }
  // A very long query is cut to 80 characters before it is matched.
  const runes = Array.from(query);
  if (runes.length > 80) query = runes.slice(0, 80).join("");
  query = query.toLowerCase();
  const escaped = escapeLike(query);
  const like = `%${escaped}%`;
  const prefix = `${escaped}%`;
  const pagination = parsePagination(req);
  if (pagination.pageSize > 40) {
    pagination.pageSize = 40;
    pagination.offset = (pagination.page - 1) * pagination.pageSize;
  }

  const esc = (value) => this.sequelize.escape(value);
  // A product matches when the words appear in its name, blurb, tags, category, brand, or description.
  const matchSQL = `(
    ${PRODUCT_ALIAS}."name" ILIKE ${esc(like)} OR ${PRODUCT_ALIAS}."short_desc" ILIKE ${esc(like)}
    OR EXISTS (SELECT 1 FROM unnest(${PRODUCT_ALIAS}."tags") AS tag WHERE tag ILIKE ${esc(like)})
    OR EXISTS (
      SELECT 1 FROM categories
      WHERE categories.id = ${PRODUCT_ALIAS}."category_id"
        AND categories.deleted_at IS NULL
        AND categories.name ILIKE ${esc(like)}
    )
    OR EXISTS (
      SELECT 1 FROM brands
      WHERE brands.id = ${PRODUCT_ALIAS}."brand_id"
        AND brands.deleted_at IS NULL
        AND brands.name ILIKE ${esc(like)}
    )
    OR ${PRODUCT_ALIAS}."description" ILIKE ${esc(like)}
  )`;
  const rankSQL = `CASE
    WHEN lower(${PRODUCT_ALIAS}."name") = ${esc(query)} THEN 0
    WHEN lower(${PRODUCT_ALIAS}."name") LIKE ${esc(prefix)} THEN 1
    WHEN ${PRODUCT_ALIAS}."name" ILIKE ${esc(like)} THEN 2
    WHEN EXISTS (SELECT 1 FROM unnest(${PRODUCT_ALIAS}."tags") AS tag WHERE tag ILIKE ${esc(like)}) THEN 3
    WHEN ${PRODUCT_ALIAS}."short_desc" ILIKE ${esc(like)} THEN 4
    ELSE 5
  END ASC, ${PRODUCT_ALIAS}."created_at" DESC`;

  const key = `${KeyPrefixProductSearch}${hashKey(query)}:p${pagination.page}:s${pagination.pageSize}`;
  try {
    const raw = await this.cache.getOrLoadRaw(key, SEARCH_TTL, async () => {
      const where = literal(matchSQL);
      const countP = Product.count({ where });
      const findP = Product.findAll(cardFind(this, {
        where,
        order: literal(rankSQL),
        offset: pagination.offset,
        limit: pagination.pageSize,
      }));
      const [countRes, findRes] = await Promise.allSettled([countP, findP]);
      if (countRes.status === "rejected") throw countRes.reason;
      if (findRes.status === "rejected") throw findRes.reason;
      return JSON.stringify({
        data: wireProducts(this.resolveProductImageURLsSlice(findRes.value)),
        pagination: buildPaginationMeta(pagination.page, pagination.pageSize, countRes.value),
      });
    });
    servePublic(req, res, raw);
  } catch (err) {
    console.log(`[DB] Error searching products: ${err.message}`);
    error(res, 500, "failed to search products");
  }
}
