// Package handlers implements every HTTP endpoint for the API. There is no
// separate service/repository layer: each handler method on Handler talks
// to GORM, the cache, and external clients directly — appropriate for this
// codebase's size. See internal/docs/01-architecture.md for the rationale.
package handlers

import (
	"log"

	"github.com/go-redis/redis/v8"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/cache"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/config"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/services/storage"
	"gorm.io/gorm"
)

// Handler aggregates dependencies for HTTP handlers.
type Handler struct {
	DB           *gorm.DB
	Cfg          config.Config
	Redis        *redis.Client
	Cache        *cache.Helper
	ImageService *storage.ImageService
}

// New constructs a handler bundle.
func New(db *gorm.DB, cfg config.Config, rdb *redis.Client, imageService *storage.ImageService) *Handler {
	return &Handler{
		DB:           db,
		Cfg:          cfg,
		Redis:        rdb,
		Cache:        cache.NewHelper(rdb),
		ImageService: imageService,
	}
}

// AutoMigrate migrates all models.
func (h *Handler) AutoMigrate() error {
	if err := h.DB.AutoMigrate(
		&models.User{},
		&models.Category{},
		&models.Subcategory{},
		&models.Brand{},
		&models.Product{},
		&models.ProductSize{},
		&models.Attribute{},
		&models.Review{},
		&models.Order{},
		&models.OrderItem{},
		&models.Payment{},
		&models.Wishlist{},
		&models.RequestedProduct{},
		&models.OrderSupportRequest{},
	); err != nil {
		return err
	}
	h.EnsureSearchIndexes()
	return nil
}

// EnsureSearchIndexes adds trigram/GIN indexes used by product search.
// Failures are logged and ignored so local DBs without CREATE EXTENSION still boot.
func (h *Handler) EnsureSearchIndexes() {
	stmts := []string{
		`CREATE EXTENSION IF NOT EXISTS pg_trgm`,
		`CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name gin_trgm_ops)`,
		`CREATE INDEX IF NOT EXISTS idx_products_short_desc_trgm ON products USING gin (short_desc gin_trgm_ops)`,
		`CREATE INDEX IF NOT EXISTS idx_products_tags_gin ON products USING gin (tags)`,
		`CREATE INDEX IF NOT EXISTS idx_categories_name_trgm ON categories USING gin (name gin_trgm_ops)`,
		`CREATE INDEX IF NOT EXISTS idx_brands_name_trgm ON brands USING gin (name gin_trgm_ops)`,
		// Partial slug index speeds soft-deleted product lookups.
		`CREATE INDEX IF NOT EXISTS idx_products_slug_alive ON products (slug) WHERE deleted_at IS NULL`,
		`CREATE INDEX IF NOT EXISTS idx_product_sizes_product_id ON product_sizes (product_id)`,
		`CREATE INDEX IF NOT EXISTS idx_attributes_product_id ON attributes (product_id)`,
		`CREATE INDEX IF NOT EXISTS idx_reviews_product_id_created ON reviews (product_id, created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_products_featured_created ON products (created_at DESC) WHERE featured = true AND deleted_at IS NULL`,
		`CREATE INDEX IF NOT EXISTS idx_products_category_created ON products (category_id, created_at DESC) WHERE deleted_at IS NULL`,
		`CREATE INDEX IF NOT EXISTS idx_products_created ON products (created_at DESC) WHERE deleted_at IS NULL`,
	}
	for _, stmt := range stmts {
		if err := h.DB.Exec(stmt).Error; err != nil {
			log.Printf("[DB] search index skipped: %v", err)
		}
	}
}
