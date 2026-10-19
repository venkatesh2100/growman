package handlers

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/metrics"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"gorm.io/gorm"
)

// Refund flow
//
// A refund is always recorded locally *before* it is requested from
// Razorpay, so a provider timeout can never leave money moved with no
// record of it. The local row starts "pending" and is advanced to
// "processed" or "failed" by the refund webhooks (webhooks.go), which are
// the authoritative source — the synchronous API response is only used to
// capture the provider's refund ID.

// validRefundReasons keeps reporting meaningful; "other" carries Notes.
var validRefundReasons = map[string]bool{
	"customer_cancelled": true,
	"damaged":            true,
	"wrong_item":         true,
	"out_of_stock":       true,
	"delivery_failed":    true,
	"other":              true,
}

// RazorpayRefundResponse is Razorpay's refund API response.
type RazorpayRefundResponse struct {
	ID        string `json:"id"`
	Amount    int    `json:"amount"`
	Currency  string `json:"currency"`
	Status    string `json:"status"`
	PaymentID string `json:"payment_id"`
}

// CreateRefund issues a full or partial refund against a paid order.
// Admin-only; customer-initiated cancellations call initiateRefund
// directly via CancelOrder.
func (h *Handler) CreateRefund(w http.ResponseWriter, r *http.Request) {
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
		httpjson.Error(w, http.StatusBadRequest, "invalid order ID")
		return
	}

	var req struct {
		Amount float64 `json:"amount"` // zero or omitted means full remaining
		Reason string  `json:"reason"`
		Notes  string  `json:"notes"`
		// Restock returns the order's units to inventory. Off by default:
		// a plant refunded as damaged is usually not resellable.
		Restock bool `json:"restock"`
	}
	if !httpjson.Decode(w, r, &req) {
		return
	}
	if req.Reason == "" {
		req.Reason = "other"
	}
	if !validRefundReasons[req.Reason] {
		httpjson.Error(w, http.StatusBadRequest, "invalid refund reason")
		return
	}

	var order models.Order
	if err := h.DB.WithContext(r.Context()).Preload("Items").First(&order, orderID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			httpjson.Error(w, http.StatusNotFound, "order not found")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "failed to load order")
		return
	}

	refund, err := h.initiateRefund(r.Context(), &order, req.Amount, req.Reason, req.Notes, &claims.UserID, req.Restock)
	if err != nil {
		status, msg := refundErrorResponse(err)
		httpjson.Error(w, status, msg)
		return
	}

	httpjson.JSON(w, http.StatusOK, map[string]any{
		"success": true,
		"refund":  refund,
	})
	h.notifyOrderEvent(r.Context(), order, "Refund started", "A refund has been started for this order.", "refund-started")
}

// CancelOrder lets a customer cancel their own pre-dispatch order, and
// refunds it if it was paid. Admins may cancel any order.
func (h *Handler) CancelOrder(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	orderID, err := strconv.ParseUint(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid order ID")
		return
	}

	var req struct {
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req) // optional body

	query := h.DB.WithContext(r.Context()).Preload("Items").Where("id = ?", orderID)
	if !appauth.IsAdminRole(claims.Role) {
		query = query.Where("user_id = ?", claims.UserID)
	}

	var order models.Order
	if err := query.First(&order).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			httpjson.Error(w, http.StatusNotFound, "order not found")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "failed to load order")
		return
	}

	if !order.IsCancellable() {
		httpjson.JSON(w, http.StatusConflict, map[string]any{
			"error":  "not_cancellable",
			"reason": "This order has already shipped or been cancelled. Contact support for a return.",
		})
		return
	}

	now := time.Now()
	reason := strings.TrimSpace(req.Reason)
	if reason == "" {
		reason = "customer_cancelled"
	}

	// Cancel and return the stock in one transaction, then refund. A
	// cancelled-but-unrefunded order is recoverable; a refunded-but-still-
	// open one is not.
	if err := h.DB.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.Order{}).Where("id = ?", order.ID).Updates(map[string]any{
			"status":        "cancelled",
			"cancelled_at":  &now,
			"cancel_reason": reason,
		}).Error; err != nil {
			return err
		}
		// Cancelled stock is always resellable — nothing shipped.
		return h.releaseOrderInventory(tx, &order)
	}); err != nil {
		log.Printf("[REFUND] cancel order %d: %v", order.ID, err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to cancel order")
		return
	}

	response := map[string]any{"success": true, "status": "cancelled"}

	if order.PaymentStatus == "paid" && order.RefundedAmount < order.Amount {
		refund, err := h.initiateRefund(r.Context(), &order, 0, "customer_cancelled", reason, nil, false)
		if err != nil {
			// The order is cancelled; the refund needs a human. Raise it
			// rather than failing the whole request.
			log.Printf("[REFUND] auto-refund for cancelled order %d failed: %v", order.ID, err)
			h.raiseRefundSupportRequest(order, err)
			response["refund"] = "pending_manual"
			response["message"] = "Order cancelled. Our team will process your refund shortly."
		} else {
			response["refund"] = refund
			response["message"] = "Order cancelled. Your refund is on its way."
		}
	} else {
		response["message"] = "Order cancelled."
	}

	go h.sendOrderCancelledEmail(order, reason)
	order.Status = "cancelled"
	h.notifyStatus(r.Context(), order)
	if response["refund"] != nil && response["refund"] != "pending_manual" {
		h.notifyOrderEvent(r.Context(), order, "Refund started", "Your refund has been requested.", "refund-started")
	}
	httpjson.JSON(w, http.StatusOK, response)
}

