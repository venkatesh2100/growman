package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"gorm.io/gorm"
)

func (h *Handler) ListCategories(w http.ResponseWriter, r *http.Request) {
	var categories []models.Category
	if err := h.DB.Preload("Subcategories").Find(&categories).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch categories")
		return
	}
	httpjson.JSON(w, http.StatusOK, categories)
}

func (h *Handler) GetCategory(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	var category models.Category
	if err := h.DB.Preload("Subcategories").Where("slug = ?", slug).First(&category).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			httpjson.Error(w, http.StatusNotFound, "category not found")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch category")
		return
	}
	httpjson.JSON(w, http.StatusOK, category)
}

func (h *Handler) ListSubcategories(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	var category models.Category
	if err := h.DB.Where("slug = ?", slug).First(&category).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "category not found")
		return
	}

	var subcategories []models.Subcategory
	if err := h.DB.Where("category_id = ?", category.ID).Find(&subcategories).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch subcategories")
		return
	}
	httpjson.JSON(w, http.StatusOK, subcategories)
}

func (h *Handler) ProductsByCategory(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	var category models.Category
	if err := h.DB.Where("slug = ?", slug).First(&category).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "category not found")
		return
	}

	var products []models.Product
	if err := h.DB.Preload("Sizes").Preload("Attributes").Preload("Category").Preload("Subcategory").Preload("Brand").Where("category_id = ?", category.ID).Find(&products).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch products")
		return
	}
	httpjson.JSON(w, http.StatusOK, products)
}

func (h *Handler) ProductsBySubcategory(w http.ResponseWriter, r *http.Request) {
	catSlug := chi.URLParam(r, "slug")
	subSlug := chi.URLParam(r, "subSlug")

	var category models.Category
	if err := h.DB.Where("slug = ?", catSlug).First(&category).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "category not found")
		return
	}

	var subcategory models.Subcategory
	if err := h.DB.Where("slug = ? AND category_id = ?", subSlug, category.ID).First(&subcategory).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "subcategory not found")
		return
	}

	var products []models.Product
	if err := h.DB.Preload("Sizes").Preload("Attributes").Preload("Category").Preload("Subcategory").Preload("Brand").Where("subcategory_id = ?", subcategory.ID).Find(&products).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch products")
		return
	}

	httpjson.JSON(w, http.StatusOK, products)
}
