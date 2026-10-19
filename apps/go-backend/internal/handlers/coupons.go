package handlers

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Coupons
//
// A coupon is only ever *evaluated* server-side. The client sends a code;
// the server returns the discount it is willing to honour, and the same
// evaluation runs again at order creation. The client's claimed discount
// is never an input, which keeps the order total the server's own
// arithmetic — the same property the fulfillment quote already has.

// couponDiscount is the outcome of evaluating a code against a cart.
type couponDiscount struct {
	Coupon       *models.Coupon `json:"-"`
	Code         string         `json:"code"`
	Type         string         `json:"type"`
	Amount       float64        `json:"amount"`       // rupees off the goods subtotal
	FreeShipping bool           `json:"freeShipping"` // waives the delivery fee
	Description  string         `json:"description,omitempty"`
}

// errCouponRejected marks a user-visible refusal, so handlers can answer
// 422 with the reason rather than a generic failure.
type errCouponRejected struct{ Reason string }

func (e errCouponRejected) Error() string { return e.Reason }

// evaluateCoupon validates a code against a cart and returns the discount
// it earns. identity is the user ID when signed in, email otherwise —
// per-user limits have to work for guests too.
func (h *Handler) evaluateCoupon(ctx context.Context, code string, subtotal float64, items []models.OrderItem, userID *uint, email string) (*couponDiscount, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	if code == "" {
		return nil, errCouponRejected{"Enter a coupon code."}
	}

	var coupon models.Coupon
	if err := h.DB.WithContext(ctx).Where("code = ?", code).First(&coupon).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errCouponRejected{"That code isn't valid."}
		}
		return nil, err
	}

	now := time.Now()
	switch {
	case !coupon.Active:
		return nil, errCouponRejected{"That code is no longer active."}
	case coupon.StartsAt != nil && now.Before(*coupon.StartsAt):
		return nil, errCouponRejected{"That code isn't active yet."}
	case coupon.ExpiresAt != nil && now.After(*coupon.ExpiresAt):
		return nil, errCouponRejected{"That code has expired."}
	case coupon.UsageLimit > 0 && coupon.UsageCount >= coupon.UsageLimit:
		return nil, errCouponRejected{"That code has been fully redeemed."}
	}

	// Scope the eligible amount before testing the minimum, so a
	// category-scoped coupon is judged on the part of the cart it applies to.
	eligible := subtotal
	if len(coupon.CategoryIDs) > 0 || len(coupon.ProductIDs) > 0 {
		var err error
		eligible, err = h.eligibleSubtotal(ctx, coupon, items)
		if err != nil {
			return nil, err
		}
		if eligible <= 0 {
			return nil, errCouponRejected{"That code doesn't apply to anything in your cart."}
		}
	}

	if coupon.MinSubtotal > 0 && eligible < coupon.MinSubtotal {
		return nil, errCouponRejected{fmt.Sprintf("Add %s more to use this code.", formatRupees(coupon.MinSubtotal-eligible))}
	}

	if err := h.checkCouponUsage(ctx, h.DB, coupon, userID, email); err != nil {
		return nil, err
	}

	out := &couponDiscount{
		Coupon:      &coupon,
		Code:        coupon.Code,
		Type:        coupon.Type,
		Description: coupon.Description,
	}
	switch coupon.Type {
	case "percentage":
		out.Amount = eligible * coupon.Value / 100
		if coupon.MaxDiscount > 0 && out.Amount > coupon.MaxDiscount {
			out.Amount = coupon.MaxDiscount
		}
	case "fixed":
		out.Amount = coupon.Value
	case "free_shipping":
		out.FreeShipping = true
	default:
		return nil, errCouponRejected{"That code isn't valid."}
	}

	// Never discount below zero, and never turn an order into a payout.
	if out.Amount > eligible {
		out.Amount = eligible
	}
	out.Amount = round2(out.Amount)
	return out, nil
}

// eligibleSubtotal sums only the lines a scoped coupon applies to.
func (h *Handler) eligibleSubtotal(ctx context.Context, coupon models.Coupon, items []models.OrderItem) (float64, error) {
	allowedProducts := map[uint]bool{}
	for _, raw := range coupon.ProductIDs {
		if id, err := strconv.ParseUint(raw, 10, 64); err == nil {
			allowedProducts[uint(id)] = true
		}
	}
	allowedCategories := map[uint]bool{}
	for _, raw := range coupon.CategoryIDs {
		if id, err := strconv.ParseUint(raw, 10, 64); err == nil {
			allowedCategories[uint(id)] = true
		}
	}

	categoryByProduct := map[uint]uint{}
	if len(allowedCategories) > 0 {
		productIDs := make([]uint, 0, len(items))
		for _, item := range items {
			productIDs = append(productIDs, item.ProductID)
		}
		var products []models.Product
		if err := h.DB.WithContext(ctx).Select("id, category_id").
			Where("id IN ?", productIDs).Find(&products).Error; err != nil {
			return 0, err
		}
		for _, p := range products {
			categoryByProduct[p.ID] = p.CategoryID
		}
	}

	var total float64
	for _, item := range items {
		if allowedProducts[item.ProductID] || allowedCategories[categoryByProduct[item.ProductID]] {
			total += item.Price * float64(item.Quantity)
		}
	}
	return total, nil
}

