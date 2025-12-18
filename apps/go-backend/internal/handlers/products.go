package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/cache"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"gorm.io/gorm"
)

// ListProducts returns all products with Redis caching.
func (h *Handler) ListProducts(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()
	productCache := cache.NewProductCache(h.Redis)

	var products []models.Product
	hit, err := productCache.GetAllProducts(ctx, &products)
	if err != nil {
		log.Printf("[CACHE] Error getting all products from cache: %v", err)
	}

	if hit {
		log.Println("[CACHE] All products served from Redis")
		httpjson.JSON(w, http.StatusOK, products)
		return
	}

	// Cache miss: fetch from database
	log.Println("[CACHE] Cache miss, fetching all products from DB")
	if err := h.DB.Preload("Sizes").
		Preload("Attributes").
		Preload("Category").
		Preload("Subcategory").
		Preload("Brand").
		Find(&products).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch products")
		return
	}

	// Store in cache
	if err := productCache.SetAllProducts(ctx, products); err != nil {
		log.Printf("[CACHE] Failed to cache all products: %v", err)
	}

	httpjson.JSON(w, http.StatusOK, products)
}

// GetProduct returns a single product with all relationships (final product) with Redis caching.
func (h *Handler) GetProduct(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	ctx := context.Background()
	productCache := cache.NewProductCache(h.Redis)

	var product models.Product
	hit, err := productCache.GetProductDetail(ctx, slug, &product)
	if err != nil {
		log.Printf("[CACHE] Error getting product detail from cache: %v", err)
	}

	if hit {
		log.Printf("[CACHE] Product detail for '%s' served from Redis", slug)
		httpjson.JSON(w, http.StatusOK, product)
		return
	}

	// Cache miss: fetch from database
	log.Printf("[CACHE] Cache miss, fetching product detail for '%s' from DB", slug)
	err = h.DB.Preload("Sizes").
		Preload("Attributes").
		Preload("Category").
		Preload("Subcategory").
		Preload("Brand").
		Preload("Reviews.User").
		Where("slug = ?", slug).
		First(&product).Error

	if err != nil {
		if err == gorm.ErrRecordNotFound {
			httpjson.Error(w, http.StatusNotFound, "product not found")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch product")
		return
	}

	// Store in cache
	if err := productCache.SetProductDetail(ctx, slug, product); err != nil {
		log.Printf("[CACHE] Failed to cache product detail: %v", err)
	}

	httpjson.JSON(w, http.StatusOK, product)
}

// CreateProduct creates a new product and invalidates relevant caches.
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

	// Invalidate product caches after creation
	ctx := context.Background()
	productCache := cache.NewProductCache(h.Redis)
	if err := productCache.InvalidateAllProductCaches(ctx); err != nil {
		log.Printf("[CACHE] Failed to invalidate caches after product creation: %v", err)
	}

	httpjson.JSON(w, http.StatusCreated, input)
}

// UpdateProduct updates a product and invalidates relevant caches.
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

	// Invalidate product caches after update
	ctx := context.Background()
	productCache := cache.NewProductCache(h.Redis)
	if err := productCache.InvalidateProductDetail(ctx, slug); err != nil {
		log.Printf("[CACHE] Failed to invalidate caches after product update: %v", err)
	}

	httpjson.JSON(w, http.StatusOK, input)
}

