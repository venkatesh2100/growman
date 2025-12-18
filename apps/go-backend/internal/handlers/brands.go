package handlers

import (
	"net/http"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
)

func (h *Handler) ListBrands(w http.ResponseWriter, r *http.Request) {
	var brands []models.Brand
	if err := h.DB.Find(&brands).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch brands")
		return
	}
	httpjson.JSON(w, http.StatusOK, brands)
}
