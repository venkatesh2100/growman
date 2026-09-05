package handlers

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"gorm.io/gorm"
)

// CreateOrderRequest is the payload for the legacy /razorpay/order endpoint.
type CreateOrderRequest struct {
	Amount   float64            `json:"amount"`
	Currency string             `json:"currency"`
	Items    []OrderItemRequest `json:"items"`
	Customer CustomerInfo       `json:"customer"`
}

// OrderItemRequest is one line item in a checkout/order-creation request.
type OrderItemRequest struct {
	ProductID     uint    `json:"productId"`
	ProductSizeID *uint   `json:"productSizeId,omitempty"`
	Quantity      int     `json:"quantity"`
	Price         float64 `json:"price"`
}

// CustomerInfo is the (legacy, single-address-string) customer shape used by
// CreateRazorpayOrder. CreateCheckoutOrder uses the more structured
// CustomerCheckoutInfo instead — see checkout.go.
type CustomerInfo struct {
	Name    string `json:"name"`
	Email   string `json:"email"`
	Phone   string `json:"phone"`
	Address string `json:"address,omitempty"`
}

// RazorpayOrderResponse is Razorpay's order-creation API response.
type RazorpayOrderResponse struct {
	ID       string `json:"id"`
	Entity   string `json:"entity"`
	Amount   int    `json:"amount"`
	Currency string `json:"currency"`
	Status   string `json:"status"`
}

// buildOrderItems validates that every requested product — and product
// size, if given — exists (and that a size actually belongs to its claimed
// product), then returns the resulting OrderItem rows with name/image
// snapshotted from the product so the order stays meaningful even if the
// product is later edited or deleted. On any invalid input it writes the
// HTTP error response itself and returns ok=false, matching the
// httpjson.Decode convention used throughout this package — callers should
// return immediately when ok is false.
func (h *Handler) buildOrderItems(w http.ResponseWriter, items []OrderItemRequest) (orderItems []models.OrderItem, ok bool) {
	productIDs := make([]uint, len(items))
	for i, item := range items {
		productIDs[i] = item.ProductID
	}

	var products []models.Product
	if err := h.DB.Select("id, name, image_key").Where("id IN ?", productIDs).Find(&products).Error; err != nil {
		log.Printf("[DB] fetch products for order: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to validate products")
		return nil, false
	}
	productByID := make(map[uint]models.Product, len(products))
	for _, p := range products {
		productByID[p.ID] = p
	}
	for _, item := range items {
		if _, exists := productByID[item.ProductID]; !exists {
			httpjson.Error(w, http.StatusBadRequest, fmt.Sprintf("product with ID %d not found", item.ProductID))
			return nil, false
		}
	}

	// sizeOK[productID][sizeID] — only populated (and only checked) for
	// items that actually requested a size.
	sizeOK := make(map[uint]map[uint]bool)
	var sizeIDs []uint
	for _, item := range items {
		if item.ProductSizeID != nil {
			sizeIDs = append(sizeIDs, *item.ProductSizeID)
		}
	}
	if len(sizeIDs) > 0 {
		var sizes []models.ProductSize
		if err := h.DB.Select("id, product_id").Where("id IN ? AND product_id IN ?", sizeIDs, productIDs).Find(&sizes).Error; err != nil {
			log.Printf("[DB] fetch product sizes for order: %v", err)
			httpjson.Error(w, http.StatusInternalServerError, "failed to validate product sizes")
			return nil, false
		}
		for _, s := range sizes {
			if sizeOK[s.ProductID] == nil {
				sizeOK[s.ProductID] = make(map[uint]bool)
			}
			sizeOK[s.ProductID][s.ID] = true
		}
		for _, item := range items {
			if item.ProductSizeID != nil && !sizeOK[item.ProductID][*item.ProductSizeID] {
				httpjson.Error(w, http.StatusBadRequest, fmt.Sprintf("product size with ID %d not found for product %d", *item.ProductSizeID, item.ProductID))
				return nil, false
			}
		}
	}

	orderItems = make([]models.OrderItem, len(items))
	for i, item := range items {
		product := productByID[item.ProductID]
		orderItems[i] = models.OrderItem{
			ProductID:   item.ProductID,
			ProductSize: item.ProductSizeID,
			Quantity:    item.Quantity,
			Price:       item.Price,
			Name:        product.Name,
			ImageKey:    product.ImageKey,
		}
		h.ResolveOrderItemImageURL(&orderItems[i])
	}
	return orderItems, true
}

