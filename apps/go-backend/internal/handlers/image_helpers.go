package handlers

import (
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
)

// ResolveProductImageURLs resolves image keys to full URLs for a product.
// The shop-facing imageUrl is the first size photo when one exists. The
// product-level key is often an older object that is no longer in the bucket,
// while the size photo is the one the product page actually shows.
func (h *Handler) ResolveProductImageURLs(product *models.Product) {
	if h.ImageService == nil {
		return
	}

	var firstSize string
	for i := range product.Sizes {
		if len(product.Sizes[i].ImageKeys) == 0 {
			continue
		}
		product.Sizes[i].Images = h.ImageService.ResolveImageURLs(product.Sizes[i].ImageKeys)
		if firstSize == "" && len(product.Sizes[i].Images) > 0 {
			firstSize = product.Sizes[i].Images[0]
		}
	}
	if firstSize != "" {
		product.ImageURL = firstSize
		return
	}
	if product.ImageKey != "" {
		product.ImageURL = h.ImageService.ResolveImageURL(product.ImageKey)
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

// displayPhotoURL is the photo to show for a product: the first size image,
// then the product-level key. Size photos are the ones that still exist in
// storage; the product-level key is often a stale upload.
func (h *Handler) displayPhotoURL(productID uint, imageKey string) string {
	if h.ImageService == nil {
		return ""
	}
	if productID != 0 {
		var sizes []models.ProductSize
		if err := h.DB.Select("image_keys").Where("product_id = ?", productID).Find(&sizes).Error; err == nil {
			for _, size := range sizes {
				for _, key := range size.ImageKeys {
					if key == "" {
						continue
					}
					if url := h.ImageService.ResolveImageURL(key); url != "" {
						return url
					}
				}
			}
		}
	}
	return h.ImageService.ResolveImageURL(imageKey)
}

// resolveImageURL resolves a single storage key, returning "" when image
// storage is not configured so callers can simply omit the field.
func (h *Handler) resolveImageURL(key string) string {
	if h.ImageService == nil || key == "" {
		return ""
	}
	return h.ImageService.ResolveImageURL(key)
}