// initiateRefund records a refund locally, asks Razorpay for it, and
// returns the local row. amount <= 0 means the full remaining balance.
func (h *Handler) initiateRefund(ctx context.Context, order *models.Order, amount float64, reason, notes string, initiatedBy *uint, restock bool) (*models.Refund, error) {
	if order.PaymentStatus != "paid" {
		return nil, fmt.Errorf("%w: order is not paid", errRefundNotAllowed)
	}
	if order.RazorpayPaymentID == "" {
		return nil, fmt.Errorf("%w: order has no captured payment to refund", errRefundNotAllowed)
	}

	remaining := order.Amount - order.RefundedAmount
	if remaining <= 0 {
		return nil, fmt.Errorf("%w: order is already fully refunded", errRefundNotAllowed)
	}
	if amount <= 0 {
		amount = remaining
	}
	// Round to paise before comparing, so float drift cannot block a
	// legitimate full refund.
	amount = float64(int(amount*100+0.5)) / 100
	if amount > remaining+0.01 {
		return nil, fmt.Errorf("%w: refund of %.2f exceeds the %.2f remaining", errRefundNotAllowed, amount, remaining)
	}

	refund := models.Refund{
		OrderID:           order.ID,
		RazorpayPaymentID: order.RazorpayPaymentID,
		Amount:            amount,
		Currency:          order.Currency,
		Status:            "pending",
		Reason:            reason,
		Notes:             notes,
		InitiatedBy:       initiatedBy,
	}
	if refund.Currency == "" {
		refund.Currency = "INR"
	}
	if err := h.DB.WithContext(ctx).Create(&refund).Error; err != nil {
		return nil, fmt.Errorf("record refund: %w", err)
	}

	if restock {
		if err := h.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := h.releaseOrderInventory(tx, order); err != nil {
				return err
			}
			return tx.Model(&models.Refund{}).Where("id = ?", refund.ID).
				UpdateColumn("restocked_inventory", true).Error
		}); err != nil {
			log.Printf("[REFUND] restock for order %d: %v", order.ID, err) // non-fatal
		}
	}

	// Ask the provider. A failure here leaves a pending local row, which
	// is exactly what ops needs to see.
	providerRefund, err := h.createRazorpayRefund(ctx, order.RazorpayPaymentID, amount, reason, order.ID)
	if err != nil {
		if dbErr := h.DB.WithContext(ctx).Model(&models.Refund{}).Where("id = ?", refund.ID).
			Updates(map[string]any{
				"status": "failed",
				"notes":  strings.TrimSpace(notes + " provider error: " + err.Error()),
			}).Error; dbErr != nil {
			log.Printf("[REFUND] mark failed: %v", dbErr)
		}
		refund.Status = "failed"
		return &refund, fmt.Errorf("provider refund failed: %w", err)
	}

	refund.RazorpayRefundID = providerRefund.ID
	if err := h.DB.WithContext(ctx).Model(&models.Refund{}).Where("id = ?", refund.ID).
		UpdateColumn("razorpay_refund_id", providerRefund.ID).Error; err != nil {
		log.Printf("[REFUND] store provider refund id: %v", err)
	}

	// Razorpay may settle instantly for some methods; otherwise the
	// refund.processed webhook will finalise it.
	if providerRefund.Status == "processed" {
		if err := h.applyRefundOutcome(ctx, providerRefund.ID, order.RazorpayPaymentID, amount, "processed", ""); err != nil {
			log.Printf("[REFUND] apply immediate outcome: %v", err)
		}
	}

	metrics.RecordPaymentOutcome("refunded")
	return &refund, nil
}

