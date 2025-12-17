package handlers

import (
	"github.com/venkatesh2100/growman/apps/go-backend/internal/config"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"gorm.io/gorm"
)

// Handler aggregates dependencies for HTTP handlers.
type Handler struct {
	DB  *gorm.DB
	Cfg config.Config
}

// New constructs a handler bundle.
func New(db *gorm.DB, cfg config.Config) *Handler {
	return &Handler{DB: db, Cfg: cfg}
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
	)
}
