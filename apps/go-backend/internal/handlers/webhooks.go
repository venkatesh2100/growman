package handlers

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/services"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"gorm.io/gorm"
)

type RazorpayWebhookPayload struct {
	Event   string                 `json:"event"`
	Payload map[string]interface{} `json:"payload"`
}

// RazorpayWebhook handles Razorpay webhook events
func (h *Handler) RazorpayWebhook(w http.ResponseWriter, r *http.Request) {
	// Read the raw body for signature verification
	body, err := io.ReadAll(r.Body)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "failed to read request body")
		return
	}

	// Get Razorpay signature from header
	signature := r.Header.Get("X-Razorpay-Signature")
	if signature == "" {
		httpjson.Error(w, http.StatusBadRequest, "missing signature")
		return
	}

	// Verify webhook signature
	if !h.verifyWebhookSignature(string(body), signature) {
		log.Printf("[WEBHOOK] Invalid signature")
		httpjson.Error(w, http.StatusUnauthorized, "invalid signature")
		return
	}

	// Parse webhook payload
	var payload RazorpayWebhookPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid payload")
		return
	}

	// Handle payment.captured event
	if payload.Event == "payment.captured" {
		if err := h.handlePaymentCaptured(payload.Payload); err != nil {
			log.Printf("[WEBHOOK] Error handling payment.captured: %v", err)
			httpjson.Error(w, http.StatusInternalServerError, "failed to process webhook")
			return
		}
	}

	httpjson.JSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
	})
}

// handlePaymentCaptured handles the payment.captured webhook event
func (h *Handler) handlePaymentCaptured(payload map[string]interface{}) error {
	// Extract payment and order details from payload
	paymentEntity, ok := payload["payment"].(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid payment entity")
	}

	orderEntity, ok := payload["order"].(map[string]interface{})
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

	// Find order by Razorpay order ID
	var order models.Order
	if err := h.DB.Preload("Items").Where("razorpay_order_id = ?", razorpayOrderID).First(&order).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			log.Printf("[WEBHOOK] Order not found: %s", razorpayOrderID)
			return nil // Don't fail webhook if order not found
		}
		return err
	}

	alreadyPaid := order.PaymentStatus == "paid"

	// Update order status
	order.RazorpayPaymentID = razorpayPaymentID
	order.PaymentStatus = "paid"
	order.Status = "paid" // Legacy field

	if err := h.DB.Save(&order).Error; err != nil {
		return err
	}

	// Create payment record
	payment := models.Payment{
		OrderID:           order.ID,
		RazorpayOrderID:   razorpayOrderID,
		RazorpayPaymentID: razorpayPaymentID,
		Amount:            order.Amount,
		Currency:          order.Currency,
		Status:            "captured",
	}

	if err := h.DB.Create(&payment).Error; err != nil {
		log.Printf("[WEBHOOK] Error creating payment record: %v", err)
		// Don't fail the webhook if payment record creation fails
	}

	// Create soft account if user doesn't exist
	if order.CustomerEmail != "" {
		user, err := h.CreateSoftAccount(order.CustomerEmail, order.CustomerPhone, order.CustomerName)
		if err != nil {
			log.Printf("[WEBHOOK] Error creating soft account: %v", err)
			// Don't fail the webhook if account creation fails
		} else if user != nil {
			// Link order to user
			order.UserID = &user.ID
			h.DB.Save(&order)
		}
	}

	// Send order confirmation email
	if !alreadyPaid && order.CustomerEmail != "" {
		go func() {
			emailService := services.NewEmailService(h.Cfg.SMTPHost, h.Cfg.SMTPPort, h.Cfg.SMTPEmail, h.Cfg.SMTPPassword)

			// Prepare items for email
			items := make([]map[string]interface{}, len(order.Items))
			for i, item := range order.Items {
				items[i] = map[string]interface{}{
					"name":     item.Name,
					"quantity": float64(item.Quantity),
					"price":    item.Price * float64(item.Quantity),
				}
			}

			if err := emailService.SendOrderConfirmationEmail(
				order.CustomerEmail,
				order.CustomerName,
				order.ID,
				order.Amount,
				items,
			); err != nil {
				log.Printf("[EMAIL] Error sending order confirmation email: %v", err)
			}
		}()
	}
	if !alreadyPaid {
		h.notifyMerchantPaidOrder(order)
	}

	return nil
}

// verifyWebhookSignature verifies Razorpay webhook signature
func (h *Handler) verifyWebhookSignature(body, signature string) bool {
	if h.Cfg.RazorpayKeySecret == "" {
		return false
	}

	mac := hmac.New(sha256.New, []byte(h.Cfg.RazorpayKeySecret))
	mac.Write([]byte(body))
	expectedSignature := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	return hmac.Equal([]byte(signature), []byte(expectedSignature))
}
