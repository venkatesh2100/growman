package handlers

import (
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
)

// ResolveProductImageURLs resolves image keys to full URLs for a product
func (h *Handler) ResolveProductImageURLs(product *models.Product) {
	if h.ImageService == nil {
		return
	}

	// Resolve main product image
	if product.ImageKey != "" {
		product.ImageURL = h.ImageService.ResolveImageURL(product.ImageKey)
	}

	// Resolve images for product sizes
	for i := range product.Sizes {
		if len(product.Sizes[i].ImageKeys) > 0 {
			product.Sizes[i].Images = h.ImageService.ResolveImageURLs(product.Sizes[i].ImageKeys)
		}
	}
}

// ResolveProductImageURLsSlice resolves image keys to full URLs for a slice of products
func (h *Handler) ResolveProductImageURLsSlice(products []models.Product) {
	for i := range products {
		h.ResolveProductImageURLs(&products[i])
	}
}

// ResolveOrderItemImageURL resolves image key to full URL for an order item
func (h *Handler) ResolveOrderItemImageURL(item *models.OrderItem) {
	if h.ImageService == nil {
		return
	}

	if item.ImageKey != "" {
		item.ImageURL = h.ImageService.ResolveImageURL(item.ImageKey)
	}
}

// ResolveOrderItemImageURLsSlice resolves image keys to full URLs for a slice of order items
func (h *Handler) ResolveOrderItemImageURLsSlice(items []models.OrderItem) {
	for i := range items {
		h.ResolveOrderItemImageURL(&items[i])
	}
}

