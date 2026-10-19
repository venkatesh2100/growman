package handlers

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
)

// readinessTimeout bounds dependency checks so a hung database cannot
// make the probe itself hang — a probe that never answers is treated as a
// failure by most orchestrators anyway, but slowly and unhelpfully.
const readinessTimeout = 2 * time.Second

// Health is the liveness probe: it reports only that the process is up and
// serving, with no dependency checks. Use /readyz to decide whether to
// route traffic here.
func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	httpjson.JSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"service": "go-backend",
	})
}

// Ready is the readiness probe. It returns 503 when Postgres is
// unreachable, because a worker that cannot query the database cannot
// serve a request and should be taken out of rotation.
//
// Redis is reported but never fatal: the whole codebase treats it as
// optional (caching falls back to the in-process layer, rate limiting
// degrades), so a Redis outage is "degraded", not "down".
func (h *Handler) Ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), readinessTimeout)
	defer cancel()

	checks := map[string]string{}
	status := http.StatusOK
	overall := "ok"

	sqlDB, err := h.DB.DB()
	switch {
	case err != nil:
		checks["postgres"] = "error: " + err.Error()
		status, overall = http.StatusServiceUnavailable, "down"
	default:
		if err := sqlDB.PingContext(ctx); err != nil {
			checks["postgres"] = "error: " + err.Error()
			status, overall = http.StatusServiceUnavailable, "down"
		} else {
			checks["postgres"] = "ok"
			stats := sqlDB.Stats()
			checks["postgres_conns"] = fmt.Sprintf("%d in use, %d idle", stats.InUse, stats.Idle)
		}
	}

	if h.Redis == nil {
		checks["redis"] = "not configured"
	} else if err := h.Redis.Ping(ctx).Err(); err != nil {
		checks["redis"] = "error: " + err.Error()
		if overall == "ok" {
			overall = "degraded"
		}
	} else {
		checks["redis"] = "ok"
	}

	if h.ImageService == nil {
		checks["images"] = "not configured"
	} else {
		checks["images"] = "ok"
	}

	httpjson.JSON(w, status, map[string]any{
		"status":  overall,
		"service": "go-backend",
		"checks":  checks,
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
