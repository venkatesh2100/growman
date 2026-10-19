package handlers

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/care"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"gorm.io/gorm"
)

const giftWrapFee = 49.0

func (h *Handler) reminderHour(ctx context.Context, userID uint) int {
	hour := h.prefsFor(ctx, userID).ReminderHour
	if hour <= 0 || hour > 23 {
		return 8
	}
	return hour
}

func (h *Handler) GetReferral(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	code := h.ensureReferralCode(r.Context(), claims.UserID)
	var credit models.StoreCredit
	_ = h.DB.WithContext(r.Context()).Where("user_id = ?", claims.UserID).First(&credit).Error
	httpjson.JSON(w, http.StatusOK, map[string]any{
		"code":    code,
		"balance": credit.Balance,
		"reward":  "You and a friend each receive credit after their first paid order. Yours is ₹100, theirs is ₹50.",
	})
}

func (h *Handler) ClaimReferral(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if !httpjson.Decode(w, r, &req) {
		return
	}
	code := strings.ToUpper(strings.TrimSpace(req.Code))
	var owner models.User
	if err := h.DB.WithContext(r.Context()).Where("referral_code = ?", code).First(&owner).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "That invite code was not found.")
		return
	}
	if owner.ID == claims.UserID {
		httpjson.Error(w, http.StatusBadRequest, "You cannot use your own invite code.")
		return
	}
	res := h.DB.WithContext(r.Context()).Model(&models.User{}).
		Where("id = ? AND referred_by IS NULL", claims.UserID).
		Update("referred_by", owner.ID)
	if res.Error != nil {
		httpjson.Error(w, http.StatusInternalServerError, "Could not save the invite code.")
		return
	}
	if res.RowsAffected == 0 {
		httpjson.Error(w, http.StatusConflict, "An invite code is already saved on this account.")
		return
	}
	httpjson.JSON(w, http.StatusOK, map[string]any{"success": true})
}

func (h *Handler) ensureReferralCode(ctx context.Context, userID uint) string {
	var user models.User
	if err := h.DB.WithContext(ctx).Select("id", "referral_code").First(&user, userID).Error; err != nil {
		return ""
	}
	if user.ReferralCode != "" {
		return user.ReferralCode
	}
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		return ""
	}
	code := make([]byte, 6)
	for i := range code {
		code[i] = alphabet[int(buf[i])%len(alphabet)]
	}
	if err := h.DB.WithContext(ctx).Model(&models.User{}).Where("id = ? AND referral_code = ''", userID).
		Update("referral_code", string(code)).Error; err != nil {
		return ""
	}
	return string(code)
}

func (h *Handler) addCredit(ctx context.Context, userID uint, amount float64, reason string, orderID *uint) {
	if userID == 0 || amount == 0 {
		return
	}
	err := h.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var acct models.StoreCredit
		err := tx.Where("user_id = ?", userID).First(&acct).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			acct = models.StoreCredit{UserID: userID, Balance: amount}
			if err := tx.Create(&acct).Error; err != nil {
				return err
			}
		} else if err != nil {
			return err
		} else if err := tx.Model(&acct).Update("balance", gorm.Expr("balance + ?", amount)).Error; err != nil {
			return err
		}
		return tx.Create(&models.CreditEntry{UserID: userID, Amount: amount, Reason: reason, OrderID: orderID}).Error
	})
	if err != nil {
		log.Printf("[CREDIT] add: %v", err)
	}
}

func (h *Handler) spendCredit(tx *gorm.DB, userID uint, amount float64, orderID uint) error {
	res := tx.Model(&models.StoreCredit{}).
		Where("user_id = ? AND balance >= ?", userID, amount).
		Update("balance", gorm.Expr("balance - ?", amount))
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return errCreditChanged
	}
	return tx.Create(&models.CreditEntry{UserID: userID, Amount: -amount, Reason: "order", OrderID: &orderID}).Error
}

var errCreditChanged = errors.New("store credit changed")

func (h *Handler) availableCredit(ctx context.Context, userID uint) float64 {
	var acct models.StoreCredit
	if err := h.DB.WithContext(ctx).Where("user_id = ?", userID).First(&acct).Error; err != nil {
		return 0
	}
	if acct.Balance < 0 {
		return 0
	}
	return acct.Balance
}

func (h *Handler) grantFirstOrderReferral(order models.Order) {
	if order.UserID == nil {
		return
	}
	ctx := context.Background()
	var user models.User
	if err := h.DB.First(&user, *order.UserID).Error; err != nil || user.ReferredBy == nil {
		return
	}
	var n int64
	h.DB.Model(&models.Order{}).Where("user_id = ? AND payment_status = ?", user.ID, "paid").Count(&n)
	if n != 1 {
		return
	}
	var already int64
	h.DB.Model(&models.CreditEntry{}).Where("user_id = ? AND reason = ? AND order_id = ?", user.ID, "referral_welcome", order.ID).Count(&already)
	if already > 0 {
		return
	}
	id := order.ID
	h.addCredit(ctx, *user.ReferredBy, 100, "referral", &id)
	h.addCredit(ctx, user.ID, 50, "referral_welcome", &id)
	h.pushNotice(ctx, user.ReferredBy, "offer", "Invite reward", "A friend placed their first order. ₹100 credit is on your account.", "/account", "referral:"+strconv.FormatUint(uint64(order.ID), 10), &id, nil, nil)
}

