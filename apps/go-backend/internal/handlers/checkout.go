package handlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/services"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type SendOTPRequest struct {
	Email string `json:"email"`
}

type VerifyOTPRequest struct {
	Email string `json:"email"`
	OTP   string `json:"otp"`
}

// SendEmailOTP sends an OTP to the user's email
func (h *Handler) SendEmailOTP(w http.ResponseWriter, r *http.Request) {
	var req SendOTPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate email
	if !services.ValidateEmail(req.Email) {
		httpjson.Error(w, http.StatusBadRequest, "invalid email format")
		return
	}

	// Check if user exists - if yes, they need to login
	var existingUser models.User
	if err := h.DB.Where("email = ?", req.Email).First(&existingUser).Error; err == nil {
		httpjson.Error(w, http.StatusConflict, "user_exists")
		return
	}

	// Check rate limiting (1 OTP per 60 seconds)
	otpService := services.NewOTPService(h.Redis)
	ctx := context.Background()
	
	exists, err := otpService.CheckOTPExists(ctx, req.Email)
	if err == nil && exists {
		httpjson.Error(w, http.StatusTooManyRequests, "please wait before requesting another OTP")
		return
	}

	// Generate and send OTP
	otp, err := otpService.GenerateOTP(ctx, req.Email)
	if err != nil {
		log.Printf("[OTP] Error generating OTP: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to generate OTP")
		return
	}

	// Send email
	emailService := services.NewEmailService(h.Cfg.SMTPHost, h.Cfg.SMTPPort, h.Cfg.SMTPEmail, h.Cfg.SMTPPassword)
	if err := emailService.SendOTPEmail(req.Email, otp); err != nil {
		log.Printf("[EMAIL] Error sending OTP email: %v", err)
		// Don't fail the request if email fails, but log it
		// In production, you might want to queue this
	}

	httpjson.JSON(w, http.StatusOK, map[string]interface{}{
		"message": "OTP sent successfully",
	})
}

// VerifyEmailOTP verifies the OTP sent to user's email
func (h *Handler) VerifyEmailOTP(w http.ResponseWriter, r *http.Request) {
	var req VerifyOTPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate email
	if !services.ValidateEmail(req.Email) {
		httpjson.Error(w, http.StatusBadRequest, "invalid email format")
		return
	}

	// Verify OTP
	otpService := services.NewOTPService(h.Redis)
	ctx := context.Background()
	
	valid, err := otpService.VerifyOTP(ctx, req.Email, req.OTP)
	if err != nil {
		log.Printf("[OTP] Error verifying OTP: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to verify OTP")
		return
	}

	if !valid {
		httpjson.Error(w, http.StatusBadRequest, "invalid or expired OTP")
		return
	}

	httpjson.JSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "OTP verified successfully",
	})
}

// CreateOrderRequest represents the updated request to create a Razorpay order
type CreateCheckoutOrderRequest struct {
	Amount   float64              `json:"amount"`
	Currency string               `json:"currency"`
	Items    []OrderItemRequest   `json:"items"`
	Customer CustomerCheckoutInfo `json:"customer"`
}

type CustomerCheckoutInfo struct {
	Name        string `json:"name"`
	Email       string `json:"email"`
	Phone       string `json:"phone"`
	AddressLine string `json:"addressLine"`
	City        string `json:"city"`
	State       string `json:"state"`
	Pincode     string `json:"pincode"`
}

// Validate validates customer checkout info
func (c *CustomerCheckoutInfo) Validate() (string, bool) {
	// Validate pincode (6 digits, starting with 1-9)
	pincodeRegex := regexp.MustCompile(`^[1-9][0-9]{5}$`)
	if !pincodeRegex.MatchString(c.Pincode) {
		return "invalid pincode format", false
	}

	// Validate phone (10 digits, starting with 6-9)
	phoneRegex := regexp.MustCompile(`^[6-9][0-9]{9}$`)
	if !phoneRegex.MatchString(c.Phone) {
		return "invalid phone number format", false
	}

	// Validate email
	if !services.ValidateEmail(c.Email) {
		return "invalid email format", false
	}

	return "", true
}

