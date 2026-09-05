package handlers

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
)

// AddToWishlistRequest represents the request body for adding to wishlist
type AddToWishlistRequest struct {
	ProductID uint `json:"productId"`
}

// ListWishlist returns the user's wishlist products
func (h *Handler) ListWishlist(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}

	var items []models.Wishlist
	if err := h.DB.Preload("Product").Preload("Product.Sizes").Preload("Product.Category").
		Where("user_id = ?", claims.UserID).
		Order("created_at DESC").
		Find(&items).Error; err != nil {
		log.Printf("[WISHLIST] Error fetching wishlist: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch wishlist")
		return
	}

	products := make([]models.Product, len(items))
	for i, item := range items {
		products[i] = item.Product
	}
	h.ResolveProductImageURLsSlice(products)

	httpjson.JSON(w, http.StatusOK, products)
}

// AddToWishlist adds a product to the user's wishlist
func (h *Handler) AddToWishlist(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}

	var req AddToWishlistRequest
	if !httpjson.Decode(w, r, &req) {
		return
	}

	if req.ProductID == 0 {
		httpjson.Error(w, http.StatusBadRequest, "productId is required")
		return
	}

	// Verify product exists
	var product models.Product
	if err := h.DB.First(&product, req.ProductID).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "product not found")
		return
	}

	// Check if row exists (any, including soft-deleted) via raw query so we don't rely on Unscoped
	var existing models.Wishlist
	err := h.DB.Raw(
		"SELECT * FROM wishlists WHERE user_id = ? AND product_id = ? ORDER BY id LIMIT 1",
		claims.UserID, req.ProductID,
	).Scan(&existing).Error
	if err == nil && existing.ID != 0 {
		if existing.DeletedAt.Valid {
			if err := h.DB.Exec(
				"UPDATE wishlists SET deleted_at = NULL, updated_at = NOW() WHERE id = ?",
				existing.ID,
			).Error; err != nil {
				log.Printf("[WISHLIST] Error restoring wishlist: %v", err)
				httpjson.Error(w, http.StatusInternalServerError, "failed to add to wishlist")
				return
			}
		}
		httpjson.JSON(w, http.StatusOK, map[string]any{"message": "already in wishlist"})
		return
	}

	wishlist := models.Wishlist{UserID: claims.UserID, ProductID: req.ProductID}
	if err := h.DB.Create(&wishlist).Error; err != nil {
		// Duplicate key = row exists (e.g. soft-deleted); find and restore
		if isDuplicateKey(err) {
			var row models.Wishlist
			if h.DB.Raw("SELECT id FROM wishlists WHERE user_id = ? AND product_id = ? LIMIT 1", claims.UserID, req.ProductID).Scan(&row).Error == nil && row.ID != 0 {
				if execErr := h.DB.Exec("UPDATE wishlists SET deleted_at = NULL, updated_at = NOW() WHERE id = ?", row.ID).Error; execErr == nil {
					httpjson.JSON(w, http.StatusOK, map[string]any{"message": "added to wishlist"})
					return
				}
			}
		}
		log.Printf("[WISHLIST] Error adding to wishlist: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to add to wishlist")
		return
	}

	httpjson.JSON(w, http.StatusCreated, map[string]any{"message": "added to wishlist"})
}

// RemoveFromWishlist removes a product from the user's wishlist
func (h *Handler) RemoveFromWishlist(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}

	productIDStr := chi.URLParam(r, "productId")
	productID, err := strconv.ParseUint(productIDStr, 10, 32)
	if err != nil || productID == 0 {
		httpjson.Error(w, http.StatusBadRequest, "invalid productId")
		return
	}

	// Use Unscoped to hard delete; avoids unique constraint conflict on re-add
	result := h.DB.Unscoped().Where("user_id = ? AND product_id = ?", claims.UserID, uint(productID)).Delete(&models.Wishlist{})
	if result.Error != nil {
		log.Printf("[WISHLIST] Error removing from wishlist: %v", result.Error)
		httpjson.Error(w, http.StatusInternalServerError, "failed to remove from wishlist")
		return
	}

	if result.RowsAffected == 0 {
		httpjson.Error(w, http.StatusNotFound, "item not in wishlist")
		return
	}

	httpjson.JSON(w, http.StatusOK, map[string]any{"message": "removed from wishlist"})
}

// isDuplicateKey reports whether err is a PostgreSQL unique violation (23505).
func isDuplicateKey(err error) bool {
	if err == nil {
		return false
	}
	for e := err; e != nil; e = errors.Unwrap(e) {
		s := e.Error()
		if strings.Contains(s, "23505") || strings.Contains(s, "duplicate key") {
			return true
		}
	}
	return false
}