// applyRefundOutcome is the single place a refund reaches a terminal state,
// shared by the synchronous API response and the webhooks. Idempotent: a
// replayed event will not double-count the order's refunded total.
func (h *Handler) applyRefundOutcome(ctx context.Context, providerRefundID, paymentID string, amount float64, status, errMsg string) error {
	return h.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var refund models.Refund
		err := tx.Where("razorpay_refund_id = ?", providerRefundID).First(&refund).Error
		if err == gorm.ErrRecordNotFound {
			// A refund issued directly from the Razorpay dashboard — still
			// ours to record, so reporting stays accurate.
			refund = models.Refund{
				RazorpayRefundID:  providerRefundID,
				RazorpayPaymentID: paymentID,
				Amount:            amount,
				Currency:          "INR",
				Status:            "pending",
				Reason:            "other",
				Notes:             "created outside the application (dashboard refund)",
			}
			var order models.Order
			if err := tx.Where("razorpay_payment_id = ?", paymentID).First(&order).Error; err == nil {
				refund.OrderID = order.ID
			}
			if err := tx.Create(&refund).Error; err != nil {
				return err
			}
		} else if err != nil {
			return err
		}

		// Already in this state — nothing to do.
		if refund.Status == status {
			return nil
		}

		// "processed" is final and cannot be left. Razorpay delivers at
		// least once and in no guaranteed order, so a `refund.created` can
		// arrive after the `refund.processed` it precedes; without this,
		// that event would reset the row to pending and the next delivery
		// of `refund.processed` would credit the order a second time.
		if refund.Status == "processed" {
			if status != "processed" {
				log.Printf("[REFUND] ignoring %s for already-settled refund %s", status, providerRefundID)
			}
			return nil
		}

		now := time.Now()
		updates := map[string]any{"status": status, "processed_at": &now}
		if errMsg != "" {
			updates["notes"] = strings.TrimSpace(refund.Notes + " " + errMsg)
		}
		if amount > 0 {
			updates["amount"] = amount
			refund.Amount = amount
		}
		if err := tx.Model(&models.Refund{}).Where("id = ?", refund.ID).Updates(updates).Error; err != nil {
			return err
		}

		if status != "processed" || refund.OrderID == 0 {
			return nil
		}

		// Credit the order's refunded total and derive its payment status
		// from the new total, in one statement so concurrent partial
		// refunds cannot lose an increment.
		if err := tx.Exec(`
			UPDATE orders
			SET refunded_amount = LEAST(refunded_amount + ?, amount),
			    payment_status = CASE
			        WHEN refunded_amount + ? >= amount - 0.01 THEN 'refunded'
			        ELSE 'partially_refunded'
			    END,
			    updated_at = NOW()
			WHERE id = ?`, refund.Amount, refund.Amount, refund.OrderID).Error; err != nil {
			return err
		}
		return nil
	})
}

