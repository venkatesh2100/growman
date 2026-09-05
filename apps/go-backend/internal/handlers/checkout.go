package handlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
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

// SendEmailOTP emails a one-time code to verify a guest's address before
// checkout. Refuses if the email already belongs to a registered user —
// they should log in and use their saved address instead.
func (h *Handler) SendEmailOTP(w http.ResponseWriter, r *http.Request) {
	var req SendOTPRequest
	if !httpjson.Decode(w, r, &req) {
		return
	}
	if !services.ValidateEmail(req.Email) {
		httpjson.Error(w, http.StatusBadRequest, "invalid email format")
		return
	}

	var existingUser models.User
	if err := h.DB.WithContext(r.Context()).Where("email = ?", req.Email).First(&existingUser).Error; err == nil {
		httpjson.Error(w, http.StatusConflict, "user_exists")
		return
	}
	if h.Cfg.SMTPEmail == "" || h.Cfg.SMTPPassword == "" {
		log.Printf("[EMAIL] SMTP credentials not configured")
		httpjson.Error(w, http.StatusServiceUnavailable, "email_unavailable")
		return
	}

	ctx := r.Context()
	otpService := services.NewOTPService(h.Redis)

	canResend, ttl, err := otpService.CanResendOTP(ctx, req.Email)
	if err != nil {
		log.Printf("[OTP] cooldown check failed: %v", err)
		httpjson.Error(w, http.StatusServiceUnavailable, "otp_unavailable")
		return
	}
	if !canResend {
		httpjson.JSON(w, http.StatusTooManyRequests, map[string]any{
			"error":       "otp_cooldown",
			"retry_after": int(ttl.Seconds()),
		})
		return
	}

	otp, err := otpService.GenerateOTP(ctx, req.Email)
	if err != nil {
		log.Printf("[OTP] generate: %v", err)
		httpjson.Error(w, http.StatusServiceUnavailable, "otp_unavailable")
		return
	}
	if err := h.emailService().SendOTPEmail(req.Email, otp); err != nil {
		log.Printf("[EMAIL] send OTP: %v", err)
		httpjson.Error(w, http.StatusBadGateway, "email_send_failed")
		return
	}

	_ = otpService.SetResendCooldown(ctx, req.Email)
	httpjson.JSON(w, http.StatusOK, map[string]any{
		"message":  "OTP sent successfully",
		"cooldown": 60,
	})
}

// VerifyEmailOTP checks the code sent by SendEmailOTP. Single-use — a
// successful check deletes the stored OTP.
func (h *Handler) VerifyEmailOTP(w http.ResponseWriter, r *http.Request) {
	var req VerifyOTPRequest
	if !httpjson.Decode(w, r, &req) {
		return
	}
	if !services.ValidateEmail(req.Email) {
		httpjson.Error(w, http.StatusBadRequest, "invalid email format")
		return
	}

	otpService := services.NewOTPService(h.Redis)
	valid, err := otpService.VerifyOTP(context.Background(), req.Email, req.OTP)
	if err != nil {
		log.Printf("[OTP] verify: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to verify OTP")
		return
	}
	if !valid {
		httpjson.Error(w, http.StatusBadRequest, "invalid or expired OTP")
		return
	}

	httpjson.JSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "OTP verified successfully",
	})
}

// CreateCheckoutOrderRequest is the payload for the OTP-gated checkout flow.
type CreateCheckoutOrderRequest struct {
	Amount   float64              `json:"amount"`
	Currency string               `json:"currency"`
	Items    []OrderItemRequest   `json:"items"`
	Customer CustomerCheckoutInfo `json:"customer"`
}

// CustomerCheckoutInfo is the structured shipping-address shape used by
// CreateCheckoutOrder (the actively-used checkout endpoint).
type CustomerCheckoutInfo struct {
	Name        string `json:"name"`
	Email       string `json:"email"`
	Phone       string `json:"phone"`
	AddressLine string `json:"addressLine"`
	City        string `json:"city"`
	State       string `json:"state"`
	Pincode     string `json:"pincode"`
}

var (
	pincodeRegex = regexp.MustCompile(`^[1-9][0-9]{5}$`) // 6 digits, not starting with 0
	phoneRegex   = regexp.MustCompile(`^[6-9][0-9]{9}$`) // 10-digit Indian mobile
)

// Validate checks the shipping/contact fields required to place an order.
func (c *CustomerCheckoutInfo) Validate() (msg string, ok bool) {
	if !pincodeRegex.MatchString(c.Pincode) {
		return "invalid pincode format", false
	}
	if !phoneRegex.MatchString(c.Phone) {
		return "invalid phone number format", false
	}
	if !services.ValidateEmail(c.Email) {
		return "invalid email format", false
	}
	return "", true
}

// CreateCheckoutOrder creates a Razorpay order plus its local Order record.
// Item/product validation is shared with the legacy CreateRazorpayOrder via
// buildOrderItems (payments.go); this endpoint additionally validates the
// full shipping address. The frontend calls send/verify-email-otp first —
// this endpoint does not itself re-check that the OTP step happened.
func (h *Handler) CreateCheckoutOrder(w http.ResponseWriter, r *http.Request) {
	var req CreateCheckoutOrderRequest
	if !httpjson.Decode(w, r, &req) {
		return
	}
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
		PaymentStatus:   "created",
		Status:          "pending", // legacy field, kept in sync with PaymentStatus
		Amount:          req.Amount,
		Currency:        req.Currency,
		CustomerName:    req.Customer.Name,
		CustomerEmail:   req.Customer.Email,
		CustomerPhone:   req.Customer.Phone,
		AddressLine:     req.Customer.AddressLine,
		City:            req.Customer.City,
		State:           req.Customer.State,
		Pincode:         req.Customer.Pincode,
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

// CreateSoftAccount finds or creates a passworded account for a guest
// checkout, so a payment always ends up attached to a User. The random
// password is never surfaced — the customer sets a real one via "forgot
// password" if they want to log in directly.
func (h *Handler) CreateSoftAccount(email, phone, name string) (*models.User, error) {
	var existingUser models.User
	err := h.DB.Where("email = ? OR phone = ?", email, phone).First(&existingUser).Error
	if err == nil {
		return &existingUser, nil
	}
	if err != gorm.ErrRecordNotFound {
		return nil, err
	}

	randomPW := make([]byte, 16)
	if _, err := rand.Read(randomPW); err != nil {
		return nil, err
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(hex.EncodeToString(randomPW)), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	pw := string(passwordHash)
	user := models.User{
		Name:          name,
		Email:         models.StrPtr(email),
		Phone:         models.StrPtr(phone),
		PasswordHash:  &pw,
		EmailVerified: true,
		Provider:      "local",
		Role:          "user",
	}
	if err := h.DB.Create(&user).Error; err != nil {
		return nil, err
	}
	h.notifyMerchantNewUser(user, "checkout-soft-account", "", "")

	go func() {
		const resetLink = "https://yourdomain.com/reset-password" // TODO: point at the real reset page
		if err := h.emailService().SendAccountCreatedEmail(email, name, resetLink); err != nil {
			log.Printf("[EMAIL] account created: %v", err)
		}
	}()

	return &user, nil
}
