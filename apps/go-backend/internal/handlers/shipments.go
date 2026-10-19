package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/fulfillment"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/shiprocket"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"gorm.io/gorm"
)

// Shipment automation
//
// A paid courier order becomes a real shipment in three provider calls:
// create the order, assign an AWB, request a pickup. CreateShipment does
// the first two, because an order without an AWB is not trackable and is
// therefore not useful; pickup is separate so ops can batch it.
//
// Tracking advances through the Shiprocket webhook rather than polling.
// Polling an aggregator on behalf of every open order is both slow and
// rate-limited; the webhook is near-real-time and free.

// CreateShipment books a courier shipment for a paid order and records the
// AWB. Admin-only, and idempotent: an order that already has an AWB is
// returned as-is rather than double-booked.
func (h *Handler) CreateShipment(w http.ResponseWriter, r *http.Request) {
	orderID, err := strconv.ParseUint(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid order ID")
		return
	}

	var order models.Order
	if err := h.DB.WithContext(r.Context()).Preload("Items").First(&order, orderID).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "order not found")
		return
	}

	if order.AWBNumber != "" {
		httpjson.JSON(w, http.StatusOK, map[string]any{
			"success":     true,
			"alreadyDone": true,
			"awbNumber":   order.AWBNumber,
			"trackingUrl": order.TrackingURL,
		})
		return
	}

	awb, err := h.bookShipment(r.Context(), &order)
	if err != nil {
		if errors.Is(err, shiprocket.ErrNotConfigured) {
			httpjson.Error(w, http.StatusServiceUnavailable, "courier integration is not configured")
			return
		}
		log.Printf("[SHIPMENT] book for order %d: %v", order.ID, err)
		httpjson.Error(w, http.StatusBadGateway, "failed to book shipment: "+err.Error())
		return
	}

	httpjson.JSON(w, http.StatusOK, map[string]any{
		"success":     true,
		"awbNumber":   awb.AWBCode,
		"courier":     awb.CourierName,
		"trackingUrl": awb.TrackingURL,
	})
}

// bookShipment creates the provider order, assigns an AWB, persists both,
// and emails the customer their tracking details.
func (h *Handler) bookShipment(ctx context.Context, order *models.Order) (*shiprocket.AWB, error) {
	if h.Shiprocket == nil {
		return nil, shiprocket.ErrNotConfigured
	}
	if order.PaymentStatus != "paid" {
		return nil, fmt.Errorf("order is not paid")
	}
	if order.CancelledAt != nil {
		return nil, fmt.Errorf("order is cancelled")
	}
	if order.FulfillmentChannel != string(fulfillment.ChannelCourier) {
		return nil, fmt.Errorf("order channel %q is not shipped by courier", order.FulfillmentChannel)
	}

	lines := make([]shiprocket.OrderLine, 0, len(order.Items))
	var weight float64
	for _, item := range order.Items {
		lines = append(lines, shiprocket.OrderLine{
			Name:     item.Name,
			SKU:      fmt.Sprintf("GRW-%d-%d", item.ProductID, derefUint(item.ProductSize)),
			Quantity: item.Quantity,
			Price:    item.Price,
		})
		weight += estimateLineWeight(item)
	}

	pickupName := strings.TrimSpace(h.Cfg.ShiprocketPickupLocation)
	if pickupName == "" {
		pickupName = "Primary"
	}

	created, err := h.Shiprocket.CreateOrder(ctx, shiprocket.OrderRequest{
		OrderID:      fmt.Sprintf("GRW-%d", order.ID),
		OrderDate:    order.CreatedAt,
		PickupName:   pickupName,
		CustomerName: order.CustomerName,
		Phone:        order.CustomerPhone,
		Email:        order.CustomerEmail,
		AddressLine:  order.AddressLine,
		City:         order.City,
		State:        order.State,
		Pincode:      order.Pincode,
		Items:        lines,
		SubTotal:     order.Subtotal,
		WeightKg:     weight,
	})
	if err != nil {
		return nil, fmt.Errorf("create provider order: %w", err)
	}

	// Persist the shipment ID before assigning an AWB: if AWB assignment
	// fails, ops can retry it without creating a second provider order.
	if err := h.DB.WithContext(ctx).Model(&models.Order{}).Where("id = ?", order.ID).
		UpdateColumn("shipment_id", strconv.FormatInt(created.ShipmentID, 10)).Error; err != nil {
		log.Printf("[SHIPMENT] persist shipment id: %v", err)
	}
	order.ShipmentID = strconv.FormatInt(created.ShipmentID, 10)

	awb, err := h.Shiprocket.GenerateAWB(ctx, created.ShipmentID, 0)
	if err != nil {
		return nil, fmt.Errorf("assign AWB: %w", err)
	}

	now := time.Now()
	if err := h.DB.WithContext(ctx).Model(&models.Order{}).Where("id = ?", order.ID).
		Updates(map[string]any{
			"awb_number":      awb.AWBCode,
			"courier_service": awb.CourierName,
			"tracking_url":    awb.TrackingURL,
			"status":          "shipped",
			"shipped_at":      &now,
		}).Error; err != nil {
		return nil, fmt.Errorf("persist AWB: %w", err)
	}

	order.AWBNumber = awb.AWBCode
	order.CourierService = awb.CourierName
	order.TrackingURL = awb.TrackingURL
	order.ShippedAt = &now
	order.Status = "shipped"

	go h.sendOrderShippedEmail(*order)
	h.invalidateOrderCaches(ctx)
	return awb, nil
}