func (h *Handler) ListSavedItems(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	var items []models.SavedItem
	if err := h.DB.WithContext(r.Context()).Preload("Product").Preload("Product.Sizes").
		Where("user_id = ?", claims.UserID).Order("created_at DESC").Find(&items).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to load saved plants")
		return
	}
	for i := range items {
		h.ResolveProductImageURLs(&items[i].Product)
	}
	httpjson.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) SaveForLater(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	var req struct {
		ProductID     uint   `json:"productId"`
		ProductSizeID *uint  `json:"productSizeId"`
		Pot           string `json:"pot"`
		Quantity      int    `json:"quantity"`
	}
	if !httpjson.Decode(w, r, &req) || req.ProductID == 0 {
		httpjson.Error(w, http.StatusBadRequest, "Choose a plant to save.")
		return
	}
	if req.Quantity <= 0 {
		req.Quantity = 1
	}
	item := models.SavedItem{
		UserID: claims.UserID, ProductID: req.ProductID, ProductSizeID: req.ProductSizeID,
		Pot: clipText(req.Pot, 80), Quantity: req.Quantity,
	}
	err := h.DB.WithContext(r.Context()).Create(&item).Error
	if isDuplicateKey(err) {
		h.DB.WithContext(r.Context()).Model(&models.SavedItem{}).
			Where("user_id = ? AND product_id = ?", claims.UserID, req.ProductID).
			Updates(map[string]any{"product_size_id": req.ProductSizeID, "pot": item.Pot, "quantity": req.Quantity, "deleted_at": nil})
	} else if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "Could not save this plant.")
		return
	}
	httpjson.JSON(w, http.StatusOK, map[string]any{"success": true})
}

func (h *Handler) RemoveSavedItem(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	id, _ := strconv.ParseUint(chi.URLParam(r, "id"), 10, 64)
	h.DB.WithContext(r.Context()).Where("id = ? AND user_id = ?", id, claims.UserID).Delete(&models.SavedItem{})
	httpjson.JSON(w, http.StatusOK, map[string]any{"success": true})
}

func (h *Handler) ListPaymentMethods(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	var rows []models.SavedPaymentMethod
	h.DB.WithContext(r.Context()).Where("user_id = ?", claims.UserID).Order("is_default DESC, created_at DESC").Find(&rows)
	httpjson.JSON(w, http.StatusOK, map[string]any{"methods": rows})
}

func (h *Handler) SavePaymentMethod(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	var req struct {
		Kind      string `json:"kind"`
		Label     string `json:"label"`
		Detail    string `json:"detail"`
		IsDefault bool   `json:"isDefault"`
	}
	if !httpjson.Decode(w, r, &req) {
		return
	}
	kind := strings.ToLower(strings.TrimSpace(req.Kind))
	detail := strings.TrimSpace(req.Detail)
	if kind == "card" {
		digits := strings.Map(func(r rune) rune {
			if r >= '0' && r <= '9' {
				return r
			}
			return -1
		}, detail)
		if len(digits) < 4 {
			httpjson.Error(w, http.StatusBadRequest, "Enter the last 4 digits of the card.")
			return
		}
		detail = digits[len(digits)-4:]
	} else if kind == "upi" {
		if !strings.Contains(detail, "@") || len(detail) > 80 {
			httpjson.Error(w, http.StatusBadRequest, "Enter a UPI ID such as name@upi.")
			return
		}
	} else {
		httpjson.Error(w, http.StatusBadRequest, "Choose UPI or card.")
		return
	}
	if req.IsDefault {
		h.DB.WithContext(r.Context()).Model(&models.SavedPaymentMethod{}).Where("user_id = ?", claims.UserID).Update("is_default", false)
	}
	row := models.SavedPaymentMethod{
		UserID: claims.UserID, Kind: kind, Label: clipText(req.Label, 40), Detail: detail, IsDefault: req.IsDefault,
	}
	if row.Label == "" {
		row.Label = strings.ToUpper(kind)
	}
	if err := h.DB.WithContext(r.Context()).Create(&row).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "Could not save this payment method.")
		return
	}
	httpjson.JSON(w, http.StatusCreated, row)
}

func (h *Handler) DeletePaymentMethod(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	id, _ := strconv.ParseUint(chi.URLParam(r, "id"), 10, 64)
	h.DB.WithContext(r.Context()).Where("id = ? AND user_id = ?", id, claims.UserID).Delete(&models.SavedPaymentMethod{})
	httpjson.JSON(w, http.StatusOK, map[string]any{"success": true})
}

func (h *Handler) RecordRecentView(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	var req struct {
		ProductID uint `json:"productId"`
	}
	if !httpjson.Decode(w, r, &req) || req.ProductID == 0 {
		httpjson.Error(w, http.StatusBadRequest, "productId is required")
		return
	}
	now := time.Now()
	var existing models.RecentView
	err := h.DB.WithContext(r.Context()).Where("user_id = ? AND product_id = ?", claims.UserID, req.ProductID).First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		_ = h.DB.WithContext(r.Context()).Create(&models.RecentView{UserID: claims.UserID, ProductID: req.ProductID, ViewedAt: now}).Error
	} else if err == nil {
		_ = h.DB.WithContext(r.Context()).Model(&existing).Update("viewed_at", now).Error
	}
	h.notifyNewArrivals(r.Context(), claims.UserID, req.ProductID)
	httpjson.JSON(w, http.StatusOK, map[string]any{"success": true})
}

