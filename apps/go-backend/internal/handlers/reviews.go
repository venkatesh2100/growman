package handlers

import (
	"context"
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

// Reviews
//
// Reviews are moderated: a submission lands as "pending" and only becomes
// publicly visible, or counts towards a product's rating, once approved.
// The alternative — publish-then-moderate — is not viable for a small team
// that cannot watch the queue continuously.
//
// Ratings are denormalised onto products.rating_average/rating_count so
// list pages never join to reviews. RecalculateProductRating is the only
// writer, and it recomputes from scratch rather than incrementing, so a
// moderation reversal cannot leave the aggregate wrong.

// reviewAutoApproveVerified publishes verified-purchase reviews
// immediately. The author provably bought the item, which removes the main
// spam vector, and the delay would otherwise lose most of the review's
// value.
const reviewAutoApproveVerified = true

// CreateProductReview records a customer's review of a product.
func (h *Handler) CreateProductReview(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	slug := chi.URLParam(r, "slug")

	var req struct {
		Rating    int      `json:"rating"`
		Title     string   `json:"title"`
		Comment   string   `json:"comment"`
		ImageKeys []string `json:"imageKeys"`
	}
	if !httpjson.Decode(w, r, &req) {
		return
	}
	if req.Rating < 1 || req.Rating > 5 {
		httpjson.Error(w, http.StatusBadRequest, "rating must be between 1 and 5")
		return
	}
	req.Comment = strings.TrimSpace(req.Comment)
	req.Title = strings.TrimSpace(req.Title)
	if len(req.Comment) > 4000 {
		req.Comment = req.Comment[:4000]
	}
	if len(req.Title) > 140 {
		req.Title = req.Title[:140]
	}
	if len(req.ImageKeys) > 5 {
		req.ImageKeys = req.ImageKeys[:5]
	}

	var product models.Product
	if err := h.DB.WithContext(r.Context()).Select("id, name, slug").
		Where("slug = ?", slug).First(&product).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "product not found")
		return
	}

	verified, err := h.hasPurchased(r.Context(), claims.UserID, product.ID)
	if err != nil {
		log.Printf("[REVIEW] purchase check: %v", err)
	}

	status := "pending"
	if verified && reviewAutoApproveVerified {
		status = "approved"
	}

	review := models.Review{
		ProductID:        product.ID,
		UserID:           claims.UserID,
		Rating:           req.Rating,
		Title:            req.Title,
		Comment:          req.Comment,
		Status:           status,
		VerifiedPurchase: verified,
		ImageKeys:        req.ImageKeys,
	}

	// One review per customer per product; a resubmission updates the
	// existing row and returns to moderation.
	if err := h.DB.WithContext(r.Context()).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "product_id"}, {Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"rating", "title", "comment", "status", "verified_purchase", "image_keys", "updated_at",
		}),
	}).Create(&review).Error; err != nil {
		log.Printf("[REVIEW] create: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to save review")
		return
	}

	if status == "approved" {
		if err := h.RecalculateProductRating(r.Context(), product.ID); err != nil {
			log.Printf("[REVIEW] recalculate rating: %v", err)
		}
		h.invalidateCatalog(r.Context())
	} else {
		h.notifyMerchantAsync(
			"New review awaiting moderation",
			"A review was submitted for "+product.Name+" and is waiting for approval in the admin queue.")
	}

	message := "Thanks! Your review is live."
	if status != "approved" {
		message = "Thanks! Your review will appear once we've checked it over."
	}
	httpjson.JSON(w, http.StatusOK, map[string]any{
		"success": true,
		"status":  status,
		"message": message,
		"review":  h.decorateReview(review),
	})
}

// hasPurchased reports whether the user has a paid order containing the
// product, which drives the verified-purchase badge.
func (h *Handler) hasPurchased(ctx context.Context, userID, productID uint) (bool, error) {
	var count int64
	err := h.DB.WithContext(ctx).Model(&models.OrderItem{}).
		Joins("JOIN orders ON orders.id = order_items.order_id").
		Where("order_items.product_id = ? AND orders.user_id = ? AND orders.payment_status = ?",
			productID, userID, "paid").
		Count(&count).Error
	return count > 0, err
}

