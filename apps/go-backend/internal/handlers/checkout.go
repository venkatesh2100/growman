package handlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/fulfillment"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/metrics"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/middlewares"
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

	// Issue a short-lived, single-use proof that this address was verified.
	// CreateCheckoutOrder requires it, so the OTP gate cannot be bypassed
	// by calling the order endpoint directly.
	proof, err := otpService.IssueVerificationProof(r.Context(), req.Email)
	if err != nil {
		log.Printf("[OTP] issue proof: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to complete verification")
		return
	}

	httpjson.JSON(w, http.StatusOK, map[string]any{
		"success":           true,
		"message":           "OTP verified successfully",
		"verificationToken": proof,
		"expiresIn":         int(services.VerificationProofTTL.Seconds()),
	})
}

// CreateCheckoutOrderRequest is the payload for the OTP-gated checkout flow.
type CreateCheckoutOrderRequest struct {
	Amount   float64              `json:"amount"`
	Currency string               `json:"currency"`
	Items    []OrderItemRequest   `json:"items"`
	Customer CustomerCheckoutInfo `json:"customer"`
	// FulfillmentChannel is the option the customer picked from
	// /checkout/quote. Required: the server re-runs the quote and refuses
	// the order unless that channel is available and Amount matches the
	// authoritative subtotal plus delivery fee. It used to be optional,
	// which made the repricing skippable by simply omitting it.
	FulfillmentChannel string   `json:"fulfillmentChannel"`
	Latitude           *float64 `json:"latitude"`
	Longitude          *float64 `json:"longitude"`
	// VerificationToken is the proof issued by /checkout/verify-email-otp.
	// Required for guests; signed-in customers are already verified by
	// their JWT.
	VerificationToken string `json:"verificationToken"`
	// CouponCode is re-evaluated server-side; any discount the client
	// claims is ignored.
	CouponCode string `json:"couponCode"`
	GiftWrap   bool   `json:"giftWrap"`
	GiftNote   string `json:"giftNote"`
	HidePrice  bool   `json:"hidePrice"`
	// DeliverySlot is morning or evening. PreferredDeliveryDate is YYYY-MM-DD.
	DeliverySlot          string `json:"deliverySlot"`
	PreferredDeliveryDate string `json:"preferredDeliveryDate"`
	UseCredit             bool   `json:"useCredit"`
}