func (h *Handler) ListRecentViews(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	var rows []models.RecentView
	h.DB.WithContext(r.Context()).Preload("Product").Where("user_id = ?", claims.UserID).
		Order("viewed_at DESC").Limit(12).Find(&rows)
	products := make([]models.Product, 0, len(rows))
	for _, row := range rows {
		if row.Product.ID != 0 {
			products = append(products, row.Product)
		}
	}
	h.ResolveProductImageURLsSlice(products)
	httpjson.JSON(w, http.StatusOK, map[string]any{"products": products})
}

func (h *Handler) notifyNewArrivals(ctx context.Context, userID, productID uint) {
	var product models.Product
	if err := h.DB.WithContext(ctx).Select("id", "category_id").First(&product, productID).Error; err != nil {
		return
	}
	var fresh []models.Product
	h.DB.WithContext(ctx).Select("id", "name", "slug").
		Where("category_id = ? AND id <> ? AND created_at > ?", product.CategoryID, productID, time.Now().AddDate(0, 0, -14)).
		Order("created_at DESC").Limit(3).Find(&fresh)
	uid := userID
	for _, item := range fresh {
		pid := item.ID
		h.pushNotice(ctx, &uid, "offer", "New in a category you browse", item.Name+" just arrived.", "/product/"+item.Slug,
			"arrival:"+strconv.FormatUint(uint64(item.ID), 10), nil, &pid, nil)
	}
}

type cartLine struct {
	ProductID uint   `json:"productId"`
	Name      string `json:"name"`
	Quantity  int    `json:"quantity"`
}

func (h *Handler) SyncCartSignals(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	var req struct {
		Items    []cartLine `json:"items"`
		Subtotal float64    `json:"subtotal"`
	}
	if !httpjson.Decode(w, r, &req) {
		return
	}
	raw, _ := json.Marshal(req.Items)
	var snap models.CartSnapshot
	err := h.DB.WithContext(r.Context()).Where("user_id = ?", claims.UserID).First(&snap).Error
	abandoned := err == nil && snap.ItemCount > 0 && time.Since(snap.UpdatedAt) > 2*time.Hour &&
		(snap.NotifiedAt == nil || snap.NotifiedAt.Before(snap.UpdatedAt))
	if abandoned {
		uid := claims.UserID
		h.pushNotice(r.Context(), &uid, "offer", "Your cart is still waiting",
			"The plants in your cart have not been checked out.", "/cart",
			"cart:"+snap.UpdatedAt.Format("2006-01-02"), nil, nil, nil)
		now := time.Now()
		snap.NotifiedAt = &now
	}
	snap.UserID = claims.UserID
	snap.ItemsJSON = string(raw)
	snap.ItemCount = len(req.Items)
	if err != nil {
		_ = h.DB.WithContext(r.Context()).Create(&snap).Error
	} else {
		_ = h.DB.WithContext(r.Context()).Save(&snap).Error
	}
	h.notifyLowStock(r.Context(), claims.UserID, req.Items)
	h.notifyExpiringCoupons(r.Context(), claims.UserID, req.Subtotal)
	httpjson.JSON(w, http.StatusOK, map[string]any{"success": true})
}

func (h *Handler) notifyLowStock(ctx context.Context, userID uint, items []cartLine) {
	uid := userID
	for _, item := range items {
		var product models.Product
		if err := h.DB.WithContext(ctx).Select("id", "name", "stock", "low_stock_threshold", "track_inventory").First(&product, item.ProductID).Error; err != nil {
			continue
		}
		threshold := product.LowStockThreshold
		if threshold <= 0 {
			threshold = 5
		}
		if product.TrackInventory && product.Stock > 0 && product.Stock <= threshold {
			pid := product.ID
			h.pushNotice(ctx, &uid, "offer", "Low stock in your cart",
				fmt.Sprintf("%s has only %d left.", product.Name, product.Stock), "/cart",
				"low:"+strconv.FormatUint(uint64(product.ID), 10)+":"+time.Now().Format("2006-01-02"), nil, &pid, nil)
		}
	}
}

func (h *Handler) ListOffers(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	subtotal, _ := strconv.ParseFloat(r.URL.Query().Get("subtotal"), 64)
	offers := h.qualifyingOffers(r.Context(), subtotal)
	h.notifyExpiringCoupons(r.Context(), claims.UserID, subtotal)
	httpjson.JSON(w, http.StatusOK, map[string]any{"offers": offers})
}

type offerView struct {
	Code        string     `json:"code"`
	Description string     `json:"description"`
	Type        string     `json:"type"`
	Qualified   bool       `json:"qualified"`
	ExpiresAt   *time.Time `json:"expiresAt,omitempty"`
	MinSubtotal float64    `json:"minSubtotal"`
}

func (h *Handler) qualifyingOffers(ctx context.Context, subtotal float64) []offerView {
	var coupons []models.Coupon
	now := time.Now()
	h.DB.WithContext(ctx).Where("active = ?", true).Find(&coupons)
	out := make([]offerView, 0, len(coupons))
	for _, coupon := range coupons {
		if coupon.StartsAt != nil && now.Before(*coupon.StartsAt) {
			continue
		}
		if coupon.ExpiresAt != nil && now.After(*coupon.ExpiresAt) {
			continue
		}
		if coupon.UsageLimit > 0 && coupon.UsageCount >= coupon.UsageLimit {
			continue
		}
		out = append(out, offerView{
			Code: coupon.Code, Description: coupon.Description, Type: coupon.Type,
			Qualified: subtotal >= coupon.MinSubtotal, ExpiresAt: coupon.ExpiresAt, MinSubtotal: coupon.MinSubtotal,
		})
	}
	return out
}

