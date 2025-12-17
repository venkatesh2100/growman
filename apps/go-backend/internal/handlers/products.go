package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"gorm.io/gorm"
)

func (h *Handler) ListProducts(w http.ResponseWriter, r *http.Request) {
	var products []models.Product
	if err := h.DB.Preload("Sizes").Preload("Attributes").Preload("Category").Preload("Subcategory").Preload("Brand").Find(&products).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch products")
		return
	}
	httpjson.JSON(w, http.StatusOK, products)
}

func (h *Handler) GetProduct(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	var product models.Product
	err := h.DB.Preload("Sizes").Preload("Attributes").Preload("Category").Preload("Subcategory").Preload("Brand").Preload("Reviews.User").Where("slug = ?", slug).First(&product).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			httpjson.Error(w, http.StatusNotFound, "product not found")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch product")
		return
	}
	httpjson.JSON(w, http.StatusOK, product)
}

func (h *Handler) CreateProduct(w http.ResponseWriter, r *http.Request) {
	var input models.Product
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid payload")
		return
	}

	if err := h.DB.Create(&input).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to create product")
		return
	}

	httpjson.JSON(w, http.StatusCreated, input)
}

func (h *Handler) UpdateProduct(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	var existing models.Product
	if err := h.DB.Where("slug = ?", slug).First(&existing).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "product not found")
		return
	}

	var input models.Product
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid payload")
		return
	}

	input.ID = existing.ID

	if err := h.DB.Session(&gorm.Session{FullSaveAssociations: true}).Save(&input).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to update product")
		return
	}

	httpjson.JSON(w, http.StatusOK, input)
}

func (h *Handler) DeleteProduct(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if err := h.DB.Where("slug = ?", slug).Delete(&models.Product{}).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to delete product")
		return
	}
	httpjson.JSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *Handler) FeaturedProducts(w http.ResponseWriter, r *http.Request) {
	var products []models.Product
	if err := h.DB.Preload("Sizes").Preload("Attributes").Preload("Category").Preload("Subcategory").Preload("Brand").Where("featured = ?", true).Find(&products).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch featured products")
		return
	}
	httpjson.JSON(w, http.StatusOK, products)
}

func (h *Handler) RelatedProducts(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	var product models.Product
	if err := h.DB.Where("slug = ?", slug).First(&product).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "product not found")
		return
	}

	var related []models.Product
	err := h.DB.Preload("Sizes").Preload("Category").Preload("Subcategory").Preload("Brand").Where("category_id = ? AND slug <> ?", product.CategoryID, slug).Limit(4).Find(&related).Error
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch related products")
		return
	}

	httpjson.JSON(w, http.StatusOK, related)
}
