package handlers

import (
    "github.com/go-redis/redis/v8"
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
    ImageService *storage.ImageService
}

// New constructs a handler bundle.
func New(db *gorm.DB, cfg config.Config, rdb *redis.Client, imageService *storage.ImageService) *Handler {
    return &Handler{
        DB:           db,
        Cfg:          cfg,
        Redis:        rdb,
        ImageService: imageService,
    }
}

// AutoMigrate migrates all models.
func (h *Handler) AutoMigrate() error {
	return h.DB.AutoMigrate(
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
	)
}