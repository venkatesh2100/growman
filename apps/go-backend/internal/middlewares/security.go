// Package middlewares holds this API's chi middleware: security headers and
// body-size limits (this file), Redis-backed rate limiting (ratelimit.go),
// client-IP resolution (ip.go), and Prometheus timing (prometheus.go).
package middlewares

import (
	"log"
	"net/http"
	"strings"
	"time"

	chiware "github.com/go-chi/chi/v5/middleware"
)

// defaultMaxBody is the fallback cap MaxBytes uses when called with n<=0.
const defaultMaxBody = 1 << 20 // 1 MiB, generous for a JSON API body

// SecurityHeaders adds conservative defaults for an API.
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("X-XSS-Protection", "0")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
			h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
		}
		next.ServeHTTP(w, r)
	})
}

// MaxBytes rejects oversized request bodies. Skip GET/HEAD/OPTIONS.
func MaxBytes(n int64) func(http.Handler) http.Handler {
	if n <= 0 {
		n = defaultMaxBody
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions, http.MethodDelete:
				next.ServeHTTP(w, r)
				return
			}
			if r.Body != nil {
				r.Body = http.MaxBytesReader(w, r.Body, n)
			}
			next.ServeHTTP(w, r)
		})
	}
}

// QuietLogger logs only server errors (5xx) and slow requests.
// Expected 4xx (auth, validation, rate limits) are silent to keep hot paths cheap.
func QuietLogger(slow time.Duration) func(http.Handler) http.Handler {
	if slow <= 0 {
		slow = 1500 * time.Millisecond
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path
			if path == "/healthz" || path == "/api/v1/healthz" {
				next.ServeHTTP(w, r)
				return
			}
			ww := chiware.NewWrapResponseWriter(w, r.ProtoMajor)
			start := time.Now()
			next.ServeHTTP(ww, r)
			d := time.Since(start)
			status := ww.Status()
			if status >= 500 || d >= slow {
				log.Printf("%s %s %d %s", r.Method, path, status, d)
			}
		})
	}
}