// SchedulePickup asks the courier to collect an already-booked shipment.
func (h *Handler) SchedulePickup(w http.ResponseWriter, r *http.Request) {
	orderID, err := strconv.ParseUint(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid order ID")
		return
	}

	var order models.Order
	if err := h.DB.WithContext(r.Context()).First(&order, orderID).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "order not found")
		return
	}
	if order.ShipmentID == "" {
		httpjson.Error(w, http.StatusConflict, "book a shipment for this order first")
		return
	}
	if h.Shiprocket == nil {
		httpjson.Error(w, http.StatusServiceUnavailable, "courier integration is not configured")
		return
	}

	shipmentID, err := shiprocket.ParseShipmentID(order.ShipmentID)
	if err != nil {
		httpjson.Error(w, http.StatusConflict, "stored shipment ID is not valid")
		return
	}
	if err := h.Shiprocket.RequestPickup(r.Context(), shipmentID); err != nil {
		log.Printf("[SHIPMENT] pickup for order %d: %v", order.ID, err)
		httpjson.Error(w, http.StatusBadGateway, "failed to schedule pickup: "+err.Error())
		return
	}

	now := time.Now()
	if err := h.DB.WithContext(r.Context()).Model(&models.Order{}).Where("id = ?", order.ID).
		UpdateColumn("pickup_booked_at", &now).Error; err != nil {
		log.Printf("[SHIPMENT] persist pickup time: %v", err)
	}

	httpjson.JSON(w, http.StatusOK, map[string]any{"success": true, "pickupBookedAt": now})
}