func (h *Handler) notifyExpiringCoupons(ctx context.Context, userID uint, subtotal float64) {
	uid := userID
	soon := time.Now().Add(72 * time.Hour)
	for _, offer := range h.qualifyingOffers(ctx, subtotal) {
		if !offer.Qualified || offer.ExpiresAt == nil || offer.ExpiresAt.After(soon) {
			continue
		}
		h.pushNotice(ctx, &uid, "offer", "A code in your cart expires soon",
			offer.Code+" expires "+offer.ExpiresAt.Format("2 Jan")+".", "/cart",
			"coupon:"+offer.Code+":"+offer.ExpiresAt.Format("2006-01-02"), nil, nil, nil)
	}
}

func (h *Handler) ProductCompanions(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	var product models.Product
	if err := h.DB.WithContext(r.Context()).Where("slug = ?", slug).First(&product).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "product not found")
		return
	}
	var products []models.Product
	h.DB.WithContext(r.Context()).
		Where("id <> ? AND (name ILIKE ? OR name ILIKE ? OR name ILIKE ? OR name ILIKE ?)", product.ID, "%pot%", "%soil%", "%fertil%", "%manure%").
		Order("featured DESC, created_at DESC").Limit(8).Find(&products)
	h.ResolveProductImageURLsSlice(products)
	httpjson.JSON(w, http.StatusOK, map[string]any{"products": products})
}

func (h *Handler) FilterProducts(w http.ResponseWriter, r *http.Request) {
	q := h.DB.WithContext(r.Context()).Preload("Sizes").Preload("Category").Order("featured DESC, created_at DESC").Limit(40)
	apply := func(name, value string) {
		clause, args := tagClause(name, value)
		q = q.Where(clause, args...)
	}
	if light := strings.TrimSpace(r.URL.Query().Get("light")); light != "" {
		apply("light", light)
	}
	if r.URL.Query().Get("petSafe") == "1" {
		apply("pet", "pet")
	}
	if r.URL.Query().Get("beginner") == "1" {
		apply("beginner", "beginner")
	}
	if r.URL.Query().Get("indoor") == "1" {
		apply("indoor", "indoor")
	}
	if climate := strings.TrimSpace(r.URL.Query().Get("climate")); climate != "" {
		apply("climate", climate)
	}
	var products []models.Product
	if err := q.Find(&products).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to filter products")
		return
	}
	h.ResolveProductImageURLsSlice(products)
	httpjson.JSON(w, http.StatusOK, map[string]any{"products": products})
}

func tagClause(name, value string) (string, []any) {
	like := "%" + value + "%"
	return `EXISTS (SELECT 1 FROM unnest(tags) t WHERE t ILIKE ?) OR EXISTS (SELECT 1 FROM attributes a WHERE a.product_id = products.id AND (a.name ILIKE ? OR a.value ILIKE ?))`,
		[]any{like, "%" + name + "%", like}
}

func (h *Handler) Reorder(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	order, ok := h.ownOrder(w, r, claims.UserID)
	if !ok {
		return
	}
	type line struct {
		ProductID     uint    `json:"productId"`
		ProductSizeID *uint   `json:"productSizeId,omitempty"`
		Quantity      int     `json:"quantity"`
		Name          string  `json:"name"`
		Price         float64 `json:"price"`
		ImageURL      string  `json:"imageUrl,omitempty"`
	}
	lines := make([]line, 0, len(order.Items))
	for _, item := range order.Items {
		h.ResolveOrderItemImageURL(&item)
		lines = append(lines, line{
			ProductID: item.ProductID, ProductSizeID: item.ProductSize, Quantity: item.Quantity,
			Name: item.Name, Price: item.Price, ImageURL: item.ImageURL,
		})
	}
	httpjson.JSON(w, http.StatusOK, map[string]any{"items": lines})
}

func (h *Handler) RateDelivery(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	order, ok := h.ownOrder(w, r, claims.UserID)
	if !ok {
		return
	}
	if order.Status != "delivered" && order.DeliveredAt == nil {
		httpjson.Error(w, http.StatusConflict, "You can rate a delivery after it arrives.")
		return
	}
	var req struct {
		Rating   int    `json:"rating"`
		Feedback string `json:"feedback"`
	}
	if !httpjson.Decode(w, r, &req) || req.Rating < 1 || req.Rating > 5 {
		httpjson.Error(w, http.StatusBadRequest, "Choose a rating from 1 to 5.")
		return
	}
	if err := h.DB.WithContext(r.Context()).Model(&order).Updates(map[string]any{
		"delivery_rating": req.Rating, "delivery_feedback": clipText(req.Feedback, 500),
	}).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "Could not save the rating.")
		return
	}
	httpjson.JSON(w, http.StatusOK, map[string]any{"success": true})
}

