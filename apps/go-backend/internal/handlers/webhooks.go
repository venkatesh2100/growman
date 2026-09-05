package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"gorm.io/gorm"
)

// RazorpayWebhookPayload is Razorpay's webhook envelope.
type RazorpayWebhookPayload struct {
	Event   string         `json:"event"`
	Payload map[string]any `json:"payload"`
}

// RazorpayWebhook is the server-to-server counterpart to VerifyPayment
// (payments.go): Razorpay calls this directly, authenticated by an
// HMAC body signature instead of a JWT (mounted outside /api/v1, no auth
// middleware — see internal/server/router.go).
func (h *Handler) RazorpayWebhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "failed to read request body")
		return
	}

	signature := r.Header.Get("X-Razorpay-Signature")
	if signature == "" {
		httpjson.Error(w, http.StatusBadRequest, "missing signature")
		return
	}
	if !h.verifyWebhookSignature(string(body), signature) {
		log.Printf("[WEBHOOK] invalid signature")
		httpjson.Error(w, http.StatusUnauthorized, "invalid signature")
		return
	}

	var payload RazorpayWebhookPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid payload")
		return
	}

	if payload.Event == "payment.captured" {
		if err := h.handlePaymentCaptured(payload.Payload); err != nil {
			log.Printf("[WEBHOOK] payment.captured: %v", err)
			httpjson.Error(w, http.StatusInternalServerError, "failed to process webhook")
			return
		}
	}

	httpjson.JSON(w, http.StatusOK, map[string]any{"success": true})
}

// handlePaymentCaptured mirrors VerifyPayment's paid-order transition via
// the shared markOrderPaid/notifyOrderPaid helpers (payments.go), so an
// order is confirmed and notified exactly once regardless of whether the
// webhook or the client-side verify call arrives first.
func (h *Handler) handlePaymentCaptured(payload map[string]any) error {
	paymentEntity, ok := payload["payment"].(map[string]any)
	if !ok {
		return fmt.Errorf("invalid payment entity")
	}
	orderEntity, ok := payload["order"].(map[string]any)
	if !ok {
		return fmt.Errorf("invalid order entity")
	}
	razorpayOrderID, ok := orderEntity["id"].(string)
	if !ok {
		return fmt.Errorf("invalid order ID")
	}
	razorpayPaymentID, ok := paymentEntity["id"].(string)
	if !ok {
		return fmt.Errorf("invalid payment ID")
	}

	var order models.Order
	if err := h.DB.Preload("Items").Where("razorpay_order_id = ?", razorpayOrderID).First(&order).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			// Razorpay retries failed webhooks; don't make it retry forever
			// for an order we're never going to recognize.
			log.Printf("[WEBHOOK] order not found: %s", razorpayOrderID)
			return nil
		}
		return err
	}

	firstTimePaid, err := h.markOrderPaid(&order, razorpayPaymentID)
	if err != nil {
		return err
	}
	h.notifyOrderPaid(order, firstTimePaid)
	return nil
}

// verifyWebhookSignature verifies the Razorpay webhook body signature.
func (h *Handler) verifyWebhookSignature(body, signature string) bool {
	return h.verifyRazorpayHMAC(body, signature)
}