// createRazorpayRefund calls Razorpay's refund API. speed=normal rather
// than optimum: instant refunds carry a fee and the customer-visible
// difference is small.
func (h *Handler) createRazorpayRefund(ctx context.Context, paymentID string, amount float64, reason string, orderID uint) (*RazorpayRefundResponse, error) {
	if h.Cfg.RazorpayKeyID == "" || h.Cfg.RazorpayKeySecret == "" {
		return nil, fmt.Errorf("razorpay credentials not configured")
	}

	body, err := json.Marshal(map[string]any{
		"amount": int(amount*100 + 0.5),
		"speed":  "normal",
		"notes": map[string]string{
			"reason":   reason,
			"order_id": strconv.FormatUint(uint64(orderID), 10),
		},
		// Razorpay dedupes on this key, so a retry of the same logical
		// refund cannot issue two.
		"receipt": fmt.Sprintf("refund_%d_%d", orderID, int(amount*100+0.5)),
	})
	if err != nil {
		return nil, err
	}

	endpoint := "https://api.razorpay.com/v1/payments/" + paymentID + "/refund"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	auth := base64.StdEncoding.EncodeToString([]byte(h.Cfg.RazorpayKeyID + ":" + h.Cfg.RazorpayKeySecret))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Basic "+auth)

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		log.Printf("[RAZORPAY] refund error response: %s", raw)
		return nil, fmt.Errorf("razorpay refund API returned %d", resp.StatusCode)
	}

	var out RazorpayRefundResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListRefunds returns refunds for admin reconciliation.
func (h *Handler) ListRefunds(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	if !appauth.IsAdminRole(claims.Role) {
		httpjson.Error(w, http.StatusForbidden, "admin access required")
		return
	}

	query := h.DB.WithContext(r.Context()).Order("created_at DESC").Limit(200)
	if status := strings.TrimSpace(r.URL.Query().Get("status")); status != "" && status != "all" {
		query = query.Where("status = ?", status)
	}

	var refunds []models.Refund
	if err := query.Find(&refunds).Error; err != nil {
		log.Printf("[REFUND] list: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to load refunds")
		return
	}
	httpjson.JSON(w, http.StatusOK, map[string]any{"refunds": refunds, "count": len(refunds)})
}

// raiseRefundSupportRequest records a refund that needs a human, so a
// raiseOversellSupportRequest escalates an order that was paid but whose
// stock could not be held — typically a payment that completed after the
// abandoned-order sweep had already returned the units. Someone has to
// either source the plant or refund the customer, and that decision is not
// one to make automatically.
func (h *Handler) raiseOversellSupportRequest(order models.Order, cause error) {
	req := models.OrderSupportRequest{
		OrderID:       &order.ID,
		UserID:        order.UserID,
		CustomerName:  order.CustomerName,
		CustomerEmail: order.CustomerEmail,
		CustomerPhone: order.CustomerPhone,
		IssueType:     "order_support",
		Priority:      "urgent",
		Status:        "pending",
		Source:        "system",
		UserMessage: fmt.Sprintf(
			"Order #%d was paid but its stock could not be reserved (%v). Source the stock or refund the customer.",
			order.ID, cause),
		OrderAmount:   order.Amount,
		OrderStatus:   order.Status,
		PaymentStatus: order.PaymentStatus,
	}
	if err := h.DB.Create(&req).Error; err != nil {
		log.Printf("[INVENTORY] could not record oversell support request for order %d: %v", order.ID, err)
	}
}

// failed auto-refund cannot be lost in the logs.
func (h *Handler) raiseRefundSupportRequest(order models.Order, cause error) {
	req := models.OrderSupportRequest{
		OrderID:       &order.ID,
		UserID:        order.UserID,
		CustomerName:  order.CustomerName,
		CustomerEmail: order.CustomerEmail,
		CustomerPhone: order.CustomerPhone,
		IssueType:     "refund",
		Priority:      "urgent",
		Status:        "pending",
		Source:        "system",
		UserMessage:   fmt.Sprintf("Automatic refund for cancelled order #%d failed and needs manual processing: %v", order.ID, cause),
		OrderAmount:   order.Amount,
		OrderStatus:   order.Status,
		PaymentStatus: order.PaymentStatus,
	}
	if err := h.DB.Create(&req).Error; err != nil {
		log.Printf("[REFUND] raise support request: %v", err)
	}
}

// errRefundNotAllowed marks refusals that are the caller's fault (409)
// rather than a server failure.
var errRefundNotAllowed = fmt.Errorf("refund not allowed")

func refundErrorResponse(err error) (int, string) {
	if strings.Contains(err.Error(), errRefundNotAllowed.Error()) {
		msg := strings.TrimPrefix(err.Error(), errRefundNotAllowed.Error()+": ")
		return http.StatusConflict, msg
	}
	return http.StatusInternalServerError, "failed to process refund"
}