// payableChannels are the fulfillment channels a customer can actually pay
// for at checkout. A bulk quote is sales-assisted: it has no price yet, so
// it cannot become a Razorpay order here.
var payableChannels = map[fulfillment.Channel]bool{
	fulfillment.ChannelStorePickup: true,
	fulfillment.ChannelCourier:     true,
	fulfillment.ChannelOwnVehicle:  true,
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
// This is the only way to start a payment: it prices the cart from the
// database, requires a delivery channel so the repricing cannot be skipped,
// and for guests consumes the single-use proof token that verify-email-otp
// issues. Items are resolved by buildOrderItems (payments.go).
//
// The order, its stock reservation and any coupon redemption commit in one
// transaction, so there is no state in which an order exists without the
// units it is holding.
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

	// The email must be provably verified. A signed-in customer already is,
	// by virtue of their token; a guest has to present the proof issued by
	// /checkout/verify-email-otp. Without this the OTP step is advisory
	// and the endpoint will write arbitrary orders for any address.
	claims, signedIn := appauth.FromContext(r.Context())
	if !signedIn {
		otpService := services.NewOTPService(h.Redis)
		ok, err := otpService.ConsumeVerificationProof(r.Context(), req.Customer.Email, req.VerificationToken)
		if err != nil {
			log.Printf("[OTP] consume proof: %v", err)
			httpjson.Error(w, http.StatusInternalServerError, "failed to verify your email")
			return
		}
		if !ok {
			httpjson.JSON(w, http.StatusForbidden, map[string]any{
				"error":  "email_not_verified",
				"reason": "Please verify your email address before placing the order.",
			})
			return
		}
	}

	items, ok := h.buildOrderItems(w, req.Items)
	if !ok {
		return
	}

	// Availability is checked before taking payment so the common case
	// fails with a clear message instead of a reservation conflict.
	if !h.checkStockAvailability(w, r, req.Items) {
		return
	}

	delivery, ok := h.resolveOrderFulfillment(w, r, &req)
	if !ok {
		return
	}

	// Coupons are evaluated here, against server-side prices, and reduce
	// the amount actually charged.
	discount, ok := h.applyCheckoutCoupon(w, r, &req, items, delivery, claims, signedIn)
	if !ok {
		return
	}

	slot := strings.ToLower(strings.TrimSpace(req.DeliverySlot))
	if slot != "" && slot != "morning" && slot != "evening" {
		httpjson.Error(w, http.StatusBadRequest, "Delivery slot must be morning or evening.")
		return
	}
	var preferred *time.Time
	if rawDate := strings.TrimSpace(req.PreferredDeliveryDate); rawDate != "" {
		parsed, err := time.Parse("2006-01-02", rawDate)
		if err != nil {
			httpjson.Error(w, http.StatusBadRequest, "preferredDeliveryDate must be YYYY-MM-DD")
			return
		}
		today := time.Now().Truncate(24 * time.Hour)
		if parsed.Before(today) || parsed.After(today.AddDate(0, 0, 21)) {
			httpjson.Error(w, http.StatusBadRequest, "Choose a delivery date within the next 3 weeks.")
			return
		}
		preferred = &parsed
	}

	creditApplied := 0.0
	if signedIn && req.UseCredit {
		available := h.availableCredit(r.Context(), claims.UserID)
		if available > 0 {
			creditApplied = available
			if creditApplied > req.Amount-1 {
				creditApplied = req.Amount - 1
			}
			creditApplied = round2(creditApplied)
			if creditApplied > 0 {
				req.Amount = round2(req.Amount - creditApplied)
			}
		}
	}

	razorpayOrder, err := h.createRazorpayOrder(int(req.Amount*100+0.5), req.Currency)
	if err != nil {
		log.Printf("[RAZORPAY] create order: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to create Razorpay order")
		return
	}

	publicToken, err := newOrderToken()
	if err != nil {
		log.Printf("[CHECKOUT] mint order token: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to save order")
		return
	}

	order := models.Order{
		RazorpayOrderID: razorpayOrder.ID,
		PublicToken:     publicToken,
		PaymentStatus:   "created",
		Status:          "pending", // legacy field, kept in sync with PaymentStatus
		Amount:          req.Amount,
		Currency:        req.Currency,
		CustomerName:    req.Customer.Name,
		CustomerEmail:   req.Customer.Email,
		CustomerPhone:   req.Customer.Phone,
		ClientIP:        firstNonEmpty(middlewares.ExactIP(r), middlewares.ClientIP(r)),
		UserAgent:       clipText(r.UserAgent(), 512),
		AddressLine:     req.Customer.AddressLine,
		City:            req.Customer.City,
		State:           req.Customer.State,
		Pincode:         req.Customer.Pincode,
		Items:           items,

		FulfillmentChannel:    delivery.Channel,
		FulfillmentZone:       delivery.Zone,
		Subtotal:              delivery.Subtotal,
		DeliveryFee:           delivery.Fee,
		DeliveryFeeWaived:     delivery.FeeWaived,
		DistanceKm:            delivery.DistanceKm,
		DistanceSource:        delivery.DistanceSource,
		Latitude:              req.Latitude,
		Longitude:             req.Longitude,
		CourierProvider:       delivery.CourierProvider,
		CourierService:        delivery.CourierService,
		CourierCost:           delivery.CourierCost,
		GiftWrap:              req.GiftWrap,
		GiftNote:              clipText(req.GiftNote, 300),
		HidePrice:             req.HidePrice,
		GiftFee:               delivery.GiftFee,
		DeliverySlot:          slot,
		PreferredDeliveryDate: preferred,
		CreditApplied:         creditApplied,
	}
	if signedIn {
		order.UserID = &claims.UserID
	}
	if discount != nil {
		order.CouponID = &discount.Coupon.ID
		order.CouponCode = discount.Code
		order.DiscountTotal = discount.Amount
	}

	// Order row, stock reservation and coupon redemption commit together:
	// an order that exists without its reservation would oversell, and a
	// reservation without an order would leak stock.
	if err := h.DB.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&order).Error; err != nil {
			return err
		}
		if creditApplied > 0 && order.UserID != nil {
			if err := h.spendCredit(tx, *order.UserID, creditApplied, order.ID); err != nil {
				return err
			}
		}
		if err := h.reserveOrderInventory(tx, order.Items); err != nil {
			return err
		}
		return h.recordCouponRedemption(r.Context(), tx, discount, &order)
	}); err != nil {
		if errors.Is(err, errCreditChanged) {
			httpjson.JSON(w, http.StatusConflict, map[string]any{
				"error":  "credit_changed",
				"reason": "Your store credit changed. Please review the total and try again.",
			})
			return
		}
		var soldOut errOutOfStock
		if errors.As(err, &soldOut) {
			metrics.RecordInventoryConflict()
			httpjson.JSON(w, http.StatusConflict, map[string]any{
				"error":  "out_of_stock",
				"reason": soldOut.Error(),
			})
			return
		}
		var rejected errCouponRejected
		if asCouponRejection(err, &rejected) {
			httpjson.JSON(w, http.StatusUnprocessableEntity, map[string]any{
				"error":  "coupon_rejected",
				"reason": rejected.Reason,
			})
			return
		}
		log.Printf("[DB] create order: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to save order")
		return
	}

	response := map[string]any{
		"id":                 razorpayOrder.ID,
		"amount":             razorpayOrder.Amount,
		"currency":           razorpayOrder.Currency,
		"status":             razorpayOrder.Status,
		"orderId":            order.ID,
		"publicToken":        order.PublicToken,
		"subtotal":           order.Subtotal,
		"deliveryFee":        order.DeliveryFee,
		"fulfillmentChannel": order.FulfillmentChannel,
	}
	if discount != nil {
		response["discount"] = order.DiscountTotal
		response["couponCode"] = order.CouponCode
	}
	if creditApplied > 0 {
		response["creditApplied"] = creditApplied
	}
	h.notifyOrderEvent(r.Context(), order, "Order placed", "We have your order and will update you as it moves.", "placed")
	httpjson.JSON(w, http.StatusOK, response)
}