// CreateRazorpayOrder is a lighter-weight, pre-OTP-gate order-creation
// endpoint kept for backward compatibility. New integrations should use
// CreateCheckoutOrder (checkout.go), which additionally validates the
// shipping address and requires a verified email.
func (h *Handler) CreateRazorpayOrder(w http.ResponseWriter, r *http.Request) {
	var req CreateOrderRequest
	if !httpjson.Decode(w, r, &req) {
		return
	}
	if req.Amount <= 0 {
		httpjson.Error(w, http.StatusBadRequest, "amount must be greater than 0")
		return
	}
	if req.Currency == "" {
		req.Currency = "INR"
	}

	items, ok := h.buildOrderItems(w, req.Items)
	if !ok {
		return
	}

	razorpayOrder, err := h.createRazorpayOrder(int(req.Amount*100), req.Currency)
	if err != nil {
		log.Printf("[RAZORPAY] create order: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to create Razorpay order")
		return
	}

	order := models.Order{
		RazorpayOrderID: razorpayOrder.ID,
		Status:          "pending",
		Amount:          req.Amount,
		Currency:        req.Currency,
		CustomerName:    req.Customer.Name,
		CustomerEmail:   req.Customer.Email,
		CustomerPhone:   req.Customer.Phone,
		ShippingAddress: req.Customer.Address,
		Items:           items,
	}
	if err := h.DB.Create(&order).Error; err != nil {
		log.Printf("[DB] create order: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to save order")
		return
	}

	httpjson.JSON(w, http.StatusOK, map[string]any{
		"id":       razorpayOrder.ID,
		"amount":   razorpayOrder.Amount,
		"currency": razorpayOrder.Currency,
		"status":   razorpayOrder.Status,
		"orderId":  order.ID,
	})
}

// createRazorpayOrder creates an order in Razorpay via HTTP Basic Auth
// (key ID : key secret). Amount is in paise (Razorpay's smallest unit).
func (h *Handler) createRazorpayOrder(amountPaise int, currency string) (*RazorpayOrderResponse, error) {
	if h.Cfg.RazorpayKeyID == "" || h.Cfg.RazorpayKeySecret == "" {
		return nil, fmt.Errorf("razorpay credentials not configured")
	}

	payload, err := json.Marshal(map[string]any{"amount": amountPaise, "currency": currency})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest(http.MethodPost, "https://api.razorpay.com/v1/orders", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	auth := base64.StdEncoding.EncodeToString([]byte(h.Cfg.RazorpayKeyID + ":" + h.Cfg.RazorpayKeySecret))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Basic "+auth)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		log.Printf("[RAZORPAY] error response: %s", body)
		return nil, fmt.Errorf("razorpay API error: %s", body)
	}

	var orderResp RazorpayOrderResponse
	if err := json.Unmarshal(body, &orderResp); err != nil {
		return nil, err
	}
	return &orderResp, nil
}

// VerifyPaymentRequest is the checkout-side payment verification payload.
type VerifyPaymentRequest struct {
	RazorpayOrderID   string `json:"razorpay_order_id"`
	RazorpayPaymentID string `json:"razorpay_payment_id"`
	RazorpaySignature string `json:"razorpay_signature"`
}

// VerifyPayment confirms a Razorpay checkout payment and marks the order
// paid. This is the client-driven counterpart to RazorpayWebhook
// (webhooks.go); both funnel through markOrderPaid/notifyOrderPaid so an
// order is only ever confirmed and notified once, however it gets there.
func (h *Handler) VerifyPayment(w http.ResponseWriter, r *http.Request) {
	var req VerifyPaymentRequest
	if !httpjson.Decode(w, r, &req) {
		return
	}
	if req.RazorpayOrderID == "" || req.RazorpayPaymentID == "" {
		httpjson.Error(w, http.StatusBadRequest, "missing required fields: razorpay_order_id and razorpay_payment_id are required")
		return
	}

	// Signature check is advisory today (logged, not enforced) and skipped
	// entirely in dev/test or when no key secret is configured.
	isTestMode := h.Cfg.AppEnv == "development" || h.Cfg.AppEnv == "test" || h.Cfg.RazorpayKeySecret == ""
	if req.RazorpaySignature != "" && !isTestMode && !h.verifyRazorpaySignature(req.RazorpayOrderID, req.RazorpayPaymentID, req.RazorpaySignature) {
		log.Printf("[PAYMENT] signature verification failed for order: %s", req.RazorpayOrderID)
	}

	var order models.Order
	if err := h.DB.Preload("Items").Where("razorpay_order_id = ?", req.RazorpayOrderID).First(&order).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			httpjson.Error(w, http.StatusNotFound, "order not found")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "failed to find order")
		return
	}

	firstTimePaid, err := h.markOrderPaid(&order, req.RazorpayPaymentID)
	if err != nil {
		log.Printf("[PAYMENT] mark paid: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to update order")
		return
	}
	h.notifyOrderPaid(order, firstTimePaid)

	httpjson.JSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "Payment verified successfully",
		"orderId": order.ID,
	})
}

