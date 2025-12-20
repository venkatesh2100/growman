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

// CreateOrderRequest represents the request to create a Razorpay order
type CreateOrderRequest struct {
	Amount   float64              `json:"amount"`
	Currency string               `json:"currency"`
	Items    []OrderItemRequest   `json:"items"`
	Customer CustomerInfo         `json:"customer"`
}

type OrderItemRequest struct {
	ProductID   uint    `json:"productId"`
	ProductSizeID *uint  `json:"productSizeId,omitempty"`
	Quantity    int     `json:"quantity"`
	Price       float64 `json:"price"`
}

type CustomerInfo struct {
	Name    string `json:"name"`
	Email   string `json:"email"`
	Phone   string `json:"phone"`
	Address string `json:"address,omitempty"`
}

// RazorpayOrderResponse represents Razorpay's order creation response
type RazorpayOrderResponse struct {
	ID      string `json:"id"`
	Entity  string `json:"entity"`
	Amount  int    `json:"amount"`
	Currency string `json:"currency"`
	Status  string `json:"status"`
}

// CreateRazorpayOrder creates a Razorpay order and stores it in the database
func (h *Handler) CreateRazorpayOrder(w http.ResponseWriter, r *http.Request) {
	var req CreateOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Amount <= 0 {
		httpjson.Error(w, http.StatusBadRequest, "amount must be greater than 0")
		return
	}

	if req.Currency == "" {
		req.Currency = "INR"
	}

	// Convert amount to paise (Razorpay expects amount in smallest currency unit)
	amountInPaise := int(req.Amount * 100)

	// Create order in Razorpay
	razorpayOrder, err := h.createRazorpayOrder(amountInPaise, req.Currency)
	if err != nil {
		log.Printf("[RAZORPAY] Error creating order: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to create Razorpay order")
		return
	}

	// Create order in database
	order := models.Order{
		RazorpayOrderID: razorpayOrder.ID,
		Status:          "pending",
		Amount:          req.Amount,
		Currency:        req.Currency,
		CustomerName:    req.Customer.Name,
		CustomerEmail:   req.Customer.Email,
		CustomerPhone:   req.Customer.Phone,
		ShippingAddress: req.Customer.Address,
	}

	// Create order items
	for _, item := range req.Items {
		var productSizeID *uint
		if item.ProductSizeID != nil {
			productSizeID = item.ProductSizeID
		}
		orderItem := models.OrderItem{
			ProductID:   item.ProductID,
			ProductSize: productSizeID,
			Quantity:    item.Quantity,
			Price:       item.Price,
		}

		// Fetch product details
		var product models.Product
		if err := h.DB.First(&product, item.ProductID).Error; err == nil {
			orderItem.Name = product.Name
			orderItem.ImageURL = product.ImageURL
		}

		order.Items = append(order.Items, orderItem)
	}

	// Save order to database
	if err := h.DB.Create(&order).Error; err != nil {
		log.Printf("[DB] Error creating order: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to save order")
		return
	}

	// Return order details
	httpjson.JSON(w, http.StatusOK, map[string]interface{}{
		"id":     razorpayOrder.ID,
		"amount": razorpayOrder.Amount,
		"currency": razorpayOrder.Currency,
		"status": razorpayOrder.Status,
		"orderId": order.ID,
	})
}

// createRazorpayOrder creates an order in Razorpay
func (h *Handler) createRazorpayOrder(amount int, currency string) (*RazorpayOrderResponse, error) {
	if h.Cfg.RazorpayKeyID == "" || h.Cfg.RazorpayKeySecret == "" {
		return nil, fmt.Errorf("Razorpay credentials not configured")
	}

	url := "https://api.razorpay.com/v1/orders"
	
	payload := map[string]interface{}{
		"amount":   amount,
		"currency": currency,
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, err
	}

	auth := base64.StdEncoding.EncodeToString([]byte(h.Cfg.RazorpayKeyID + ":" + h.Cfg.RazorpayKeySecret))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Basic "+auth)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		log.Printf("[RAZORPAY] Error response: %s", string(body))
		return nil, fmt.Errorf("Razorpay API error: %s", string(body))
	}

	var orderResp RazorpayOrderResponse
	if err := json.Unmarshal(body, &orderResp); err != nil {
		return nil, err
	}

	return &orderResp, nil
}

// VerifyPaymentRequest represents the payment verification request
type VerifyPaymentRequest struct {
	RazorpayOrderID   string `json:"razorpay_order_id"`
	RazorpayPaymentID string `json:"razorpay_payment_id"`
	RazorpaySignature string `json:"razorpay_signature"`
}

// VerifyPayment verifies the Razorpay payment signature and updates the order
func (h *Handler) VerifyPayment(w http.ResponseWriter, r *http.Request) {
	var req VerifyPaymentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Verify signature
	if !h.verifyRazorpaySignature(req.RazorpayOrderID, req.RazorpayPaymentID, req.RazorpaySignature) {
		httpjson.Error(w, http.StatusBadRequest, "invalid payment signature")
		return
	}

	// Find order by Razorpay order ID
	var order models.Order
	if err := h.DB.Preload("Items").Where("razorpay_order_id = ?", req.RazorpayOrderID).First(&order).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			httpjson.Error(w, http.StatusNotFound, "order not found")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "failed to find order")
		return
	}

	// Update order status
	order.RazorpayPaymentID = req.RazorpayPaymentID
	order.Status = "paid"
	
	if err := h.DB.Save(&order).Error; err != nil {
		log.Printf("[DB] Error updating order: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to update order")
		return
	}

	// Create payment record
	payment := models.Payment{
		OrderID:           order.ID,
		RazorpayOrderID:   req.RazorpayOrderID,
		RazorpayPaymentID: req.RazorpayPaymentID,
		Amount:            order.Amount,
		Currency:          order.Currency,
		Status:            "captured",
	}

	if err := h.DB.Create(&payment).Error; err != nil {
		log.Printf("[DB] Error creating payment record: %v", err)
	}

	httpjson.JSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Payment verified successfully",
		"orderId": order.ID,
	})
}

// verifyRazorpaySignature verifies the Razorpay payment signature
func (h *Handler) verifyRazorpaySignature(orderID, paymentID, signature string) bool {
	if h.Cfg.RazorpayKeySecret == "" {
		return false
	}

	message := orderID + "|" + paymentID
	mac := hmac.New(sha256.New, []byte(h.Cfg.RazorpayKeySecret))
	mac.Write([]byte(message))
	expectedSignature := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	return hmac.Equal([]byte(signature), []byte(expectedSignature))
}

// GetOrder retrieves an order by ID
func (h *Handler) GetOrder(w http.ResponseWriter, r *http.Request) {
	orderID := r.URL.Query().Get("id")
	if orderID == "" {
		httpjson.Error(w, http.StatusBadRequest, "order ID is required")
		return
	}

	var order models.Order
	if err := h.DB.Preload("Items").Preload("Items.Product").First(&order, orderID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			httpjson.Error(w, http.StatusNotFound, "order not found")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch order")
		return
	}

	httpjson.JSON(w, http.StatusOK, order)
}

