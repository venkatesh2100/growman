package handlers

import (
	"net/http"
	"time"
	"os"

	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
)

// Health provides a simple readiness check.
func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	httpjson.JSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"service": "go-backend",
	})
}
func (h *Handler) Version(w http.ResponseWriter, r *http.Request) {
	ist := time.FixedZone("IST", 5*60*60+30*60) // UTC+5:30
	httpjson.JSON(w, http.StatusOK, map[string]string{
		"server_time": time.Now().In(ist).Format(time.RFC3339),
		"built_at":    "2026-03-09-v2",
		"git":         os.Getenv("GIT_COMMIT"),
	})
}