// DeleteProduct deletes a product and invalidates relevant caches.
func (h *Handler) DeleteProduct(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if err := h.DB.Where("slug = ?", slug).Delete(&models.Product{}).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to delete product")
		return
	}

	// Invalidate product caches after deletion
	ctx := context.Background()
	productCache := cache.NewProductCache(h.Redis)
	if err := productCache.InvalidateProductDetail(ctx, slug); err != nil {
		log.Printf("[CACHE] Failed to invalidate caches after product deletion: %v", err)
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

// RelatedProducts returns related products for a given product with Redis caching.
func (h *Handler) RelatedProducts(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	ctx := context.Background()
	productCache := cache.NewProductCache(h.Redis)

	// Try to get from cache
	var related []models.Product
	hit, err := productCache.GetRelatedProducts(ctx, slug, &related)
	if err != nil {
		log.Printf("[CACHE] Error getting related products from cache: %v", err)
	}

	if hit {
		log.Printf("[CACHE] Related products for '%s' served from Redis", slug)
		httpjson.JSON(w, http.StatusOK, related)
		return
	}

	// Verify product exists
	var product models.Product
	if err := h.DB.Where("slug = ?", slug).First(&product).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			httpjson.Error(w, http.StatusNotFound, "product not found")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch product")
		return
	}

	// Cache miss: fetch related products from database
	log.Printf("[CACHE] Cache miss, fetching related products for '%s' from DB", slug)
	err = h.DB.Preload("Sizes").
		Preload("Category").
		Preload("Subcategory").
		Preload("Brand").
		Where("category_id = ? AND slug <> ?", product.CategoryID, slug).
		Limit(4).
		Find(&related).Error

	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch related products")
		return
	}

	// Store in cache
	if err := productCache.SetRelatedProducts(ctx, slug, related); err != nil {
		log.Printf("[CACHE] Failed to cache related products: %v", err)
	}

	httpjson.JSON(w, http.StatusOK, related)
}

// FeaturedProducts returns products marked as featured with Redis caching.
func (h *Handler) FeaturedProducts(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()
	productCache := cache.NewProductCache(h.Redis)

	var products []models.Product
	hit, err := productCache.GetFeaturedProducts(ctx, &products)
	if err != nil {
		log.Printf("[CACHE] Error getting featured products from cache: %v", err)
	}

	if hit {
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

	// Store in cache
	if err := productCache.SetFeaturedProducts(ctx, products); err != nil {
		log.Printf("[CACHE] Failed to cache featured products: %v", err)
	}

	httpjson.JSON(w, http.StatusOK, products)
}

// AllProducts returns all products with Redis caching.
// Note: This is an alias for ListProducts to maintain backward compatibility.
func (h *Handler) AllProducts(w http.ResponseWriter, r *http.Request) {
	h.ListProducts(w, r)
}

// SearchProducts searches products by query string with Redis caching.
func (h *Handler) SearchProducts(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		httpjson.JSON(w, http.StatusOK, []models.Product{})
		return
	}

	ctx := context.Background()
	cacheHelper := cache.NewHelper(h.Redis)
	
	// Create cache key from query
	cacheKey := "products:search:" + query
	var products []models.Product
	
	// Try to get from cache
	hit, err := cacheHelper.Get(ctx, cacheKey, &products)
	if err != nil {
		log.Printf("[CACHE] Error getting search results from cache: %v", err)
	}

	if hit {
		log.Printf("[CACHE] Search results for '%s' served from Redis", query)
		httpjson.JSON(w, http.StatusOK, products)
		return
	}

	// Cache miss: search in database
	log.Printf("[CACHE] Cache miss, searching products for '%s' in DB", query)
	searchTerm := "%" + query + "%"
	
	err = h.DB.Preload("Sizes").
		Preload("Attributes").
		Preload("Category").
		Preload("Subcategory").
		Preload("Brand").
		Where("name ILIKE ? OR description ILIKE ? OR short_desc ILIKE ? OR full_desc ILIKE ?", 
			searchTerm, searchTerm, searchTerm, searchTerm).
		Or("EXISTS (SELECT 1 FROM unnest(tags) AS tag WHERE tag ILIKE ?)", searchTerm).
		Or("EXISTS (SELECT 1 FROM categories WHERE categories.id = products.category_id AND categories.name ILIKE ?)", searchTerm).
		Or("EXISTS (SELECT 1 FROM brands WHERE brands.id = products.brand_id AND brands.name ILIKE ?)", searchTerm).
		Limit(20).
		Find(&products).Error

	if err != nil {
		log.Printf("[DB] Error searching products: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to search products")
		return
	}

	// Store in cache with shorter TTL for search results
	if err := cacheHelper.Set(ctx, cacheKey, products, 5*time.Minute); err != nil {
		log.Printf("[CACHE] Failed to cache search results: %v", err)
	}

	httpjson.JSON(w, http.StatusOK, products)
}

// InvalidateProductCache clears all product-related cache entries.
func (h *Handler) InvalidateProductCache() error {
	ctx := context.Background()
	productCache := cache.NewProductCache(h.Redis)
	return productCache.InvalidateAllProductCaches(ctx)
}