// applyCheckoutCoupon evaluates any coupon code on the request and reduces
// req.Amount by the discount it earns. Returns ok=false once an error
// response has been written.
//
// The order of operations matters: resolveOrderFulfillment has already
// pinned req.Amount to the server's subtotal + fee, so subtracting here
// keeps the charged amount entirely server-derived.
func (h *Handler) applyCheckoutCoupon(
	w http.ResponseWriter, r *http.Request,
	req *CreateCheckoutOrderRequest, items []models.OrderItem,
	delivery orderFulfillment, claims *appauth.Claims, signedIn bool,
) (*couponDiscount, bool) {
	if strings.TrimSpace(req.CouponCode) == "" {
		return nil, true
	}

	var userID *uint
	if signedIn {
		userID = &claims.UserID
	}

	discount, err := h.evaluateCoupon(r.Context(), req.CouponCode, delivery.Subtotal, items, userID, req.Customer.Email)
	if err != nil {
		var rejected errCouponRejected
		if asCouponRejection(err, &rejected) {
			httpjson.JSON(w, http.StatusUnprocessableEntity, map[string]any{
				"error":  "coupon_rejected",
				"reason": rejected.Reason,
			})
			return nil, false
		}
		log.Printf("[COUPON] evaluate at checkout: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to apply coupon")
		return nil, false
	}

	if discount.FreeShipping {
		req.Amount -= delivery.Fee
		discount.Amount = delivery.Fee
	} else {
		req.Amount -= discount.Amount
	}
	if req.Amount < 1 {
		// Razorpay rejects orders below ₹1, and a free order should go
		// through a different flow than a payment.
		httpjson.JSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error":  "coupon_rejected",
			"reason": "This code would bring the order below the ₹1 minimum. Please contact us to arrange it.",
		})
		return nil, false
	}
	req.Amount = round2(req.Amount)
	return discount, true
}

// CreateSoftAccount finds or creates a passworded account for a guest
// checkout, so a payment always ends up attached to a User. The random
// password is never surfaced — the customer sets a real one via "forgot
// password" if they want to log in directly.
func (h *Handler) CreateSoftAccount(email, phone, name, ip, userAgent string) (*models.User, error) {
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
	h.notifyMerchantNewUser(user, "checkout-soft-account", services.NetHint{IP: ip, UserAgent: userAgent})

	go func() {
		const resetLink = "https://yourdomain.com/reset-password" // TODO: point at the real reset page
		if err := h.emailService().SendAccountCreatedEmail(email, name, resetLink); err != nil {
			log.Printf("[EMAIL] account created: %v", err)
		}
	}()

	return &user, nil
}
