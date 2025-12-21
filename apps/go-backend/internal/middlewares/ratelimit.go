package middlewares

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-redis/redis/v8"
)

// RateLimitConfig holds rate limiting configuration
type RateLimitConfig struct {
	Redis      *redis.Client
	Limit      int           // Number of requests allowed
	Window     time.Duration // Time window for rate limit
	Identifier func(*http.Request) string // Function to extract identifier (IP, user ID, etc.)
}

// RateLimiter returns a middleware that rate limits requests using Redis
func RateLimiter(config RateLimitConfig) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if config.Redis == nil {
				// If Redis is not available, skip rate limiting
				next.ServeHTTP(w, r)
				return
			}

			// Get identifier (default to IP address)
			identifier := config.Identifier(r)
			if identifier == "" {
				identifier = middleware.GetReqID(r.Context())
				if identifier == "" {
					identifier = r.RemoteAddr
				}
			}

			// Create rate limit key
			key := "ratelimit:" + identifier
			ctx := context.Background()

			// Use Redis INCR with expiration
			pipe := config.Redis.Pipeline()
			incr := pipe.Incr(ctx, key)
			pipe.Expire(ctx, key, config.Window)
			_, err := pipe.Exec(ctx)

			if err != nil {
				// If Redis fails, allow the request (fail open)
				next.ServeHTTP(w, r)
				return
			}

			count := incr.Val()

			// Set rate limit headers
			w.Header().Set("X-RateLimit-Limit", strconv.Itoa(config.Limit))
			remaining := config.Limit - int(count)
			if remaining < 0 {
				remaining = 0
			}
			w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(remaining))
			w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(time.Now().Add(config.Window).Unix(), 10))

			// Check if limit exceeded
			if count > int64(config.Limit) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusTooManyRequests)
				w.Write([]byte(`{"error":"rate limit exceeded"}`))
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// IPRateLimiter creates a rate limiter that uses IP address as identifier
func IPRateLimiter(redis *redis.Client, limit int, window time.Duration) func(next http.Handler) http.Handler {
	return RateLimiter(RateLimitConfig{
		Redis:  redis,
		Limit:  limit,
		Window: window,
		Identifier: func(r *http.Request) string {
			// Try to get real IP from headers (for proxies/load balancers)
			ip := r.Header.Get("X-Forwarded-For")
			if ip == "" {
				ip = r.Header.Get("X-Real-Ip")
			}
			if ip == "" {
				ip = r.RemoteAddr
			}
			return ip
		},
	})
}

