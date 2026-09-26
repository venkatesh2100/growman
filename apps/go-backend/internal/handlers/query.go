// Package-level query helpers shared across the product/category handlers —
// kept together here so the two "shapes" of a product query (full detail vs.
// lightweight card) and the catalog cache-busting rule live in one place.
package handlers

import (
	"context"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/cache"
	"gorm.io/gorm"
)

// db scopes a query to the request context (for cancellation/timeouts),
// tolerating a nil ctx so handlers can call it without a nil check.
func (h *Handler) db(ctx context.Context) *gorm.DB {
	if ctx == nil {
		return h.DB
	}
	return h.DB.WithContext(ctx)
}

// productCardQuery is the query shape for list/grid/search results: a narrow
// column set and shallow preloads (no Attributes, no Reviews), since a card
// only ever renders name/price/image/stock. Product *detail* pages instead
// use loadProductDetail (products.go), which loads associations in parallel.
func (h *Handler) productCardQuery(ctx context.Context) *gorm.DB {
	return h.db(ctx).
		Select(
			"id", "name", "slug", "short_desc", "price", "mrp", "currency",
			"image_key", "status", "featured", "tags", "stock",
			"category_id", "subcategory_id", "brand_id", "created_at", "updated_at",
		).
		Preload("Sizes", func(db *gorm.DB) *gorm.DB {
			return db.Select("id", "label", "price", "stock", "product_id", "image_keys")
		}).
		Preload("Category", func(db *gorm.DB) *gorm.DB {
			return db.Select("id", "name", "slug")
		}).
		Preload("Brand", func(db *gorm.DB) *gorm.DB {
			return db.Select("id", "name", "slug")
		})
}

// invalidateCatalog drops every cached product/category/brand/tag response.
// Called after any product, category, or brand mutation — broad but cheap
// (DeletePattern is a non-blocking Redis SCAN+UNLINK), so it's simpler and
// safer than tracking exactly which cache keys a given edit could affect.
func (h *Handler) invalidateCatalog(ctx context.Context) {
	if h.Cache == nil {
		return
	}
	_ = h.Cache.DeletePattern(ctx, "products:*")
	_ = h.Cache.DeletePattern(ctx, "categories:*")
	_ = h.Cache.Delete(ctx, cache.KeyPrefixBrands, cache.KeyPrefixTags, cache.KeyPrefixCatalog)
}
