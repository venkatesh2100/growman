// The filter data the shop loads up front: product tags, and the catalog of categories.
//
// Tags are the distinct labels stored on products. The catalog response is
// those tags plus every category and its subcategories, so the storefront can
// draw filters without a second round trip. Both responses are cached.

import { QueryTypes } from "sequelize";
import { error } from "../../pkg/httpjson/httpjson.js";
import {
  servePublic,
  TagsTTL,
  CatalogTTL,
  KeyPrefixTags,
  KeyPrefixCatalog,
} from "../cache/cache.js";
import { Category, Subcategory } from "../models/index.js";

// Every non-blank tag used on a product, sorted A to Z.
// Tags live in an array column, so each array is opened up and the distinct values are kept.
export async function listProductTags() {
  const rows = await this.sequelize.query(
    `SELECT DISTINCT t
     FROM products p
     CROSS JOIN LATERAL unnest(p.tags) AS t
     WHERE t IS NOT NULL AND btrim(t) <> ''
     ORDER BY t`,
    { type: QueryTypes.SELECT },
  );
  const tags = [];
  for (const row of rows) {
    if (row.t != null && String(row.t).trim() !== "") tags.push(String(row.t));
  }
  tags.sort();
  return tags;
}

// The tag list, served from cache.
export async function listTags(req, res) {
  try {
    const raw = await this.cache.getOrLoadRaw(KeyPrefixTags, TagsTTL, async () => {
      const tags = await this.listProductTags();
      return JSON.stringify(tags);
    });
    servePublic(req, res, raw);
  } catch (err) {
    console.error(err);
    error(res, 500, "failed to fetch tags");
  }
}

// Tags and categories together. A cache hit returns the stored catalog. A miss rebuilds both lists.
export async function listCatalog(req, res) {
  try {
    const raw = await this.cache.getOrLoadRaw(KeyPrefixCatalog, CatalogTTL, async () => {
      const tags = await this.listProductTags();
      const categories = await Category.findAll({
        order: [["name", "ASC"]],
        include: [{ model: Subcategory, as: "subcategories", separate: true }],
      });
      return JSON.stringify({
        tags,
        categories: categories.map((category) => category.toJSON()),
      });
    });
    servePublic(req, res, raw);
  } catch (err) {
    console.error(err);
    error(res, 500, "failed to fetch catalog");
  }
}
