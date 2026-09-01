package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/cache"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"gorm.io/gorm"
)

func (h *Handler) ListCategories(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	raw, err := h.Cache.GetOrLoadRaw(ctx, cache.KeyPrefixAllCategories, cache.AllCategoriesTTL, func() ([]byte, error) {
		var categories []models.Category
		if err := h.db(ctx).Preload("Subcategories").Order("name ASC").Find(&categories).Error; err != nil {
			return nil, err
		}
		return json.Marshal(categories)
	})
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch categories")
		return
	}
	cache.ServePublic(w, r, raw)
}

func (h *Handler) GetCategory(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	ctx := r.Context()
	key := cache.KeyPrefixCategoryDetail + slug
	raw, err := h.Cache.GetOrLoadRaw(ctx, key, cache.CategoryDetailTTL, func() ([]byte, error) {
		var category models.Category
		if err := h.db(ctx).Preload("Subcategories").Where("slug = ?", slug).First(&category).Error; err != nil {
			return nil, err
		}
		return json.Marshal(category)
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			httpjson.Error(w, http.StatusNotFound, "category not found")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch category")
		return
	}
	cache.ServePublic(w, r, raw)
}

func (h *Handler) ListSubcategories(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	ctx := r.Context()
	key := cache.KeyPrefixSubcategories + slug
	raw, err := h.Cache.GetOrLoadRaw(ctx, key, cache.CategoryDetailTTL, func() ([]byte, error) {
		var category models.Category
		if err := h.db(ctx).Select("id", "slug").Where("slug = ?", slug).First(&category).Error; err != nil {
			return nil, err
		}
		var subcategories []models.Subcategory
		if err := h.db(ctx).Where("category_id = ?", category.ID).Order("name ASC").Find(&subcategories).Error; err != nil {
			return nil, err
		}
		return json.Marshal(subcategories)
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			httpjson.Error(w, http.StatusNotFound, "category not found")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch subcategories")
		return
	}
	cache.ServePublic(w, r, raw)
}

func (h *Handler) ProductsByCategory(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	ctx := r.Context()
	key := cache.KeyPrefixCatProducts + slug
	raw, err := h.Cache.GetOrLoadRaw(ctx, key, 10*time.Minute, func() ([]byte, error) {
		var category models.Category
		if err := h.db(ctx).Select("id", "slug").Where("slug = ?", slug).First(&category).Error; err != nil {
			return nil, err
		}
		var products []models.Product
		if err := h.productCardQuery(ctx).
			Where("category_id = ?", category.ID).
			Order("created_at DESC").
			Limit(200).
			Find(&products).Error; err != nil {
			return nil, err
		}
		h.ResolveProductImageURLsSlice(products)
		return json.Marshal(products)
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			httpjson.Error(w, http.StatusNotFound, "category not found")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch products")
		return
	}
	cache.ServePublic(w, r, raw)
}

func (h *Handler) ProductsBySubcategory(w http.ResponseWriter, r *http.Request) {
	catSlug := chi.URLParam(r, "slug")
	subSlug := chi.URLParam(r, "subSlug")
	ctx := r.Context()
	key := cache.KeyPrefixSubcatProducts + catSlug + ":" + subSlug
	raw, err := h.Cache.GetOrLoadRaw(ctx, key, 10*time.Minute, func() ([]byte, error) {
		var category models.Category
		if err := h.db(ctx).Select("id", "slug").Where("slug = ?", catSlug).First(&category).Error; err != nil {
			return nil, err
		}
		var subcategory models.Subcategory
		if err := h.db(ctx).Select("id", "slug", "category_id").Where("slug = ? AND category_id = ?", subSlug, category.ID).First(&subcategory).Error; err != nil {
			return nil, err
		}
		var products []models.Product
		if err := h.productCardQuery(ctx).
			Where("subcategory_id = ?", subcategory.ID).
			Order("created_at DESC").
			Limit(200).
			Find(&products).Error; err != nil {
			return nil, err
		}
		h.ResolveProductImageURLsSlice(products)
		return json.Marshal(products)
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			httpjson.Error(w, http.StatusNotFound, "category not found")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch products")
		return
	}
	cache.ServePublic(w, r, raw)
}
