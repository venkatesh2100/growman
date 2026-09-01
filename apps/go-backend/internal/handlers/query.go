package handlers

import (
	"context"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/cache"
	"gorm.io/gorm"
)

func (h *Handler) db(ctx context.Context) *gorm.DB {
	if ctx == nil {
		return h.DB
	}
	return h.DB.WithContext(ctx)
}

func (h *Handler) productListQuery(ctx context.Context) *gorm.DB {
	return h.db(ctx).
		Preload("Sizes").
		Preload("Attributes").
		Preload("Category").
		Preload("Subcategory").
		Preload("Brand")
}

// productCardQuery is optimized for list/grid/search cards: fewer columns, no attributes.
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

func (h *Handler) invalidateCatalog(ctx context.Context) {
	if h.Cache == nil {
		return
	}
	_ = h.Cache.DeletePattern(ctx, "products:*")
	_ = h.Cache.DeletePattern(ctx, "categories:*")
	_ = h.Cache.Delete(ctx, cache.KeyPrefixBrands, cache.KeyPrefixTags, cache.KeyPrefixCatalog)
}

func publicReviewUser(db *gorm.DB) *gorm.DB {
	return db.Select("id", "name")
}