func (h *Handler) RetryPayment(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	order, ok := h.ownOrder(w, r, claims.UserID)
	if !ok {
		return
	}
	if order.PaymentStatus != "failed" {
		httpjson.Error(w, http.StatusConflict, "This order does not need a new payment attempt.")
		return
	}
	razorpayOrder, err := h.createRazorpayOrder(int(order.Amount*100+0.5), order.Currency)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "Could not start a new payment.")
		return
	}
	err = h.DB.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.Order{}).Where("id = ?", order.ID).Updates(map[string]any{
			"razorpay_order_id": razorpayOrder.ID,
			"payment_status":    "created",
			"status":            "pending",
		}).Error; err != nil {
			return err
		}
		return h.reserveOrderInventory(tx, order.Items)
	})
	if err != nil {
		log.Printf("[PAYMENT] retry order %d: %v", order.ID, err)
		httpjson.Error(w, http.StatusConflict, "Those plants are no longer available to reserve.")
		return
	}
	httpjson.JSON(w, http.StatusOK, map[string]any{
		"id": razorpayOrder.ID, "amount": razorpayOrder.Amount, "currency": razorpayOrder.Currency, "orderId": order.ID,
	})
}

func (h *Handler) ownOrder(w http.ResponseWriter, r *http.Request, userID uint) (models.Order, bool) {
	id, err := strconv.ParseUint(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid order id")
		return models.Order{}, false
	}
	var order models.Order
	err = h.DB.WithContext(r.Context()).Preload("Items").Where("id = ? AND user_id = ?", id, userID).First(&order).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		httpjson.Error(w, http.StatusNotFound, "order not found")
		return models.Order{}, false
	}
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to load order")
		return models.Order{}, false
	}
	return order, true
}

func (h *Handler) ListMyQuotes(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	var rows []models.QuoteRequest
	h.DB.WithContext(r.Context()).Where("user_id = ?", claims.UserID).Order("created_at DESC").Limit(30).Find(&rows)
	httpjson.JSON(w, http.StatusOK, map[string]any{"quotes": rows})
}

func (h *Handler) saveQuoteRequest(r *http.Request, name, phone, email, summary, estimate string, amount float64) {
	var userID *uint
	if claims, ok := appauth.FromContext(r.Context()); ok {
		userID = &claims.UserID
	}
	row := models.QuoteRequest{
		UserID: userID, EstimateNo: estimate, Name: name, Phone: phone, Email: email,
		Summary: clipText(summary, 300), Amount: amount, Status: "sent",
	}
	if err := h.DB.WithContext(r.Context()).Create(&row).Error; err != nil {
		log.Printf("[QUOTATION] save request: %v", err)
		return
	}
	if userID != nil {
		h.pushNotice(r.Context(), userID, "order", "Quotation sent", "We received "+estimate+".", "/bulk",
			"quote:"+estimate, nil, nil, nil)
	}
}

func (h *Handler) UpdateQuoteStatus(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	if !appauth.IsAdminRole(claims.Role) {
		httpjson.Error(w, http.StatusForbidden, "admin access required")
		return
	}
	id, err := strconv.ParseUint(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid quote id")
		return
	}
	var req struct {
		Status string `json:"status"`
	}
	if !httpjson.Decode(w, r, &req) {
		return
	}
	status := strings.ToLower(strings.TrimSpace(req.Status))
	if status != "sent" && status != "revised" && status != "accepted" {
		httpjson.Error(w, http.StatusBadRequest, "status must be sent, revised, or accepted")
		return
	}
	var quote models.QuoteRequest
	if err := h.DB.WithContext(r.Context()).First(&quote, id).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "quote not found")
		return
	}
	if err := h.DB.WithContext(r.Context()).Model(&quote).Update("status", status).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to update quote")
		return
	}
	h.pushNotice(r.Context(), quote.UserID, "order", "Quotation "+status, quote.EstimateNo+" is now "+status+".", "/bulk",
		"quote:"+quote.EstimateNo+":"+status, nil, nil, nil)
	httpjson.JSON(w, http.StatusOK, map[string]any{"success": true, "status": status})
}

func (h *Handler) ActiveOrder(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	var order models.Order
	err := h.DB.WithContext(r.Context()).
		Where("user_id = ? AND status NOT IN ?", claims.UserID, []string{"delivered", "cancelled", "failed"}).
		Order("created_at DESC").First(&order).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		httpjson.JSON(w, http.StatusOK, map[string]any{"order": nil})
		return
	}
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to load orders")
		return
	}
	httpjson.JSON(w, http.StatusOK, map[string]any{"order": order})
}

func (h *Handler) UploadMyImage(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	if h.ImageService == nil {
		httpjson.Error(w, http.StatusServiceUnavailable, "Photo upload is not configured.")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "Choose a photo under 8 MB.")
		return
	}
	file, header, err := r.FormFile("image")
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "image file is required")
		return
	}
	defer file.Close()
	prefix := fmt.Sprintf("plants/%d", claims.UserID)
	imageKey := GenerateImageKey(prefix, header.Filename)
	contentType := header.Header.Get("Content-Type")
	if !allowedImageMIME(contentType) {
		contentType = "image/jpeg"
	}
	if err := h.ImageService.UploadImage(r.Context(), imageKey, file, contentType); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "Could not store the photo.")
		return
	}
	httpjson.JSON(w, http.StatusOK, map[string]string{
		"imageKey": imageKey,
		"imageUrl": h.ImageService.ResolveImageURL(imageKey),
	})
}

