package handlers

import (
	"net/http"

	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
)

// Health provides a simple readiness check.
func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	httpjson.JSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"service": "go-backend",
	})
}
