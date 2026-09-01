package middlewares

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-redis/redis/v8"
)

const rateLimitLua = `
local n = redis.call("INCR", KEYS[1])
if n == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return n
`

// RateLimitConfig holds rate limiting configuration.
type RateLimitConfig struct {
	Redis      *redis.Client
	Limit      int
	Window     time.Duration
	Name       string
	Identifier func(*http.Request) string
}

// RateLimiter rate-limits with a fixed Redis window. Fail-open if Redis is unavailable.
func RateLimiter(config RateLimitConfig) func(next http.Handler) http.Handler {
	name := config.Name
	if name == "" {
		name = "api"
	}
	windowSec := int(config.Window.Seconds())
	if windowSec < 1 {
		windowSec = 1
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if config.Redis == nil {
				next.ServeHTTP(w, r)
				return
			}

			identifier := ""
			if config.Identifier != nil {
				identifier = config.Identifier(r)
			}
			if identifier == "" {
				identifier = ClientIP(r)
			}

			key := "rl:" + name + ":" + identifier
			n, err := config.Redis.Eval(r.Context(), rateLimitLua, []string{key}, windowSec).Int64()
			if err != nil {
				next.ServeHTTP(w, r)
				return
			}

			w.Header().Set("X-RateLimit-Limit", strconv.Itoa(config.Limit))
			remaining := config.Limit - int(n)
			if remaining < 0 {
				remaining = 0
			}
			w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(remaining))
			w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(time.Now().Add(config.Window).Unix(), 10))

			if n > int64(config.Limit) {
				w.Header().Set("Retry-After", strconv.Itoa(windowSec))
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusTooManyRequests)
				_, _ = w.Write([]byte(`{"error":"rate limit exceeded"}`))
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// IPRateLimiter creates a named limiter keyed by client IP.
func IPRateLimiter(redis *redis.Client, limit int, window time.Duration) func(next http.Handler) http.Handler {
	return NamedIPRateLimiter(redis, "api", limit, window)
}

func NamedIPRateLimiter(rdb *redis.Client, name string, limit int, window time.Duration) func(next http.Handler) http.Handler {
	return RateLimiter(RateLimitConfig{
		Redis:  rdb,
		Limit:  limit,
		Window: window,
		Name:   name,
		Identifier: func(r *http.Request) string {
			return ClientIP(r)
		},
	})
}
