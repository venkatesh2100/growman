package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
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
	statusFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("status")))
	orderIDFilter := strings.TrimSpace(r.URL.Query().Get("orderId"))
	searchFilter := strings.TrimSpace(r.URL.Query().Get("search"))
	scopeFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("scope")))

	isAdmin := claims.Role == "admin" || claims.Role == "superadmin"
	if scopeFilter == "self" {
		isAdmin = false
	}
	cacheScope := "user:" + strconv.FormatUint(uint64(claims.UserID), 10)
	if isAdmin {
		cacheScope = "admin:all"
	}
	cacheKey := "orders:" + cacheScope +
		":page:" + strconv.Itoa(paginationParams.Page) +
		":size:" + strconv.Itoa(paginationParams.PageSize) +
		":status:" + statusFilter +
		":orderId:" + orderIDFilter +
		":search:" + strings.ToLower(searchFilter)
	cacheHelper := cache.NewHelper(h.Redis)

	var orders []models.Order
	var total int64

	// Try to get from cache (shorter TTL for user-specific data)
	hit, err := cacheHelper.Get(ctx, cacheKey, &orders)
	if err != nil {
		log.Printf("[CACHE] Error getting orders from cache: %v", err)
	}

	// Get total count
	totalCacheKey := "orders:" + cacheScope +
		":total:status:" + statusFilter +
		":orderId:" + orderIDFilter +
		":search:" + strings.ToLower(searchFilter)
	var cachedTotal int64
	totalHit, _ := cacheHelper.Get(ctx, totalCacheKey, &cachedTotal)

	if hit && totalHit {
		log.Printf("[CACHE] Orders page %d for %s served from Redis", paginationParams.Page, cacheScope)
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
	log.Printf("[CACHE] Cache miss, fetching orders page %d for %s from DB", paginationParams.Page, cacheScope)

	// Get total count
	countQuery := h.DB.Model(&models.Order{})
	if !isAdmin {
		countQuery = countQuery.Where("user_id = ?", claims.UserID)
	}
	if statusFilter != "" && statusFilter != "all" {
		countQuery = countQuery.Where(
			"LOWER(status) = ? OR LOWER(payment_status) = ?",
			statusFilter,
			statusFilter,
		)
	}
	if orderIDFilter != "" {
		if orderID, err := strconv.ParseUint(orderIDFilter, 10, 64); err == nil {
			countQuery = countQuery.Where("id = ?", orderID)
		}
	}
	if searchFilter != "" {
		like := "%" + strings.ToLower(searchFilter) + "%"
		countQuery = countQuery.Where(
			"LOWER(customer_name) LIKE ? OR LOWER(customer_phone) LIKE ? OR LOWER(customer_email) LIKE ?",
			like, like, like,
		)
	}
	if err := countQuery.Count(&total).Error; err != nil {
		log.Printf("[DB] Error counting orders: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch orders")
		return
	}

	// Fetch paginated orders with optimized query (only preload what's needed)
	dataQuery := h.DB.Preload("Items").Preload("User").Order("created_at DESC")
	if !isAdmin {
		dataQuery = dataQuery.Where("user_id = ?", claims.UserID)
	}
	if statusFilter != "" && statusFilter != "all" {
		dataQuery = dataQuery.Where(
			"LOWER(status) = ? OR LOWER(payment_status) = ?",
			statusFilter,
			statusFilter,
		)
	}
	if orderIDFilter != "" {
		if orderID, err := strconv.ParseUint(orderIDFilter, 10, 64); err == nil {
			dataQuery = dataQuery.Where("id = ?", orderID)
		}
	}
	if searchFilter != "" {
		like := "%" + strings.ToLower(searchFilter) + "%"
		dataQuery = dataQuery.Where(
			"LOWER(customer_name) LIKE ? OR LOWER(customer_phone) LIKE ? OR LOWER(customer_email) LIKE ?",
			like, like, like,
		)
	}
	if err := dataQuery.Offset(paginationParams.Offset).
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

type UpdateOrderStatusRequest struct {
	Status string `json:"status"`
}

type UpdateOrderExpectedDeliveryDateRequest struct {
	ExpectedDeliveryDate string `json:"expectedDeliveryDate"`
}

// UpdateOrderStatus allows admin/superadmin to update order status.
func (h *Handler) UpdateOrderStatus(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.FromContext(r.Context())
	if !ok {
		httpjson.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if claims.Role != "admin" && claims.Role != "superadmin" {
		httpjson.Error(w, http.StatusForbidden, "admin access required")
		return
	}

	idStr := chi.URLParam(r, "id")
	orderID, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid order id")
		return
	}

	var req UpdateOrderStatusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	status := strings.ToLower(strings.TrimSpace(req.Status))
	allowed := map[string]bool{
		"pending":          true,
		"confirmed":        true,
		"shipped":          true,
		"out_for_delivery": true,
		"delivered":        true,
		"cancelled":        true,
		"failed":           true,
		"paid":             true,
	}
	if !allowed[status] {
		httpjson.Error(w, http.StatusBadRequest, "unsupported order status")
		return
	}

	var order models.Order
	if err := h.DB.Where("id = ?", orderID).First(&order).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "order not found")
		return
	}

	updates := map[string]interface{}{"status": status}
	if status == "delivered" || status == "paid" {
		updates["payment_status"] = "paid"
	}
	if status == "failed" || status == "cancelled" {
		updates["payment_status"] = status
	}

	if err := h.DB.Model(&order).Updates(updates).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to update order status")
		return
	}

	cacheHelper := cache.NewHelper(h.Redis)
	ctx := context.Background()
	_ = cacheHelper.DeletePattern(ctx, "orders:*")

	if err := h.DB.Preload("Items").Preload("User").Where("id = ?", orderID).First(&order).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch updated order")
		return
	}
	h.ResolveOrderItemImageURLsSlice(order.Items)
	httpjson.JSON(w, http.StatusOK, order)
}

// UpdateOrderExpectedDeliveryDate allows admin/superadmin to set expected delivery date.
func (h *Handler) UpdateOrderExpectedDeliveryDate(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.FromContext(r.Context())
	if !ok {
		httpjson.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if claims.Role != "admin" && claims.Role != "superadmin" {
		httpjson.Error(w, http.StatusForbidden, "admin access required")
		return
	}

	idStr := chi.URLParam(r, "id")
	orderID, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid order id")
		return
	}

	var req UpdateOrderExpectedDeliveryDateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	var order models.Order
	if err := h.DB.Where("id = ?", orderID).First(&order).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "order not found")
		return
	}

	updates := map[string]interface{}{}
	dateString := strings.TrimSpace(req.ExpectedDeliveryDate)
	if dateString == "" {
		updates["expected_delivery_date"] = nil
	} else {
		parsed, err := time.Parse("2006-01-02", dateString)
		if err != nil {
			httpjson.Error(w, http.StatusBadRequest, "expectedDeliveryDate must be YYYY-MM-DD")
			return
		}
		updates["expected_delivery_date"] = parsed
	}

	if err := h.DB.Model(&order).Updates(updates).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to update expected delivery date")
		return
	}

	cacheHelper := cache.NewHelper(h.Redis)
	ctx := context.Background()
	_ = cacheHelper.DeletePattern(ctx, "orders:*")

	if err := h.DB.Preload("Items").Preload("User").Where("id = ?", orderID).First(&order).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch updated order")
		return
	}
	h.ResolveOrderItemImageURLsSlice(order.Items)
	httpjson.JSON(w, http.StatusOK, order)
}
