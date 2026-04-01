package handlers

import (
	"context"
	"log"
	"net/http"
	"strconv"
	"time"

	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/cache"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	paginationpkg "github.com/venkatesh2100/growman/apps/go-backend/pkg/pagination"
)

// ListOrders returns paginated orders for the authenticated user
func (h *Handler) ListOrders(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.FromContext(r.Context())
	if !ok {
		httpjson.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	ctx := context.Background()

	// Parse pagination parameters
	paginationParams := paginationpkg.ParsePagination(r)

	// Cache key includes user ID for user-specific caching
	cacheKey := "orders:user:" + strconv.FormatUint(uint64(claims.UserID), 10) + ":page:" + strconv.Itoa(paginationParams.Page) + ":size:" + strconv.Itoa(paginationParams.PageSize)
	cacheHelper := cache.NewHelper(h.Redis)

	var orders []models.Order
	var total int64

	// Try to get from cache (shorter TTL for user-specific data)
	hit, err := cacheHelper.Get(ctx, cacheKey, &orders)
	if err != nil {
		log.Printf("[CACHE] Error getting orders from cache: %v", err)
	}

	// Get total count
	totalCacheKey := "orders:user:" + strconv.FormatUint(uint64(claims.UserID), 10) + ":total"
	var cachedTotal int64
	totalHit, _ := cacheHelper.Get(ctx, totalCacheKey, &cachedTotal)

	if hit && totalHit {
		log.Printf("[CACHE] Orders page %d for user %d served from Redis", paginationParams.Page, claims.UserID)
		// Resolve image URLs for order items
		for i := range orders {
			h.ResolveOrderItemImageURLsSlice(orders[i].Items)
		}
		meta := paginationpkg.BuildPaginationMeta(paginationParams.Page, paginationParams.PageSize, cachedTotal)
		httpjson.JSON(w, http.StatusOK, paginationpkg.PaginatedResponse{
			Data:       orders,
			Pagination: meta,
		})
		return
	}

	// Cache miss: fetch from database with pagination
	log.Printf("[CACHE] Cache miss, fetching orders page %d for user %d from DB", paginationParams.Page, claims.UserID)

	// Get total count
	if err := h.DB.Model(&models.Order{}).Where("user_id = ?", claims.UserID).Count(&total).Error; err != nil {
		log.Printf("[DB] Error counting orders: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch orders")
		return
	}

	// Fetch paginated orders with optimized query (only preload what's needed)
	if err := h.DB.Preload("Items").
		Where("user_id = ?", claims.UserID).
		Order("created_at DESC").
		Offset(paginationParams.Offset).
		Limit(paginationParams.PageSize).
		Find(&orders).Error; err != nil {
		log.Printf("[DB] Error fetching orders: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch orders")
		return
	}

	// Store in cache with shorter TTL for user-specific data
	if err := cacheHelper.Set(ctx, cacheKey, orders, 5*time.Minute); err != nil {
		log.Printf("[CACHE] Failed to cache orders: %v", err)
	}

	// Cache total count
	if err := cacheHelper.Set(ctx, totalCacheKey, total, 10*time.Minute); err != nil {
		log.Printf("[CACHE] Failed to cache orders total: %v", err)
	}

	// Resolve image URLs for order items
	for i := range orders {
		h.ResolveOrderItemImageURLsSlice(orders[i].Items)
	}

	meta := paginationpkg.BuildPaginationMeta(paginationParams.Page, paginationParams.PageSize, total)
	httpjson.JSON(w, http.StatusOK, paginationpkg.PaginatedResponse{
		Data:       orders,
		Pagination: meta,
	})
}
