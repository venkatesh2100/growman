package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/metrics"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"gorm.io/gorm"
)

// maxWebhookAge discards replays of old events. Razorpay retries for up to
// 24h, but a genuine delivery always carries a recent created_at — a much
// older one is either a replay attack or a long-dead retry we have already
// reconciled by other means.
const maxWebhookAge = 10 * time.Minute

// webhookProcessTimeout bounds background processing so a stuck handler
// cannot leak goroutines.
const webhookProcessTimeout = 30 * time.Second

// RazorpayWebhookPayload is Razorpay's webhook envelope.
type RazorpayWebhookPayload struct {
	Event     string         `json:"event"`
	CreatedAt int64          `json:"created_at"`
	Payload   map[string]any `json:"payload"`
}

// RazorpayWebhook is the server-to-server counterpart to VerifyPayment
// (payments.go): Razorpay calls this directly, authenticated by an HMAC
// body signature instead of a JWT (mounted outside /api/v1, no auth
// middleware — see internal/server/router.go).
//
// The handler does the minimum synchronously — verify, claim, acknowledge —
// and processes in the background. Razorpay requires a 2xx within 5
// seconds and treats a timeout as a delivery failure, which would
// otherwise send it into a 24-hour retry cycle against work we had in fact
// already started.
func (h *Handler) RazorpayWebhook(w http.ResponseWriter, r *http.Request) {
	// The signature covers the exact bytes sent, so the raw body must be
	// read and verified before any parsing. Re-serialising parsed JSON
	// changes key order and whitespace and can never match.
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
		log.Printf("[WEBHOOK] invalid signature (check RAZORPAY_WEBHOOK_SECRET matches the dashboard webhook secret, not the API key secret)")
		metrics.RecordPaymentSignatureFailure("webhook")
		httpjson.Error(w, http.StatusUnauthorized, "invalid signature")
		return
	}

	var payload RazorpayWebhookPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid payload")
		return
	}

	// Replay guard. Razorpay stamps created_at on every event.
	if payload.CreatedAt > 0 {
		age := time.Since(time.Unix(payload.CreatedAt, 0))
		if age > maxWebhookAge {
			log.Printf("[WEBHOOK] discarding stale event %s (age %s)", payload.Event, age.Round(time.Second))
			httpjson.JSON(w, http.StatusOK, map[string]any{"success": true, "skipped": "stale"})
			return
		}
	}

	// x-razorpay-event-id is unique per event and is the documented way to
	// detect duplicates. Fall back to a derived key if absent so dedup
	// still works rather than silently degrading.
	eventID := r.Header.Get("X-Razorpay-Event-Id")
	if eventID == "" {
		eventID = fmt.Sprintf("derived:%s:%d", payload.Event, payload.CreatedAt)
	}

	claimed, err := h.claimWebhookEvent("razorpay", eventID, payload.Event, string(body))
	if err != nil {
		log.Printf("[WEBHOOK] claim event: %v", err)
		// Let Razorpay retry — we could not record the event, so we cannot
		// promise it will be processed.
		httpjson.Error(w, http.StatusInternalServerError, "failed to record event")
		return
	}
	if !claimed {
		// Already seen. Acknowledge so Razorpay stops retrying.
		httpjson.JSON(w, http.StatusOK, map[string]any{"success": true, "duplicate": true})
		return
	}

	// Acknowledge now, process after. The event is durably recorded, so a
	// crash mid-processing leaves a row in "received" for reconciliation
	// rather than losing the payment entirely.
	httpjson.JSON(w, http.StatusOK, map[string]any{"success": true})

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), webhookProcessTimeout)
		defer cancel()
		h.processRazorpayEvent(ctx, eventID, payload)
	}()
}

// claimWebhookEvent atomically records an event, returning false if it has
// already been seen. The unique index on event_id is what makes the claim
// atomic: concurrent duplicate deliveries race on the insert and exactly
// one wins, so side effects run exactly once without an application lock.
func (h *Handler) claimWebhookEvent(provider, eventID, eventType, body string) (bool, error) {
	event := models.WebhookEvent{
		Provider:  provider,
		EventID:   eventID,
		EventType: eventType,
		Status:    "received",
		Payload:   body,
	}
	// Deliberately not an upsert: a conflict is the signal we want.
	err := h.DB.Create(&event).Error
	if err == nil {
		return true, nil
	}
	if isUniqueViolation(err) {
		return false, nil
	}
	return false, err
}