// CreateCheckoutOrder creates a Razorpay order after OTP verification
func (h *Handler) CreateCheckoutOrder(w http.ResponseWriter, r *http.Request) {
	var req CreateCheckoutOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate customer info
	if msg, valid := req.Customer.Validate(); !valid {
		httpjson.Error(w, http.StatusBadRequest, msg)
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
		PaymentStatus:   "created",
		Status:          "pending", // Legacy field
		Amount:          req.Amount,
		Currency:        req.Currency,
		CustomerName:    req.Customer.Name,
		CustomerEmail:   req.Customer.Email,
		CustomerPhone:   req.Customer.Phone,
		AddressLine:     req.Customer.AddressLine,
		City:            req.Customer.City,
		State:           req.Customer.State,
		Pincode:         req.Customer.Pincode,
	}

	// Batch fetch all products to avoid N+1 queries
	productIDs := make([]uint, len(req.Items))
	for i, item := range req.Items {
		productIDs[i] = item.ProductID
	}
	
	var products []models.Product
	if err := h.DB.Select("id, name, image_key").Where("id IN ?", productIDs).Find(&products).Error; err != nil {
		log.Printf("[DB] Error fetching products: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to validate products")
		return
	}
	
	// Create a map for quick lookup
	productMap := make(map[uint]models.Product)
	for _, product := range products {
		productMap[product.ID] = product
	}
	
	// Validate all products exist
	for _, item := range req.Items {
		if _, exists := productMap[item.ProductID]; !exists {
			log.Printf("[DB] Product not found: %d", item.ProductID)
			httpjson.Error(w, http.StatusBadRequest, fmt.Sprintf("product with ID %d not found", item.ProductID))
			return
		}
	}
	
	// Batch fetch product sizes if any are provided
	productSizeIDs := make([]uint, 0)
	for _, item := range req.Items {
		if item.ProductSizeID != nil {
			productSizeIDs = append(productSizeIDs, *item.ProductSizeID)
		}
	}
	
	var productSizes []models.ProductSize
	if len(productSizeIDs) > 0 {
		if err := h.DB.Select("id, product_id").Where("id IN ? AND product_id IN ?", productSizeIDs, productIDs).Find(&productSizes).Error; err != nil {
			log.Printf("[DB] Error fetching product sizes: %v", err)
			httpjson.Error(w, http.StatusInternalServerError, "failed to validate product sizes")
			return
		}
		
		// Create a map for product size validation
		sizeMap := make(map[uint]map[uint]bool) // productID -> sizeID -> exists
		for _, size := range productSizes {
			if sizeMap[size.ProductID] == nil {
				sizeMap[size.ProductID] = make(map[uint]bool)
			}
			sizeMap[size.ProductID][size.ID] = true
		}
		
		// Validate all product sizes
		for _, item := range req.Items {
			if item.ProductSizeID != nil {
				if sizes, exists := sizeMap[item.ProductID]; !exists || !sizes[*item.ProductSizeID] {
					log.Printf("[DB] Product size not found: %d for product %d", item.ProductSizeID, item.ProductID)
					httpjson.Error(w, http.StatusBadRequest, fmt.Sprintf("product size with ID %d not found for product %d", item.ProductSizeID, item.ProductID))
					return
				}
			}
		}
	}

	// Create order items
	for _, item := range req.Items {
		var productSizeID *uint
		if item.ProductSizeID != nil {
			productSizeID = item.ProductSizeID
		}

		product := productMap[item.ProductID]
		orderItem := models.OrderItem{
			ProductID:   item.ProductID,
			ProductSize: productSizeID,
			Quantity:    item.Quantity,
			Price:       item.Price,
			Name:        product.Name,
			ImageKey:    product.ImageKey,
		}
		// Resolve image URL for order item
		h.ResolveOrderItemImageURL(&orderItem)

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

// CreateSoftAccount creates a user account after payment success
func (h *Handler) CreateSoftAccount(email, phone, name string) (*models.User, error) {
	// Check if user already exists
	var existingUser models.User
	err := h.DB.Where("email = ? OR phone = ?", email, phone).First(&existingUser).Error
	if err == nil {
		// User exists, return it
		return &existingUser, nil
	}
	if err != gorm.ErrRecordNotFound {
		return nil, err
	}

	// Generate random password
	passwordBytes := make([]byte, 16)
	if _, err := rand.Read(passwordBytes); err != nil {
		return nil, err
	}
	randomPassword := hex.EncodeToString(passwordBytes)

	// Hash password
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(randomPassword), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	// Create user
	user := models.User{
		Name:          name,
		Email:         email,
		Phone:         phone,
		PasswordHash:  string(passwordHash),
		EmailVerified: true,
		Provider:      "local",
		Role:          "user",
	}

	if err := h.DB.Create(&user).Error; err != nil {
		return nil, err
	}

	// Send account creation email (async, don't fail if it errors)
	go func() {
		emailService := services.NewEmailService(h.Cfg.SMTPHost, h.Cfg.SMTPPort, h.Cfg.SMTPEmail, h.Cfg.SMTPPassword)
		resetLink := "https://yourdomain.com/reset-password" // TODO: Update with actual reset link
		if err := emailService.SendAccountCreatedEmail(email, name, resetLink); err != nil {
			log.Printf("[EMAIL] Error sending account creation email: %v", err)
		}
	}()

	return &user, nil
}

