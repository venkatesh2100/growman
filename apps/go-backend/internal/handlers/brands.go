package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/cache"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
)

func (h *Handler) ListBrands(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	raw, err := h.Cache.GetOrLoadRaw(ctx, cache.KeyPrefixBrands, cache.BrandsTTL, func() ([]byte, error) {
		var brands []models.Brand
		if err := h.db(ctx).Order("name ASC").Find(&brands).Error; err != nil {
			return nil, err
		}
		return json.Marshal(brands)
	})
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch brands")
		return
	}
	cache.ServePublic(w, r, raw)
}
