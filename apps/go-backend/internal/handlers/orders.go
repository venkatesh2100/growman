package handlers

import (
	"context"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	paginationpkg "github.com/venkatesh2100/growman/apps/go-backend/pkg/pagination"
	"gorm.io/gorm"
)

// applyOrderFilters applies the status/orderId/search query filters shared
// by ListOrders' count and data queries, so the two can never drift apart.
func applyOrderFilters(q *gorm.DB, statusFilter, orderIDFilter, searchFilter string) *gorm.DB {
	switch {
	case statusFilter == "" || statusFilter == "all":
		// No status constraint.
	case statusFilter == "settled":
		// Every order money was actually taken for, whatever became of it
		// afterwards. A single `status = 'paid'` filter looks equivalent but
		// is not: once a refund completes, payment_status becomes
		// `refunded` and the order would drop out of the customer's history
		// entirely — they would see a cancelled order vanish rather than be
		// shown as refunded. Carts that never paid are excluded instead,
		// which is the actual intent.
		q = q.Where("LOWER(payment_status) NOT IN ?", []string{"created", "failed"}).
			Where("LOWER(status) <> ?", "abandoned")
	default:
		// A comma-separated list so a caller can ask for several states
		// without issuing a request per state.
		wanted := make([]string, 0, 4)
		for _, part := range strings.Split(statusFilter, ",") {
			if part = strings.TrimSpace(part); part != "" {
				wanted = append(wanted, part)
			}
		}
		if len(wanted) > 0 {
			q = q.Where("LOWER(status) IN ? OR LOWER(payment_status) IN ?", wanted, wanted)
		}
	}
	if orderIDFilter != "" {
		if orderID, err := strconv.ParseUint(orderIDFilter, 10, 64); err == nil {
			q = q.Where("id = ?", orderID)
		}
	}
	if searchFilter != "" {
		like := "%" + strings.ToLower(searchFilter) + "%"
		q = q.Where("LOWER(customer_name) LIKE ? OR LOWER(customer_phone) LIKE ? OR LOWER(customer_email) LIKE ?", like, like, like)
	}
	return q
}

// ListOrders returns paginated orders: a regular user sees only their own,
// admins see everyone's (unless scope=self is passed). Both the page and
// its total count are cached separately with a short TTL — see 04-caching.md.
func (h *Handler) ListOrders(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	ctx := r.Context()

	paginationParams := paginationpkg.ParsePagination(r)
	statusFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("status")))
	orderIDFilter := strings.TrimSpace(r.URL.Query().Get("orderId"))
	searchFilter := strings.TrimSpace(r.URL.Query().Get("search"))
	scopeFilter := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("scope")))

	isAdmin := appauth.IsAdminRole(claims.Role) && scopeFilter != "self"
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
	totalCacheKey := "orders:" + cacheScope +
		":total:status:" + statusFilter +
		":orderId:" + orderIDFilter +
		":search:" + strings.ToLower(searchFilter)

	var orders []models.Order
	var total int64
	hit, _ := h.Cache.Get(ctx, cacheKey, &orders)
	totalHit, _ := h.Cache.Get(ctx, totalCacheKey, &total)
	if hit && totalHit {
		meta := paginationpkg.BuildPaginationMeta(paginationParams.Page, paginationParams.PageSize, total)
		httpjson.JSON(w, http.StatusOK, paginationpkg.PaginatedResponse{Data: orders, Pagination: meta})
		return
	}

	countQuery := h.DB.Model(&models.Order{})
	dataQuery := h.DB.Preload("Items").Preload("User").Order("created_at DESC")
	if !isAdmin {
		countQuery = countQuery.Where("user_id = ?", claims.UserID)
		dataQuery = dataQuery.Where("user_id = ?", claims.UserID)
	}
	countQuery = applyOrderFilters(countQuery, statusFilter, orderIDFilter, searchFilter)
	dataQuery = applyOrderFilters(dataQuery, statusFilter, orderIDFilter, searchFilter)

	if err := countQuery.Count(&total).Error; err != nil {
		log.Printf("[DB] count orders: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch orders")
		return
	}
	if err := dataQuery.Offset(paginationParams.Offset).Limit(paginationParams.PageSize).Find(&orders).Error; err != nil {
		log.Printf("[DB] fetch orders: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch orders")
		return
	}

	// Resolve image URLs before caching so hits skip the extra work.
	for i := range orders {
		h.ResolveOrderItemImageURLsSlice(orders[i].Items)
	}
	_ = h.Cache.Set(ctx, cacheKey, orders, 2*time.Minute)
	_ = h.Cache.Set(ctx, totalCacheKey, total, 5*time.Minute)

	meta := paginationpkg.BuildPaginationMeta(paginationParams.Page, paginationParams.PageSize, total)
	httpjson.JSON(w, http.StatusOK, paginationpkg.PaginatedResponse{Data: orders, Pagination: meta})
}

type UpdateOrderStatusRequest struct {
	Status string `json:"status"`
}

type UpdateOrderExpectedDeliveryDateRequest struct {
	ExpectedDeliveryDate string `json:"expectedDeliveryDate"`
}