func (h *Handler) PlantCalendar(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	var plants []models.OwnedPlant
	h.DB.WithContext(r.Context()).Where("user_id = ?", claims.UserID).Find(&plants)
	now := care.India(time.Now())
	end := now.AddDate(0, 0, 7)
	type task struct {
		PlantID   uint   `json:"plantId"`
		PlantName string `json:"plantName"`
		Kind      string `json:"kind"`
		Due       string `json:"due"`
	}
	var tasks []task
	add := func(plant models.OwnedPlant, kind string, due *time.Time, on bool) {
		if !on || due == nil {
			return
		}
		when := care.India(*due)
		if when.After(end) {
			return
		}
		tasks = append(tasks, task{PlantID: plant.ID, PlantName: plant.Name, Kind: kind, Due: when.Format("2006-01-02")})
	}
	for _, plant := range plants {
		add(plant, "water", plant.WaterNextAt, plant.WaterReminder)
		add(plant, "fertilize", plant.FertilizeNextAt, plant.FertilizeReminder)
		add(plant, "mist", plant.MistNextAt, plant.MistReminder)
		add(plant, "rotate", plant.RotateNextAt, plant.RotateReminder)
		add(plant, "repot", plant.RepotNextAt, plant.RepotReminder)
		add(plant, "prune", plant.PruneNextAt, plant.PruneReminder)
	}
	httpjson.JSON(w, http.StatusOK, map[string]any{"tasks": tasks})
}

func (h *Handler) SnoozePlant(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	plant, ok := h.ownedPlant(w, r, claims.UserID)
	if !ok {
		return
	}
	hour := h.reminderHour(r.Context(), claims.UserID)
	now := time.Now()
	shift := func(due *time.Time, on bool) *time.Time {
		if !on || due == nil || !care.IsDue(due, now.Add(24*time.Hour)) {
			return due
		}
		return care.NextDueAt(now, 1, hour)
	}
	plant.WaterNextAt = shift(plant.WaterNextAt, plant.WaterReminder)
	plant.FertilizeNextAt = shift(plant.FertilizeNextAt, plant.FertilizeReminder)
	plant.MistNextAt = shift(plant.MistNextAt, plant.MistReminder)
	plant.RotateNextAt = shift(plant.RotateNextAt, plant.RotateReminder)
	plant.RepotNextAt = shift(plant.RepotNextAt, plant.RepotReminder)
	plant.PruneNextAt = shift(plant.PruneNextAt, plant.PruneReminder)
	until := care.India(now).AddDate(0, 0, 1)
	plant.SnoozedUntil = &until
	if err := h.DB.WithContext(r.Context()).Save(&plant).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "Could not snooze reminders.")
		return
	}
	httpjson.JSON(w, http.StatusOK, h.presentPlants(r, claims.UserID, []models.OwnedPlant{plant})[0])
}

func (h *Handler) ImportPurchasedPlants(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	var orders []models.Order
	h.DB.WithContext(r.Context()).Preload("Items").Preload("Items.Product").
		Where("user_id = ? AND payment_status = ?", claims.UserID, "paid").Find(&orders)
	var existing []models.OwnedPlant
	h.DB.WithContext(r.Context()).Where("user_id = ?", claims.UserID).Find(&existing)
	have := map[string]bool{}
	for _, plant := range existing {
		have[strings.ToLower(plant.Name)] = true
	}
	hour := h.reminderHour(r.Context(), claims.UserID)
	created := 0
	for _, order := range orders {
		for _, item := range order.Items {
			name := strings.TrimSpace(item.Name)
			if name == "" || supplyName(name) || have[strings.ToLower(name)] {
				continue
			}
			slug := ""
			var productID *uint
			if item.ProductID != 0 {
				productID = &item.ProductID
				slug = item.Product.Slug
			}
			plant := models.OwnedPlant{
				UserID: claims.UserID, Name: clipText(name, 80), ProductID: productID, ProductSlug: slug,
				WaterEveryDays: 7, FertilizeEveryDays: 45, WaterReminder: true, FertilizeReminder: true,
				WaterNextAt: care.NextDueAt(time.Now(), 7, hour), FertilizeNextAt: care.NextDueAt(time.Now(), 45, hour),
			}
			if err := h.DB.WithContext(r.Context()).Create(&plant).Error; err != nil {
				continue
			}
			have[strings.ToLower(name)] = true
			created++
		}
	}
	httpjson.JSON(w, http.StatusOK, map[string]any{"imported": created})
}

func supplyName(name string) bool {
	lower := strings.ToLower(name)
	for _, word := range []string{"pot", "soil", "fertil", "manure", "pebble", "tray", "stand", "spray"} {
		if strings.Contains(lower, word) {
			return true
		}
	}
	return false
}

func (h *Handler) PlantCareCard(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	plant, ok := h.ownedPlant(w, r, claims.UserID)
	if !ok {
		return
	}
	text := fmt.Sprintf("%s\nSpot: %s\nWater every %d days. Feed every %d days.", plant.Name, plant.Room, plant.WaterEveryDays, plant.FertilizeEveryDays)
	if plant.Notes != "" {
		text += "\n" + plant.Notes
	}
	httpjson.JSON(w, http.StatusOK, map[string]any{"text": text, "name": plant.Name})
}