// processRazorpayEvent dispatches a verified, de-duplicated event and
// records the outcome on its ledger row.
func (h *Handler) processRazorpayEvent(ctx context.Context, eventID string, payload RazorpayWebhookPayload) {
	var err error
	switch payload.Event {
	case "payment.captured", "order.paid":
		err = h.handlePaymentCaptured(ctx, payload.Payload)
	case "payment.failed":
		err = h.handlePaymentFailed(ctx, payload.Payload)
	case "refund.created":
		err = h.handleRefundCreated(ctx, payload.Payload)
	case "refund.processed":
		err = h.handleRefundProcessed(ctx, payload.Payload)
	case "refund.failed":
		err = h.handleRefundFailed(ctx, payload.Payload)
	case "payment.dispute.created":
		// No automated action: disputes need a human, but ops must know
		// immediately because Razorpay imposes a response deadline.
		err = h.handleDisputeCreated(ctx, payload.Payload)
	default:
		// Unsubscribed event type. Recorded, intentionally not processed.
		h.finishWebhookEvent(eventID, "processed", nil)
		return
	}

	if err != nil {
		log.Printf("[WEBHOOK] %s: %v", payload.Event, err)
		h.finishWebhookEvent(eventID, "failed", err)
		return
	}
	h.finishWebhookEvent(eventID, "processed", nil)
}

// finishWebhookEvent stamps the terminal state on a ledger row. Rows left
// in "failed" are the manual-reconciliation queue.
func (h *Handler) finishWebhookEvent(eventID, status string, cause error) {
	now := time.Now()
	updates := map[string]any{
		"status":       status,
		"processed_at": &now,
	}
	if cause != nil {
		updates["error"] = cause.Error()
	}
	if err := h.DB.Model(&models.WebhookEvent{}).
		Where("event_id = ?", eventID).
		UpdateColumns(updates).Error; err != nil {
		log.Printf("[WEBHOOK] update event status: %v", err)
	}
}

// handlePaymentCaptured mirrors VerifyPayment's paid-order transition via
// the shared markOrderPaid/notifyOrderPaid helpers (payments.go), so an
// order is confirmed and notified exactly once regardless of whether the
// webhook or the client-side verify call arrives first.
func (h *Handler) handlePaymentCaptured(ctx context.Context, payload map[string]any) error {
	paymentEntity, err := webhookEntity(payload, "payment")
	if err != nil {
		return err
	}
	razorpayPaymentID, ok := paymentEntity["id"].(string)
	if !ok {
		return fmt.Errorf("invalid payment ID")
	}

	// order.paid carries an order entity; payment.captured does not always,
	// but the payment entity always references its order.
	razorpayOrderID, _ := paymentEntity["order_id"].(string)
	if razorpayOrderID == "" {
		if orderEntity, err := webhookEntity(payload, "order"); err == nil {
			razorpayOrderID, _ = orderEntity["id"].(string)
		}
	}
	if razorpayOrderID == "" {
		return fmt.Errorf("event carries no order reference")
	}

	var order models.Order
	if err := h.DB.WithContext(ctx).Preload("Items").
		Where("razorpay_order_id = ?", razorpayOrderID).First(&order).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			// Razorpay retries failed webhooks; don't make it retry forever
			// for an order we're never going to recognize.
			log.Printf("[WEBHOOK] order not found: %s", razorpayOrderID)
			return nil
		}
		return err
	}

	firstTimePaid, err := h.markOrderPaid(ctx, &order, razorpayPaymentID)
	if err != nil {
		return err
	}
	h.notifyOrderPaid(order, firstTimePaid)
	return nil
}

// handlePaymentFailed records the terminal failure so an abandoned order
// stops looking merely "created", and releases its stock reservation.
func (h *Handler) handlePaymentFailed(ctx context.Context, payload map[string]any) error {
	paymentEntity, err := webhookEntity(payload, "payment")
	if err != nil {
		return err
	}
	razorpayOrderID, _ := paymentEntity["order_id"].(string)
	if razorpayOrderID == "" {
		return fmt.Errorf("event carries no order reference")
	}

	var order models.Order
	if err := h.DB.WithContext(ctx).Preload("Items").
		Where("razorpay_order_id = ?", razorpayOrderID).First(&order).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil
		}
		return err
	}
	// A later successful attempt on the same order must win: Razorpay
	// allows retries within one order, and events can arrive out of order.
	if order.PaymentStatus == "paid" {
		return nil
	}

	err = h.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.Order{}).
			Where("id = ? AND payment_status <> ?", order.ID, "paid").
			Updates(map[string]any{"payment_status": "failed", "status": "failed"}).Error; err != nil {
			return err
		}
		return h.releaseOrderInventory(tx, &order)
	})
	if err != nil {
		return err
	}
	order.Status = "failed"
	h.notifyOrderEvent(ctx, order, "Payment failed", "The payment did not go through. You can try again from Orders.", "failed")
	return nil
}

// handleRefundCreated records a refund the provider has accepted but not
// yet settled.
//
// Deliberately not routed to handleRefundProcessed. `refund.created` only
// means Razorpay took the instruction; with speed=normal the money moves
// days later and the attempt can still fail. Crediting the order here would
// mean a subsequent `refund.failed` leaves the order showing money returned
// that never left — and the customer's balance owed understated. The sole
// value of this event is picking up refunds raised from the dashboard early
// enough for support to see them.
func (h *Handler) handleRefundCreated(ctx context.Context, payload map[string]any) error {
	refundID, paymentID, amount, err := refundEventFields(payload)
	if err != nil {
		return err
	}
	return h.applyRefundOutcome(ctx, refundID, paymentID, amount, "pending", "")
}