// checkCouponUsage enforces per-user limits and first-order-only codes.
//
// db is the scope to count against so the caller chooses: the preview uses
// the plain connection, while recordCouponRedemption passes its transaction
// to re-check behind a lock on the coupon row.
func (h *Handler) checkCouponUsage(ctx context.Context, db *gorm.DB, coupon models.Coupon, userID *uint, email string) error {
	if coupon.PerUserLimit > 0 {
		query := db.WithContext(ctx).Model(&models.CouponRedemption{}).Where("coupon_id = ?", coupon.ID)
		switch {
		case userID != nil:
			query = query.Where("user_id = ?", *userID)
		case email != "":
			query = query.Where("email = ?", strings.ToLower(email))
		default:
			// No identity to limit against; let it through rather than
			// blocking a legitimate guest.
			query = nil
		}
		if query != nil {
			var used int64
			if err := query.Count(&used).Error; err != nil {
				return err
			}
			if used >= int64(coupon.PerUserLimit) {
				return errCouponRejected{"You've already used this code."}
			}
		}
	}

	if coupon.FirstOrderOnly {
		query := db.WithContext(ctx).Model(&models.Order{}).Where("payment_status = ?", "paid")
		switch {
		case userID != nil:
			query = query.Where("user_id = ?", *userID)
		case email != "":
			query = query.Where("LOWER(customer_email) = ?", strings.ToLower(email))
		default:
			return nil
		}
		var orders int64
		if err := query.Count(&orders).Error; err != nil {
			return err
		}
		if orders > 0 {
			return errCouponRejected{"That code is for first orders only."}
		}
	}
	return nil
}

// recordCouponRedemption commits a coupon's use inside the order
// transaction. The usage counter is bumped conditionally so a global limit
// cannot be exceeded by two simultaneous checkouts.
func (h *Handler) recordCouponRedemption(ctx context.Context, tx *gorm.DB, discount *couponDiscount, order *models.Order) error {
	if discount == nil || discount.Coupon == nil {
		return nil
	}

	// Take the coupon row before counting anything, and re-read the limits
	// from it rather than trusting the copy the preview loaded.
	//
	// The per-user and first-order rules are counts, and counts are not
	// self-enforcing: two checkouts of the same code running concurrently
	// each see that the other has not redeemed yet, and both insert — one
	// code used twice by the same customer. Locking the coupon serialises
	// every redemption of that code, which is the one row they all share.
	// The conditional usage_count update below already contends on this
	// row, so the lock adds no contention that was not already there.
	var coupon models.Coupon
	if err := tx.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ?", discount.Coupon.ID).
		First(&coupon).Error; err != nil {
		return err
	}

	// Re-run the identity checks behind the lock, against the transaction,
	// so they see redemptions committed since the preview ran.
	if err := h.checkCouponUsage(ctx, tx, coupon, order.UserID, order.CustomerEmail); err != nil {
		return err
	}

	if coupon.UsageLimit > 0 {
		res := tx.Model(&models.Coupon{}).
			Where("id = ? AND usage_count < ?", coupon.ID, coupon.UsageLimit).
			UpdateColumn("usage_count", gorm.Expr("usage_count + 1"))
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return errCouponRejected{"That code has just been fully redeemed."}
		}
	} else if err := tx.Model(&models.Coupon{}).Where("id = ?", coupon.ID).
		UpdateColumn("usage_count", gorm.Expr("usage_count + 1")).Error; err != nil {
		return err
	}

	redemption := models.CouponRedemption{
		CouponID: coupon.ID,
		UserID:   order.UserID,
		Email:    strings.ToLower(order.CustomerEmail),
		OrderID:  order.ID,
		Amount:   discount.Amount,
	}
	return tx.Create(&redemption).Error
}

