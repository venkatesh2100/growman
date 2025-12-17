package handlers

import (
	"encoding/json"
	"net/http"
	"context"
	"log"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/cache"
	"gorm.io/gorm"
)

func (h *Handler) ListProducts(w http.ResponseWriter, r *http.Request) {
	var products []models.Product
	if err := h.DB.Preload("Sizes").Preload("Attributes").Preload("Category").Preload("Subcategory").Preload("Brand").Find(&products).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch products")
		return
	}
	httpjson.JSON(w, http.StatusOK, products)
}

func (h *Handler) GetProduct(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	var product models.Product
	err := h.DB.Preload("Sizes").Preload("Attributes").Preload("Category").Preload("Subcategory").Preload("Brand").Preload("Reviews.User").Where("slug = ?", slug).First(&product).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			httpjson.Error(w, http.StatusNotFound, "product not found")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch product")
		return
	}
	httpjson.JSON(w, http.StatusOK, product)
}

func (h *Handler) CreateProduct(w http.ResponseWriter, r *http.Request) {
	var input models.Product
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid payload")
		return
	}

	if err := h.DB.Create(&input).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to create product")
		return
	}

	httpjson.JSON(w, http.StatusCreated, input)
}

func (h *Handler) UpdateProduct(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	var existing models.Product
	if err := h.DB.Where("slug = ?", slug).First(&existing).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "product not found")
		return
	}

	var input models.Product
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid payload")
		return
	}

	input.ID = existing.ID

	if err := h.DB.Session(&gorm.Session{FullSaveAssociations: true}).Save(&input).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to update product")
		return
	}

	httpjson.JSON(w, http.StatusOK, input)
}

func (h *Handler) DeleteProduct(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if err := h.DB.Where("slug = ?", slug).Delete(&models.Product{}).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to delete product")
		return
	}
	httpjson.JSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// func (h *Handler) FeaturedProducts(w http.ResponseWriter, r *http.Request) {
// 	var products []models.Product
// 	if err := h.DB.Preload("Sizes").Preload("Attributes").Preload("Category").Preload("Subcategory").Preload("Brand").Where("featured = ?", true).Find(&products).Error; err != nil {
// 		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch featured products")
// 		return
// 	}
// 	httpjson.JSON(w, http.StatusOK, products)
// }

func (h *Handler) RelatedProducts(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	var product models.Product
	if err := h.DB.Where("slug = ?", slug).First(&product).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "product not found")
		return
	}

	var related []models.Product
	err := h.DB.Preload("Sizes").Preload("Category").Preload("Subcategory").Preload("Brand").Where("category_id = ? AND slug <> ?", product.CategoryID, slug).Limit(4).Find(&related).Error
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch related products")
		return
	}

	httpjson.JSON(w, http.StatusOK, related)
}

//!
// FeaturedProducts returns products marked as featured, with Redis caching.
func (h *Handler) FeaturedProducts(w http.ResponseWriter, r *http.Request) {
    ctx := context.Background()
    cacheKey := "featured_products"

    // Initialize cache helper
    cacheHelper := cache.NewHelper(h.Redis)

    // Try to get from Redis cache
    var products []models.Product
    hit, err := cacheHelper.Get(ctx, cacheKey, &products)

    if err != nil {
        log.Printf("[CACHE] Cache error, falling back to DB: %v", err)
    } else if hit {
        log.Println("[CACHE] Featured products served from Redis")
        httpjson.JSON(w, http.StatusOK, products)
        return
    }

    // Cache miss: fetch from database
    log.Println("[CACHE] Cache miss, fetching featured products from DB")

    if err := h.DB.Preload("Sizes").
        Preload("Attributes").
        Preload("Category").
        Preload("Subcategory").
        Preload("Brand").
        Where("featured = ?", true).
        Find(&products).Error; err != nil {
        httpjson.Error(w, http.StatusInternalServerError, "failed to fetch featured products")
        return
    }

    log.Println("[DB] Featured products fetched from database")

    // Store in Redis cache (with 10-minute TTL)
    if err := cacheHelper.Set(ctx, cacheKey, products, 10*time.Minute); err != nil {
        log.Printf("[REDIS] Failed to cache featured products: %v", err)
    }

    httpjson.JSON(w, http.StatusOK, products)
}

// AllProducts returns all products with optional caching.
func (h *Handler) AllProducts(w http.ResponseWriter, r *http.Request) {
    ctx := context.Background()
    cacheKey := "all_products"

    cacheHelper := cache.NewHelper(h.Redis)

    var products []models.Product
    hit, _ := cacheHelper.Get(ctx, cacheKey, &products)

    if hit {
        log.Println("[CACHE] All products served from Redis")
        httpjson.JSON(w, http.StatusOK, products)
        return
    }

    // Fetch from database
    if err := h.DB.Preload("Sizes").
        Preload("Attributes").
        Preload("Category").
        Preload("Subcategory").
        Preload("Brand").
        Find(&products).Error; err != nil {
        httpjson.Error(w, http.StatusInternalServerError, "failed to fetch products")
        return
    }

    // Cache with 5-minute TTL
    cacheHelper.Set(ctx, cacheKey, products, 5*time.Minute)

    httpjson.JSON(w, http.StatusOK, products)
}

// InvalidateProductCache clears product-related cache entries.
func (h *Handler) InvalidateProductCache() error {
    if h.Redis == nil {
        return nil
    }

    ctx := context.Background()
    cacheHelper := cache.NewHelper(h.Redis)

    // Delete all product-related cache keys
    if err := cacheHelper.DeletePattern(ctx, "*products*"); err != nil {
        return err
    }

    log.Println("[CACHE] Product cache invalidated")
    return nil
}