// ListProductReviews returns a product's approved reviews, newest first,
// with verified purchases surfaced ahead of unverified ones at equal age.
func (h *Handler) ListProductReviews(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")

	var product models.Product
	if err := h.DB.WithContext(r.Context()).Select("id, rating_average, rating_count").
		Where("slug = ?", slug).First(&product).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "product not found")
		return
	}

	limit := 20
	if v, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && v > 0 && v <= 100 {
		limit = v
	}
	offset := 0
	if v, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && v > 0 {
		offset = v
	}

	var reviews []models.Review
	if err := h.DB.WithContext(r.Context()).
		Preload("User", func(db *gorm.DB) *gorm.DB { return db.Select("id, name") }).
		Where("product_id = ? AND status = ?", product.ID, "approved").
		Order("verified_purchase DESC, created_at DESC").
		Limit(limit).Offset(offset).
		Find(&reviews).Error; err != nil {
		log.Printf("[REVIEW] list: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to load reviews")
		return
	}

	// Rating histogram — the 1-5 bar chart shoppers scan before reading.
	type bucket struct {
		Rating int   `json:"rating"`
		Count  int64 `json:"count"`
	}
	var histogram []bucket
	if err := h.DB.WithContext(r.Context()).Model(&models.Review{}).
		Select("rating, COUNT(*) AS count").
		Where("product_id = ? AND status = ?", product.ID, "approved").
		Group("rating").Order("rating DESC").
		Scan(&histogram).Error; err != nil {
		log.Printf("[REVIEW] histogram: %v", err)
	}

	out := make([]map[string]any, 0, len(reviews))
	for _, review := range reviews {
		out = append(out, h.decorateReview(review))
	}

	httpjson.JSON(w, http.StatusOK, map[string]any{
		"reviews":       out,
		"ratingAverage": product.RatingAverage,
		"ratingCount":   product.RatingCount,
		"histogram":     histogram,
	})
}

// decorateReview shapes a review for public consumption: resolved image
// URLs, and only the author's first name — a full name next to a delivery
// address is more personal data than a product page needs.
func (h *Handler) decorateReview(review models.Review) map[string]any {
	author := strings.TrimSpace(review.User.Name)
	// An erased account's name is a tombstone, not a person's name. Taking
	// the first word of it would publish the review as being by "Deleted",
	// so the anonymous label is used instead.
	if author == erasedUserName {
		author = ""
	}
	if parts := strings.Fields(author); len(parts) > 0 {
		author = parts[0]
	}
	if author == "" {
		author = "Growman customer"
	}

	images := make([]string, 0, len(review.ImageKeys))
	for _, key := range review.ImageKeys {
		if url := h.resolveImageURL(key); url != "" {
			images = append(images, url)
		}
	}

	return map[string]any{
		"id":               review.ID,
		"rating":           review.Rating,
		"title":            review.Title,
		"comment":          review.Comment,
		"author":           author,
		"verifiedPurchase": review.VerifiedPurchase,
		"images":           images,
		"createdAt":        review.CreatedAt,
	}
}

// RecalculateProductRating recomputes a product's denormalised rating from
// its approved reviews. Recomputed rather than incremented so a
// moderation reversal or deletion can never leave the aggregate adrift.
func (h *Handler) RecalculateProductRating(ctx context.Context, productID uint) error {
	var result struct {
		Average float64
		Count   int
	}
	if err := h.DB.WithContext(ctx).Model(&models.Review{}).
		Select("COALESCE(AVG(rating), 0) AS average, COUNT(*) AS count").
		Where("product_id = ? AND status = ? AND deleted_at IS NULL", productID, "approved").
		Scan(&result).Error; err != nil {
		return err
	}

	// One decimal place is all that is ever displayed, and it keeps the
	// JSON-LD aggregateRating stable across recomputations.
	average := float64(int(result.Average*10+0.5)) / 10

	return h.DB.WithContext(ctx).Model(&models.Product{}).
		Where("id = ?", productID).
		UpdateColumns(map[string]any{
			"rating_average": average,
			"rating_count":   result.Count,
		}).Error
}

