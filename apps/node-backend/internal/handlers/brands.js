// Brand names shown on the shop.
//
// The full list is cached and returned A to Z. Product cards link to a brand
// by id; this route is the list the filters and admin forms use.

import { error } from "../../pkg/httpjson/httpjson.js";
import { servePublic, BrandsTTL, KeyPrefixBrands } from "../cache/cache.js";
import { Brand } from "../models/index.js";

// Every brand, A to Z. A cache hit returns the stored JSON. A miss loads brands and stores them.
export async function listBrands(req, res) {
  try {
    const raw = await this.cache.getOrLoadRaw(KeyPrefixBrands, BrandsTTL, async () => {
      const brands = await Brand.findAll({ order: [["name", "ASC"]] });
      return JSON.stringify(brands.map((brand) => brand.toJSON()));
    });
    servePublic(req, res, raw);
  } catch (err) {
    console.error(err);
    error(res, 500, "failed to fetch brands");
  }
}