// ShiprocketWebhook receives shipment status updates and advances the
// order's state, so a customer's order page reflects reality without
// anyone polling the aggregator.
//
// Shiprocket authenticates with a shared token in the x-api-key header
// rather than an HMAC signature, so the comparison is a plain constant
// against the configured value.
func (h *Handler) ShiprocketWebhook(w http.ResponseWriter, r *http.Request) {
	expected := strings.TrimSpace(h.Cfg.ShiprocketWebhookToken)
	if expected == "" {
		// Not configured: refuse rather than accept unauthenticated
		// order-state mutations.
		httpjson.Error(w, http.StatusServiceUnavailable, "shipment webhooks are not configured")
		return
	}
	provided := strings.TrimSpace(r.Header.Get("x-api-key"))
	if provided == "" || provided != expected {
		log.Printf("[WEBHOOK] shiprocket: bad or missing x-api-key")
		httpjson.Error(w, http.StatusUnauthorized, "invalid token")
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "failed to read request body")
		return
	}

	var payload struct {
		AWB           string `json:"awb"`
		CurrentStatus string `json:"current_status"`
		OrderID       string `json:"order_id"`
		CourierName   string `json:"courier_name"`
		ScanTime      string `json:"scan_date_time"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid payload")
		return
	}
	if payload.AWB == "" {
		httpjson.Error(w, http.StatusBadRequest, "awb is required")
		return
	}

	// Dedupe on AWB plus status: Shiprocket resends scans, and each
	// (awb, status) pair should only move the order once.
	eventID := fmt.Sprintf("shiprocket:%s:%s", payload.AWB, payload.CurrentStatus)
	claimed, err := h.claimWebhookEvent("shiprocket", eventID, payload.CurrentStatus, string(body))
	if err != nil {
		log.Printf("[WEBHOOK] shiprocket claim: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to record event")
		return
	}
	if !claimed {
		httpjson.JSON(w, http.StatusOK, map[string]any{"success": true, "duplicate": true})
		return
	}

	httpjson.JSON(w, http.StatusOK, map[string]any{"success": true})

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), webhookProcessTimeout)
		defer cancel()
		if err := h.applyShipmentStatus(ctx, payload.AWB, payload.CurrentStatus, payload.CourierName); err != nil {
			log.Printf("[WEBHOOK] shiprocket apply status: %v", err)
			h.finishWebhookEvent(eventID, "failed", err)
			return
		}
		h.finishWebhookEvent(eventID, "processed", nil)
	}()
}

// applyShipmentStatus maps a courier status onto our order state.
func (h *Handler) applyShipmentStatus(ctx context.Context, awb, status, courier string) error {
	var order models.Order
	if err := h.DB.WithContext(ctx).Where("awb_number = ?", awb).First(&order).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			// Not ours, or booked outside the app. Nothing to do, and
			// nothing worth retrying for.
			log.Printf("[SHIPMENT] no order for AWB %s", awb)
			return nil
		}
		return err
	}

	updates := map[string]any{}
	if courier != "" && order.CourierService == "" {
		updates["courier_service"] = courier
	}

	now := time.Now()
	switch {
	case shiprocket.IsDelivered(status):
		if order.DeliveredAt == nil {
			updates["delivered_at"] = &now
		}
		updates["status"] = "delivered"
	case shiprocket.IsShipped(status):
		if order.ShippedAt == nil {
			updates["shipped_at"] = &now
		}
		updates["status"] = "shipped"
	default:
		// Intermediate scans (pending, pickup scheduled, RTO initiated)
		// are recorded on the event ledger but do not move order state.
		return nil
	}

	if err := h.DB.WithContext(ctx).Model(&models.Order{}).
		Where("id = ?", order.ID).Updates(updates).Error; err != nil {
		return err
	}
	h.invalidateOrderCaches(ctx)
	return nil
}

// RefreshShipmentTracking polls open shipments as a backstop for missed
// webhooks. Intended for a slow ticker, not a tight loop.
func (h *Handler) RefreshShipmentTracking(ctx context.Context) (updated int, err error) {
	if h.Shiprocket == nil {
		return 0, nil
	}

	var orders []models.Order
	if err := h.DB.WithContext(ctx).
		Where("awb_number <> '' AND delivered_at IS NULL AND cancelled_at IS NULL").
		Order("shipped_at ASC NULLS FIRST").
		Limit(50).
		Find(&orders).Error; err != nil {
		return 0, err
	}

	for _, order := range orders {
		status, err := h.Shiprocket.Track(ctx, order.AWBNumber)
		if err != nil {
			log.Printf("[SHIPMENT] track %s: %v", order.AWBNumber, err)
			continue
		}
		if err := h.applyShipmentStatus(ctx, order.AWBNumber, status.Status, status.CourierName); err != nil {
			log.Printf("[SHIPMENT] apply tracked status: %v", err)
			continue
		}
		updated++
	}
	return updated, nil
}

// StartShipmentWorker books shipments for paid courier orders and keeps
// tracking fresh. Booking automatically means a customer gets tracking
// without waiting on a human.
func (h *Handler) StartShipmentWorker(ctx context.Context, every time.Duration) {
	if h.Shiprocket == nil {
		return
	}
	if every <= 0 {
		every = 15 * time.Minute
	}
	ticker := time.NewTicker(every)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				h.bookPendingShipments(ctx)
				if _, err := h.RefreshShipmentTracking(ctx); err != nil {
					log.Printf("[SHIPMENT] refresh tracking: %v", err)
				}
				if _, err := h.SendReviewRequests(ctx); err != nil {
					log.Printf("[REVIEW] send requests: %v", err)
				}
			}
		}
	}()
}

// bookPendingShipments books any paid courier order that has no AWB yet.
func (h *Handler) bookPendingShipments(ctx context.Context) {
	var orders []models.Order
	if err := h.DB.WithContext(ctx).Preload("Items").
		Where(`payment_status = ? AND fulfillment_channel = ? AND awb_number = ''
		       AND cancelled_at IS NULL`,
			"paid", string(fulfillment.ChannelCourier)).
		Limit(20).
		Find(&orders).Error; err != nil {
		log.Printf("[SHIPMENT] load pending: %v", err)
		return
	}

	for i := range orders {
		if _, err := h.bookShipment(ctx, &orders[i]); err != nil {
			log.Printf("[SHIPMENT] auto-book order %d: %v", orders[i].ID, err)
		}
	}
}

// invalidateOrderCaches clears the cached order lists after a state change.
func (h *Handler) invalidateOrderCaches(ctx context.Context) {
	if h.Cache == nil {
		return
	}
	_ = h.Cache.DeletePattern(ctx, "orders:*")
}

// estimateLineWeight approximates a line's shipping weight. Real weights
// should come from the product, but a plant in a 6-inch pot is close
// enough to a kilo that this beats sending zero.
func estimateLineWeight(item models.OrderItem) float64 {
	return float64(item.Quantity) * 1.0
}

func derefUint(v *uint) uint {
	if v == nil {
		return 0
	}
	return *v
}