// ValidateCoupon previews a code against the customer's cart so the
// checkout page can show the discount before payment.
func (h *Handler) ValidateCoupon(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code  string             `json:"code"`
		Items []OrderItemRequest `json:"items"`
		Email string             `json:"email"`
	}
	if !httpjson.Decode(w, r, &req) {
		return
	}

	items, ok := h.buildOrderItems(w, req.Items)
	if !ok {
		return
	}
	var subtotal float64
	for _, item := range items {
		subtotal += item.Price * float64(item.Quantity)
	}

	var userID *uint
	if claims, ok := appauth.FromContext(r.Context()); ok {
		userID = &claims.UserID
	}

	discount, err := h.evaluateCoupon(r.Context(), req.Code, subtotal, items, userID, req.Email)
	if err != nil {
		var rejected errCouponRejected
		if ok := asCouponRejection(err, &rejected); ok {
			httpjson.JSON(w, http.StatusUnprocessableEntity, map[string]any{
				"error":  "coupon_rejected",
				"reason": rejected.Reason,
			})
			return
		}
		log.Printf("[COUPON] validate: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to validate coupon")
		return
	}

	httpjson.JSON(w, http.StatusOK, map[string]any{
		"valid":    true,
		"discount": discount,
		"subtotal": round2(subtotal),
		"newTotal": round2(subtotal - discount.Amount),
	})
}

func asCouponRejection(err error, target *errCouponRejected) bool {
	if rejected, ok := err.(errCouponRejected); ok {
		*target = rejected
		return true
	}
	return false
}

// formatRupees renders an amount for customer-facing copy.
func formatRupees(v float64) string {
	return fmt.Sprintf("₹%.0f", v)
}

// --- Admin CRUD ---

// ListCoupons returns all coupons with their redemption counts.
func (h *Handler) ListCoupons(w http.ResponseWriter, r *http.Request) {
	var coupons []models.Coupon
	if err := h.DB.WithContext(r.Context()).Order("created_at DESC").Find(&coupons).Error; err != nil {
		log.Printf("[COUPON] list: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to load coupons")
		return
	}
	httpjson.JSON(w, http.StatusOK, map[string]any{"coupons": coupons, "count": len(coupons)})
}

// CreateCoupon adds a discount code.
func (h *Handler) CreateCoupon(w http.ResponseWriter, r *http.Request) {
	var coupon models.Coupon
	if !httpjson.Decode(w, r, &coupon) {
		return
	}
	if msg, ok := validateCoupon(&coupon); !ok {
		httpjson.Error(w, http.StatusBadRequest, msg)
		return
	}

	if err := h.DB.WithContext(r.Context()).Create(&coupon).Error; err != nil {
		if isUniqueViolation(err) {
			httpjson.Error(w, http.StatusConflict, "a coupon with that code already exists")
			return
		}
		log.Printf("[COUPON] create: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to create coupon")
		return
	}
	httpjson.JSON(w, http.StatusCreated, coupon)
}

// UpdateCoupon edits a discount code. Usage counts are not editable.
func (h *Handler) UpdateCoupon(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseUint(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid coupon ID")
		return
	}

	var existing models.Coupon
	if err := h.DB.WithContext(r.Context()).First(&existing, id).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "coupon not found")
		return
	}

	var req models.Coupon
	if !httpjson.Decode(w, r, &req) {
		return
	}
	req.ID = existing.ID
	req.UsageCount = existing.UsageCount
	if msg, ok := validateCoupon(&req); !ok {
		httpjson.Error(w, http.StatusBadRequest, msg)
		return
	}

	if err := h.DB.WithContext(r.Context()).Model(&existing).Select(
		"code", "description", "type", "value", "max_discount", "min_subtotal",
		"usage_limit", "per_user_limit", "category_ids", "product_ids",
		"first_order_only", "starts_at", "expires_at", "active",
	).Updates(req).Error; err != nil {
		log.Printf("[COUPON] update: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to update coupon")
		return
	}
	httpjson.JSON(w, http.StatusOK, req)
}

// DeleteCoupon soft-deletes a code. Redemption history is preserved so
// past orders stay explicable.
func (h *Handler) DeleteCoupon(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseUint(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid coupon ID")
		return
	}
	if err := h.DB.WithContext(r.Context()).Delete(&models.Coupon{}, id).Error; err != nil {
		log.Printf("[COUPON] delete: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to delete coupon")
		return
	}
	httpjson.JSON(w, http.StatusOK, map[string]any{"success": true})
}

func validateCoupon(coupon *models.Coupon) (string, bool) {
	coupon.Code = strings.ToUpper(strings.TrimSpace(coupon.Code))
	if coupon.Code == "" {
		return "code is required", false
	}
	if len(coupon.Code) > 32 {
		return "code must be 32 characters or fewer", false
	}
	switch coupon.Type {
	case "percentage":
		if coupon.Value <= 0 || coupon.Value > 100 {
			return "percentage value must be between 1 and 100", false
		}
	case "fixed":
		if coupon.Value <= 0 {
			return "fixed discount must be greater than 0", false
		}
	case "free_shipping":
		coupon.Value = 0
	default:
		return "type must be percentage, fixed or free_shipping", false
	}
	if coupon.StartsAt != nil && coupon.ExpiresAt != nil && coupon.ExpiresAt.Before(*coupon.StartsAt) {
		return "expiry must be after the start date", false
	}
	return "", true
}