var allowedOrderStatuses = map[string]bool{
	"pending": true, "confirmed": true, "shipped": true, "out_for_delivery": true,
	"delivered": true, "cancelled": true, "failed": true, "paid": true,
}

// UpdateOrderStatus allows admin/superadmin to update order status, keeping
// payment_status in sync for the transitions where that's implied.
func (h *Handler) UpdateOrderStatus(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	if !appauth.IsAdminRole(claims.Role) {
		httpjson.Error(w, http.StatusForbidden, "admin access required")
		return
	}

	orderID, err := strconv.ParseUint(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid order id")
		return
	}
	var req UpdateOrderStatusRequest
	if !httpjson.Decode(w, r, &req) {
		return
	}
	status := strings.ToLower(strings.TrimSpace(req.Status))
	if !allowedOrderStatuses[status] {
		httpjson.Error(w, http.StatusBadRequest, "unsupported order status")
		return
	}

	var order models.Order
	if err := h.DB.Where("id = ?", orderID).First(&order).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "order not found")
		return
	}

	updates := map[string]any{"status": status}
	switch status {
	case "delivered", "paid":
		updates["payment_status"] = "paid"
	case "failed", "cancelled":
		updates["payment_status"] = status
	}
	if err := h.DB.Model(&order).Updates(updates).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to update order status")
		return
	}

	order, ok = h.reloadOrderForResponse(w, r.Context(), orderID)
	if !ok {
		return
	}
	h.notifyStatus(r.Context(), order)
	httpjson.JSON(w, http.StatusOK, order)
}

func (h *Handler) notifyStatus(ctx context.Context, order models.Order) {
	switch order.Status {
	case "confirmed", "processing":
		if order.FulfillmentChannel == "store_pickup" {
			h.notifyOrderEvent(ctx, order, "Ready for store pickup", "Your order can be collected from the nursery.", "pickup")
			return
		}
		h.notifyOrderEvent(ctx, order, "Order packed", "Your plants are packed and waiting to leave.", "packed")
	case "shipped":
		h.notifyOrderEvent(ctx, order, "Order shipped", "Your order is on the way.", "shipped")
	case "out_for_delivery":
		h.notifyOrderEvent(ctx, order, "Out for delivery", "Your order is out for delivery today.", "ofd")
	case "delivered":
		h.notifyOrderEvent(ctx, order, "Order delivered", "Your plants have arrived. Tell us how the delivery went.", "delivered")
	case "failed":
		h.notifyOrderEvent(ctx, order, "Payment failed", "The payment did not go through. You can try again from Orders.", "failed")
	case "cancelled":
		h.notifyOrderEvent(ctx, order, "Order cancelled", "This order has been cancelled.", "cancelled")
	}
}

// UpdateOrderExpectedDeliveryDate allows admin/superadmin to set (or clear,
// with an empty string) the order's expected delivery date.
func (h *Handler) UpdateOrderExpectedDeliveryDate(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	if !appauth.IsAdminRole(claims.Role) {
		httpjson.Error(w, http.StatusForbidden, "admin access required")
		return
	}

	orderID, err := strconv.ParseUint(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid order id")
		return
	}
	var req UpdateOrderExpectedDeliveryDateRequest
	if !httpjson.Decode(w, r, &req) {
		return
	}

	var order models.Order
	if err := h.DB.Where("id = ?", orderID).First(&order).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "order not found")
		return
	}

	var expectedDelivery any
	if dateString := strings.TrimSpace(req.ExpectedDeliveryDate); dateString != "" {
		parsed, err := time.Parse("2006-01-02", dateString)
		if err != nil {
			httpjson.Error(w, http.StatusBadRequest, "expectedDeliveryDate must be YYYY-MM-DD")
			return
		}
		expectedDelivery = parsed
	}
	if err := h.DB.Model(&order).Updates(map[string]any{"expected_delivery_date": expectedDelivery}).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to update expected delivery date")
		return
	}

	order, ok = h.reloadOrderForResponse(w, r.Context(), orderID)
	if !ok {
		return
	}
	if order.ExpectedDeliveryDate != nil {
		h.notifyOrderEvent(r.Context(), order, "Delivery date updated",
			"The new expected date is "+order.ExpectedDeliveryDate.Format("2 Jan 2006")+".", "date:"+order.ExpectedDeliveryDate.Format("2006-01-02"))
	}
	httpjson.JSON(w, http.StatusOK, order)
}

// reloadOrderForResponse invalidates the order-list cache and re-fetches an
// order with the associations both admin mutation endpoints above return.
// Writes the HTTP error itself and returns ok=false on failure.
func (h *Handler) reloadOrderForResponse(w http.ResponseWriter, ctx context.Context, orderID uint64) (models.Order, bool) {
	_ = h.Cache.DeletePattern(ctx, "orders:*")

	var order models.Order
	if err := h.DB.Preload("Items").Preload("User").Where("id = ?", orderID).First(&order).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch updated order")
		return models.Order{}, false
	}
	h.ResolveOrderItemImageURLsSlice(order.Items)
	return order, true
}