// handleRefundProcessed advances our refund record and the order's
// refunded total from the provider's authoritative settlement event.
func (h *Handler) handleRefundProcessed(ctx context.Context, payload map[string]any) error {
	refundID, paymentID, amount, err := refundEventFields(payload)
	if err != nil {
		return err
	}
	if paymentID == "" {
		return fmt.Errorf("refund event missing payment_id")
	}
	if err := h.applyRefundOutcome(ctx, refundID, paymentID, amount, "processed", ""); err != nil {
		return err
	}
	var order models.Order
	if err := h.DB.WithContext(ctx).Where("razorpay_payment_id = ?", paymentID).First(&order).Error; err == nil {
		h.notifyOrderEvent(ctx, order, "Refund completed", "The refund has been settled.", "refund-done")
	}
	return nil
}

// refundEventFields pulls the fields every refund event carries.
func refundEventFields(payload map[string]any) (refundID, paymentID string, amount float64, err error) {
	refundEntity, err := webhookEntity(payload, "refund")
	if err != nil {
		return "", "", 0, err
	}
	refundID, _ = refundEntity["id"].(string)
	paymentID, _ = refundEntity["payment_id"].(string)
	if refundID == "" {
		return "", "", 0, fmt.Errorf("refund event missing id")
	}
	return refundID, paymentID, paiseToRupees(refundEntity["amount"]), nil
}

// handleRefundFailed marks a refund failed so ops can retry it; the order's
// refunded total is deliberately left untouched.
func (h *Handler) handleRefundFailed(ctx context.Context, payload map[string]any) error {
	refundID, paymentID, _, err := refundEventFields(payload)
	if err != nil {
		return err
	}
	return h.applyRefundOutcome(ctx, refundID, paymentID, 0, "failed", "provider reported refund failure")
}

// handleDisputeCreated raises an internal support request so a dispute
// cannot sit unnoticed past Razorpay's response deadline.
func (h *Handler) handleDisputeCreated(ctx context.Context, payload map[string]any) error {
	disputeEntity, err := webhookEntity(payload, "dispute")
	if err != nil {
		return err
	}
	paymentID, _ := disputeEntity["payment_id"].(string)
	reason, _ := disputeEntity["reason_code"].(string)
	amount := paiseToRupees(disputeEntity["amount"])

	var order models.Order
	orderRef := h.DB.WithContext(ctx).Where("razorpay_payment_id = ?", paymentID).First(&order)

	req := models.OrderSupportRequest{
		IssueType:   "payment_dispute",
		Priority:    "urgent",
		Status:      "pending",
		Source:      "razorpay_webhook",
		UserMessage: fmt.Sprintf("Razorpay dispute opened on payment %s (reason: %s, amount: %.2f). Respond before the provider deadline.", paymentID, reason, amount),
		OrderAmount: amount,
	}
	if orderRef.Error == nil {
		req.OrderID = &order.ID
		req.UserID = order.UserID
		req.CustomerName = order.CustomerName
		req.CustomerEmail = order.CustomerEmail
		req.CustomerPhone = order.CustomerPhone
		req.OrderStatus = order.Status
		req.PaymentStatus = order.PaymentStatus
	}
	if err := h.DB.WithContext(ctx).Create(&req).Error; err != nil {
		return err
	}
	h.notifyMerchantDispute(paymentID, reason, amount)
	return nil
}

// webhookEntity pulls one entity out of Razorpay's nested payload shape
// ({"payload":{"payment":{"entity":{...}}}}).
func webhookEntity(payload map[string]any, name string) (map[string]any, error) {
	wrapper, ok := payload[name].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("missing %s in payload", name)
	}
	entity, ok := wrapper["entity"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("invalid %s entity", name)
	}
	return entity, nil
}

// paiseToRupees converts Razorpay's integer minor units to currency units.
func paiseToRupees(raw any) float64 {
	switch v := raw.(type) {
	case float64:
		return v / 100
	case int:
		return float64(v) / 100
	case int64:
		return float64(v) / 100
	case json.Number:
		f, err := v.Float64()
		if err != nil {
			return 0
		}
		return f / 100
	}
	return 0
}

// verifyWebhookSignature verifies the Razorpay webhook body signature.
//
// This is keyed by the *webhook* secret from the Razorpay dashboard, which
// is a different value from the API key secret used for checkout payment
// signatures. Using the key secret here makes every delivery fail.
func (h *Handler) verifyWebhookSignature(body, signature string) bool {
	return verifyRazorpayHMAC(h.Cfg.RazorpayWebhookSecret, body, signature)
}

// isUniqueViolation reports whether err is a duplicate-key error. Matched
// on message text to avoid a hard dependency on the pq/pgx error types,
// which differ between the drivers this app can be built against.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "duplicate key") ||
		strings.Contains(msg, "unique constraint") ||
		strings.Contains(msg, "23505")
}