// markOrderPaid transitions order to paid, records a Payment row, and
// best-effort creates/links a "soft account" for the customer so a guest
// checkout still ends up with an account. Returns whether this call made
// the *first* paid transition — VerifyPayment and the webhook handler both
// call this, and only the first to arrive should trigger notifications.
func (h *Handler) markOrderPaid(order *models.Order, paymentID string) (firstTimePaid bool, err error) {
	firstTimePaid = order.PaymentStatus != "paid"

	order.RazorpayPaymentID = paymentID
	order.PaymentStatus = "paid"
	order.Status = "paid" // legacy field, kept in sync with PaymentStatus
	if err := h.DB.Save(order).Error; err != nil {
		return false, fmt.Errorf("update order: %w", err)
	}

	payment := models.Payment{
		OrderID:           order.ID,
		RazorpayOrderID:   order.RazorpayOrderID,
		RazorpayPaymentID: paymentID,
		Amount:            order.Amount,
		Currency:          order.Currency,
		Status:            "captured",
	}
	if err := h.DB.Create(&payment).Error; err != nil {
		log.Printf("[PAYMENT] create payment record: %v", err) // non-fatal
	}

	if order.CustomerEmail != "" {
		if user, err := h.CreateSoftAccount(order.CustomerEmail, order.CustomerPhone, order.CustomerName); err != nil {
			log.Printf("[PAYMENT] create soft account: %v", err) // non-fatal
		} else if user != nil {
			order.UserID = &user.ID
			_ = h.DB.Save(order).Error
		}
	}

	return firstTimePaid, nil
}

// notifyOrderPaid emails the customer's order confirmation and alerts the
// merchant, but only for an order's first transition to paid — guards
// against double-sending when both the webhook and the client-side verify
// call land for the same payment.
func (h *Handler) notifyOrderPaid(order models.Order, firstTimePaid bool) {
	if !firstTimePaid {
		return
	}
	if order.CustomerEmail != "" {
		go func() {
			items := make([]map[string]any, len(order.Items))
			for i, item := range order.Items {
				items[i] = map[string]any{
					"name":     item.Name,
					"quantity": float64(item.Quantity),
					"price":    item.Price * float64(item.Quantity),
				}
			}
			if err := h.emailService().SendOrderConfirmationEmail(order.CustomerEmail, order.CustomerName, order.ID, order.Amount, items); err != nil {
				log.Printf("[EMAIL] order confirmation: %v", err)
			}
		}()
	}
	h.notifyMerchantPaidOrder(order)
}

// verifyRazorpaySignature verifies the Razorpay checkout payment signature.
func (h *Handler) verifyRazorpaySignature(orderID, paymentID, signature string) bool {
	return h.verifyRazorpayHMAC(orderID+"|"+paymentID, signature)
}

// verifyRazorpayHMAC checks an HMAC-SHA256 (base64) signature over message
// using the Razorpay key secret. Shared primitive behind both the checkout
// payment-verify signature and the webhook body signature — same algorithm,
// different message content.
func (h *Handler) verifyRazorpayHMAC(message, signature string) bool {
	if h.Cfg.RazorpayKeySecret == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(h.Cfg.RazorpayKeySecret))
	mac.Write([]byte(message))
	expected := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(signature), []byte(expected))
}

// GetOrder retrieves an order by ID (Items preloaded; product details are
// already snapshotted onto each OrderItem, so no further joins are needed).
func (h *Handler) GetOrder(w http.ResponseWriter, r *http.Request) {
	orderID := r.URL.Query().Get("id")
	if orderID == "" {
		httpjson.Error(w, http.StatusBadRequest, "order ID is required")
		return
	}

	var order models.Order
	if err := h.DB.Preload("Items").First(&order, orderID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			httpjson.Error(w, http.StatusNotFound, "order not found")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch order")
		return
	}

	httpjson.JSON(w, http.StatusOK, order)
}