func (h *Handler) DiagnosePlant(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	plant, ok := h.ownedPlant(w, r, claims.UserID)
	if !ok {
		return
	}
	var req struct {
		Status       string `json:"status"`
		Notes        string `json:"notes"`
		PhotoURL     string `json:"photoUrl"`
		FollowUpDays int    `json:"followUpDays"`
	}
	if !httpjson.Decode(w, r, &req) {
		return
	}
	status := strings.ToLower(strings.TrimSpace(req.Status))
	if !healthStatuses[status] {
		status = diagnosisStatus(req.Notes)
	}
	if req.FollowUpDays <= 0 {
		req.FollowUpDays = 3
	}
	follow := care.NextDueAt(time.Now(), req.FollowUpDays, h.reminderHour(r.Context(), claims.UserID))
	entry := models.PlantHealthLog{
		OwnedPlantID: plant.ID, UserID: claims.UserID, Status: status,
		Notes: clipText(req.Notes, 1000), PhotoURL: clipText(req.PhotoURL, 500),
		RecordedAt: time.Now(), FollowUpAt: follow,
	}
	if err := h.DB.WithContext(r.Context()).Create(&entry).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "Could not save the diagnosis.")
		return
	}
	uid := claims.UserID
	pid := plant.ID
	h.pushNotice(r.Context(), &uid, "health", "Check "+plant.Name,
		"Follow up on "+status+" in "+strconv.Itoa(req.FollowUpDays)+" days.",
		"/my-plants/"+strconv.FormatUint(uint64(plant.ID), 10),
		"health:"+strconv.FormatUint(uint64(plant.ID), 10)+":"+follow.Format("2006-01-02"), nil, nil, &pid)
	httpjson.JSON(w, http.StatusCreated, map[string]any{"health": entry, "followUpAt": follow})
}

func diagnosisStatus(notes string) string {
	lower := strings.ToLower(notes)
	switch {
	case strings.Contains(lower, "pest") || strings.Contains(lower, "bug") || strings.Contains(lower, "mite"):
		return "pests"
	case strings.Contains(lower, "yellow"):
		return "yellowing"
	case strings.Contains(lower, "wilt") || strings.Contains(lower, "rot"):
		return "wilting"
	case strings.Contains(lower, "stress"):
		return "stressed"
	default:
		return "stressed"
	}
}

func (h *Handler) StartCarePlan(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	plant, ok := h.ownedPlant(w, r, claims.UserID)
	if !ok {
		return
	}
	hour := h.reminderHour(r.Context(), claims.UserID)
	now := time.Now()
	plant.WaterEveryDays = 3
	plant.WaterReminder = true
	plant.WaterNextAt = care.NextDueAt(now, 3, hour)
	plant.MistEveryDays = 2
	plant.MistReminder = true
	plant.MistNextAt = care.NextDueAt(now, 2, hour)
	plant.FertilizeEveryDays = 21
	plant.FertilizeReminder = true
	plant.FertilizeNextAt = care.NextDueAt(now, 21, hour)
	if err := h.DB.WithContext(r.Context()).Save(&plant).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "Could not start the care plan.")
		return
	}
	tasks := []string{
		"Days 1–7: keep it in bright indirect light and check the soil every third day.",
		"Mist the leaves every second day if the room is air-conditioned.",
		"Hold fertiliser until day 21, then give a light feed.",
		"After 30 days, switch back to the plant's normal interval.",
	}
	uid := claims.UserID
	pid := plant.ID
	h.pushNotice(r.Context(), &uid, "dootha", "30-day plan for "+plant.Name,
		"Watering, misting, and a first feed are scheduled.",
		"/my-plants/"+strconv.FormatUint(uint64(plant.ID), 10),
		"plan:"+strconv.FormatUint(uint64(plant.ID), 10), nil, nil, &pid)
	httpjson.JSON(w, http.StatusOK, map[string]any{"tasks": tasks, "plant": h.presentPlants(r, claims.UserID, []models.OwnedPlant{plant})[0]})
}

func (h *Handler) ScanAlert(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	var req struct {
		Summary string `json:"summary"`
	}
	if !httpjson.Decode(w, r, &req) {
		return
	}
	summary := clipText(req.Summary, 240)
	if summary == "" {
		httpjson.Error(w, http.StatusBadRequest, "Describe what the photo showed.")
		return
	}
	uid := claims.UserID
	h.pushNotice(r.Context(), &uid, "dootha", "This photo needs a look",
		summary, "/chat", "scan:"+time.Now().Format("2006-01-02T15"), nil, nil, nil)
	httpjson.JSON(w, http.StatusOK, map[string]any{"success": true})
}

func (h *Handler) CareFollowUp(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	var req struct {
		Note    string `json:"note"`
		PlantID *uint  `json:"plantId"`
		Days    int    `json:"days"`
	}
	if !httpjson.Decode(w, r, &req) {
		return
	}
	if req.Days <= 0 {
		req.Days = 1
	}
	due := care.NextDueAt(time.Now(), req.Days, h.reminderHour(r.Context(), claims.UserID))
	note := clipText(req.Note, 240)
	if note == "" {
		note = "Follow the care steps Dootha suggested."
	}
	uid := claims.UserID
	h.pushNotice(r.Context(), &uid, "care", "Care follow-up", note, "/chat",
		"follow:"+due.Format("2006-01-02T15"), nil, nil, req.PlantID)
	httpjson.JSON(w, http.StatusOK, map[string]any{"due": due})
}

func (h *Handler) ListChatHistory(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	var turns []models.ChatTurn
	h.DB.WithContext(r.Context()).Where("user_id = ?", claims.UserID).Order("created_at DESC").Limit(40).Find(&turns)
	for i, j := 0, len(turns)-1; i < j; i, j = i+1, j-1 {
		turns[i], turns[j] = turns[j], turns[i]
	}
	httpjson.JSON(w, http.StatusOK, map[string]any{"messages": turns})
}

