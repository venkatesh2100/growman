package middlewares

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chiware "github.com/go-chi/chi/v5/middleware"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/metrics"
)

// Prometheus records request latency and throughput metrics for Grafana dashboards.
func Prometheus(appName string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path
			if path == "/metrics" || path == "/healthz" || path == "/api/v1/healthz" {
				next.ServeHTTP(w, r)
				return
			}

			start := time.Now()
			ww := chiware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)

			uri := chi.RouteContext(r.Context()).RoutePattern()
			if uri == "" {
				uri = path
			}

			status := ww.Status()
			if status == 0 {
				status = http.StatusOK
			}

			metrics.RecordRequest(appName, uri, r.Method, status, time.Since(start).Seconds())
		})
	}
}
