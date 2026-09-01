package handlers

import (
	"encoding/json"
	"net/http"
	"sort"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/cache"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
)

type catalogResponse struct {
	Tags       []string          `json:"tags"`
	Categories []models.Category `json:"categories"`
}

func (h *Handler) listProductTags() ([]string, error) {
	var tags []string
	if err := h.DB.Raw(`
		SELECT DISTINCT t
		FROM products p
		CROSS JOIN LATERAL unnest(p.tags) AS t
		WHERE t IS NOT NULL AND btrim(t) <> ''
		ORDER BY t
	`).Scan(&tags).Error; err != nil {
		return nil, err
	}
	if tags == nil {
		tags = []string{}
	}
	sort.Strings(tags)
	return tags, nil
}

func (h *Handler) ListTags(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	raw, err := h.Cache.GetOrLoadRaw(ctx, cache.KeyPrefixTags, cache.TagsTTL, func() ([]byte, error) {
		tags, err := h.listProductTags()
		if err != nil {
			return nil, err
		}
		return json.Marshal(tags)
	})
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch tags")
		return
	}
	cache.ServePublic(w, r, raw)
}

func (h *Handler) ListCatalog(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	raw, err := h.Cache.GetOrLoadRaw(ctx, cache.KeyPrefixCatalog, cache.CatalogTTL, func() ([]byte, error) {
		tags, err := h.listProductTags()
		if err != nil {
			return nil, err
		}
		var categories []models.Category
		if err := h.db(ctx).Preload("Subcategories").Order("name asc").Find(&categories).Error; err != nil {
			return nil, err
		}
		return json.Marshal(catalogResponse{Tags: tags, Categories: categories})
	})
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch catalog")
		return
	}
	cache.ServePublic(w, r, raw)
}