func (h *Handler) saveChatTurn(ctx context.Context, userID uint, role, content string) {
	content = clipText(content, 4000)
	if content == "" {
		return
	}
	if err := h.DB.WithContext(ctx).Create(&models.ChatTurn{UserID: userID, Role: role, Content: content}).Error; err != nil {
		log.Printf("[CHAT] save: %v", err)
	}
}

func (h *Handler) recentChat(ctx context.Context, userID uint) []ChatMessage {
	var turns []models.ChatTurn
	h.DB.WithContext(ctx).Where("user_id = ?", userID).Order("created_at DESC").Limit(8).Find(&turns)
	out := make([]ChatMessage, 0, len(turns))
	for i := len(turns) - 1; i >= 0; i-- {
		role := turns[i].Role
		if role == "dootha" {
			role = "assistant"
		}
		out = append(out, ChatMessage{Role: role, Content: turns[i].Content})
	}
	return out
}

func (h *Handler) customerContext(ctx context.Context, userID uint) string {
	var user models.User
	_ = h.DB.WithContext(ctx).Select("city", "state").First(&user, userID).Error
	var plants []models.OwnedPlant
	h.DB.WithContext(ctx).Where("user_id = ?", userID).Limit(8).Find(&plants)
	var orders []models.Order
	h.DB.WithContext(ctx).Select("id", "status", "city").Where("user_id = ?", userID).Order("created_at DESC").Limit(3).Find(&orders)
	var b strings.Builder
	b.WriteString("\n\nAccount context (use it, do not invent beyond it):\n")
	if user.City != "" {
		b.WriteString("City: " + user.City + ", " + user.State + "\n")
	}
	if len(plants) == 0 {
		b.WriteString("Plants: none saved yet.\n")
	}
	for _, plant := range plants {
		fmt.Fprintf(&b, "- %s in %s %s\n", plant.Name, plant.Room, plant.Location)
	}
	for _, order := range orders {
		fmt.Fprintf(&b, "- Order %d status %s\n", order.ID, order.Status)
	}
	return b.String()
}

func (h *Handler) checkWeather(ctx context.Context, userID uint, plants []models.OwnedPlant) {
	outdoor := false
	for _, plant := range plants {
		spot := strings.ToLower(plant.Room + " " + plant.Location)
		if strings.Contains(spot, "balcony") || strings.Contains(spot, "outdoor") || strings.Contains(spot, "terrace") {
			outdoor = true
			break
		}
	}
	if !outdoor {
		return
	}
	var user models.User
	if err := h.DB.WithContext(ctx).Select("latitude", "longitude").First(&user, userID).Error; err != nil {
		return
	}
	title, body := seasonWeather()
	if user.Latitude != nil && user.Longitude != nil {
		if liveTitle, liveBody, ok := liveWeather(*user.Latitude, *user.Longitude); ok {
			title, body = liveTitle, liveBody
		}
	}
	if title == "" {
		return
	}
	uid := userID
	h.pushNotice(ctx, &uid, "weather", title, body, "/my-plants", "weather:"+time.Now().Format("2006-01-02"), nil, nil, nil)
}

func seasonWeather() (string, string) {
	switch care.For(care.India(time.Now())).Season {
	case care.Summer:
		return "Heat alert for outdoor plants", "Shade balcony pots from afternoon sun and check soil before evening."
	case care.Monsoon:
		return "Heavy rain expected this season", "Empty saucers and skip watering outdoor pots after rain."
	case care.Winter:
		return "Cold nights for balcony plants", "Pull pots in from the wind and water in the morning."
	default:
		return "", ""
	}
}

func liveWeather(lat, lng float64) (string, string, bool) {
	url := fmt.Sprintf("https://api.open-meteo.com/v1/forecast?latitude=%.4f&longitude=%.4f&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=Asia%%2FKolkata&forecast_days=1", lat, lng)
	client := &http.Client{Timeout: 4 * time.Second}
	res, err := client.Get(url)
	if err != nil {
		return "", "", false
	}
	defer res.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil || res.StatusCode != http.StatusOK {
		return "", "", false
	}
	var parsed struct {
		Daily struct {
			Max  []float64 `json:"temperature_2m_max"`
			Min  []float64 `json:"temperature_2m_min"`
			Rain []float64 `json:"precipitation_sum"`
		} `json:"daily"`
	}
	if json.Unmarshal(payload, &parsed) != nil {
		return "", "", false
	}
	if len(parsed.Daily.Max) == 0 {
		return "", "", false
	}
	switch {
	case parsed.Daily.Max[0] >= 38:
		return "Heat alert for outdoor plants", fmt.Sprintf("Tomorrow reaches about %.0f°C. Shade balcony pots and water in the morning.", parsed.Daily.Max[0]), true
	case len(parsed.Daily.Rain) > 0 && parsed.Daily.Rain[0] >= 20:
		return "Heavy rain for outdoor plants", "A wet day is forecast. Empty saucers and hold off watering balcony pots.", true
	case len(parsed.Daily.Min) > 0 && parsed.Daily.Min[0] <= 12:
		return "Cold alert for outdoor plants", fmt.Sprintf("The night drops to about %.0f°C. Pull tender pots out of the wind.", parsed.Daily.Min[0]), true
	default:
		return "", "", true
	}
}
