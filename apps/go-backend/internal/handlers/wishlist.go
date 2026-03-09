package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"

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
	claims, ok := appauth.FromContext(r.Context())
	if !ok {
		httpjson.Error(w, http.StatusUnauthorized, "unauthorized")
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
	claims, ok := appauth.FromContext(r.Context())
	if !ok {
		httpjson.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req AddToWishlistRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid request body")
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

	// Check if already in wishlist
	var existing models.Wishlist
	if err := h.DB.Where("user_id = ? AND product_id = ?", claims.UserID, req.ProductID).First(&existing).Error; err == nil {
		// Already in wishlist
		httpjson.JSON(w, http.StatusOK, map[string]any{"message": "already in wishlist"})
		return
	}

	wishlist := models.Wishlist{UserID: claims.UserID, ProductID: req.ProductID}
	if err := h.DB.Create(&wishlist).Error; err != nil {
		log.Printf("[WISHLIST] Error adding to wishlist: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to add to wishlist")
		return
	}

	httpjson.JSON(w, http.StatusCreated, map[string]any{"message": "added to wishlist"})
}

// RemoveFromWishlist removes a product from the user's wishlist
func (h *Handler) RemoveFromWishlist(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.FromContext(r.Context())
	if !ok {
		httpjson.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	productIDStr := chi.URLParam(r, "productId")
	productID, err := strconv.ParseUint(productIDStr, 10, 32)
	if err != nil || productID == 0 {
		httpjson.Error(w, http.StatusBadRequest, "invalid productId")
		return
	}

	result := h.DB.Where("user_id = ? AND product_id = ?", claims.UserID, uint(productID)).Delete(&models.Wishlist{})
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