// ListReviewsForModeration returns the admin moderation queue.
func (h *Handler) ListReviewsForModeration(w http.ResponseWriter, r *http.Request) {
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status == "" {
		status = "pending"
	}

	query := h.DB.WithContext(r.Context()).
		Preload("User", func(db *gorm.DB) *gorm.DB { return db.Select("id, name, email") }).
		Order("created_at DESC").Limit(200)
	if status != "all" {
		query = query.Where("status = ?", status)
	}

	var reviews []models.Review
	if err := query.Find(&reviews).Error; err != nil {
		log.Printf("[REVIEW] moderation list: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to load reviews")
		return
	}

	// Product names, fetched in one query rather than per review.
	productIDs := make([]uint, 0, len(reviews))
	for _, review := range reviews {
		productIDs = append(productIDs, review.ProductID)
	}
	nameByID := map[uint]string{}
	if len(productIDs) > 0 {
		var products []models.Product
		if err := h.DB.WithContext(r.Context()).Select("id, name").
			Where("id IN ?", productIDs).Find(&products).Error; err == nil {
			for _, p := range products {
				nameByID[p.ID] = p.Name
			}
		}
	}

	out := make([]map[string]any, 0, len(reviews))
	for _, review := range reviews {
		out = append(out, map[string]any{
			"id":               review.ID,
			"productId":        review.ProductID,
			"productName":      nameByID[review.ProductID],
			"rating":           review.Rating,
			"title":            review.Title,
			"comment":          review.Comment,
			"status":           review.Status,
			"verifiedPurchase": review.VerifiedPurchase,
			"authorName":       review.User.Name,
			"authorEmail":      review.User.Email,
			"createdAt":        review.CreatedAt,
			"adminNotes":       review.AdminNotes,
		})
	}
	httpjson.JSON(w, http.StatusOK, map[string]any{"reviews": out, "count": len(out)})
}

// ModerateReview approves or rejects a review and refreshes the product's
// rating either way.
func (h *Handler) ModerateReview(w http.ResponseWriter, r *http.Request) {
	reviewID, err := strconv.ParseUint(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid review ID")
		return
	}

	var req struct {
		Status     string `json:"status"`
		AdminNotes string `json:"adminNotes"`
	}
	if !httpjson.Decode(w, r, &req) {
		return
	}
	switch req.Status {
	case "approved", "rejected", "pending":
	default:
		httpjson.Error(w, http.StatusBadRequest, "status must be approved, rejected or pending")
		return
	}

	var review models.Review
	if err := h.DB.WithContext(r.Context()).First(&review, reviewID).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "review not found")
		return
	}

	if err := h.DB.WithContext(r.Context()).Model(&models.Review{}).
		Where("id = ?", review.ID).
		Updates(map[string]any{"status": req.Status, "admin_notes": req.AdminNotes}).Error; err != nil {
		log.Printf("[REVIEW] moderate: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to update review")
		return
	}

	if err := h.RecalculateProductRating(r.Context(), review.ProductID); err != nil {
		log.Printf("[REVIEW] recalculate rating: %v", err)
	}
	h.invalidateCatalog(r.Context())

	httpjson.JSON(w, http.StatusOK, map[string]any{"success": true, "status": req.Status})
}

// SendReviewRequests emails customers a while after delivery asking for a
// review. Called on a ticker; one email per order, and only for orders
// that have no review from that customer yet.
func (h *Handler) SendReviewRequests(ctx context.Context) (sent int, err error) {
	// Long enough for the plant to have settled in and for the customer to
	// have an opinion worth reading.
	cutoff := time.Now().AddDate(0, 0, -10)

	var orders []models.Order
	if err := h.DB.WithContext(ctx).
		Preload("Items").
		Where(`payment_status = ? AND delivered_at IS NOT NULL AND delivered_at < ?
		       AND user_id IS NOT NULL AND customer_email <> ''
		       AND review_requested_at IS NULL`, "paid", cutoff).
		Limit(50).
		Find(&orders).Error; err != nil {
		return 0, err
	}

	for _, order := range orders {
		if len(order.Items) == 0 || order.UserID == nil {
			continue
		}
		item := order.Items[0]

		var product models.Product
		if err := h.DB.WithContext(ctx).Select("id, name, slug").First(&product, item.ProductID).Error; err != nil {
			continue
		}

		// Skip if they already reviewed it — no point nagging.
		var existing int64
		if err := h.DB.WithContext(ctx).Model(&models.Review{}).
			Where("product_id = ? AND user_id = ?", product.ID, *order.UserID).
			Count(&existing).Error; err == nil && existing > 0 {
			h.markReviewRequested(ctx, order.ID)
			continue
		}

		if err := h.emailService().SendReviewRequestEmail(
			order.CustomerEmail, order.CustomerName, order.ID, product.Name, product.Slug,
		); err != nil {
			log.Printf("[REVIEW] request email: %v", err)
			continue
		}
		h.markReviewRequested(ctx, order.ID)
		sent++
	}
	return sent, nil
}

func (h *Handler) markReviewRequested(ctx context.Context, orderID uint) {
	now := time.Now()
	if err := h.DB.WithContext(ctx).Model(&models.Order{}).
		Where("id = ?", orderID).
		UpdateColumn("review_requested_at", &now).Error; err != nil {
		log.Printf("[REVIEW] mark requested: %v", err)
	}
}
