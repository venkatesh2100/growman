package middlewares

import (
	"log"
	"net/http"
	"strconv"
	"sync"
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
	// FailClosed rejects requests when the limiter cannot reach Redis,
	// rather than letting them through unlimited.
	//
	// Catalogue reads fail open: a Redis blip should not take the shop
	// offline. Anything that costs money or guards an account — login,
	// OTP sends (each one is a paid SMS), checkout — fails closed, because
	// the alternative is that a Redis outage silently removes every limit
	// at once, which is precisely when abuse is cheapest.
	FailClosed bool
}

// localLimiter is an in-process fallback so a Redis outage degrades the
// limit rather than removing it. Per-process, so the effective limit with
// N replicas is N times the configured one — still far better than none.
type localLimiter struct {
	mu      sync.Mutex
	counts  map[string]int64
	resetAt map[string]time.Time
}

func newLocalLimiter() *localLimiter {
	return &localLimiter{
		counts:  make(map[string]int64),
		resetAt: make(map[string]time.Time),
	}
}

// incr returns the count for key in the current window.
func (l *localLimiter) incr(key string, window time.Duration) int64 {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	if reset, ok := l.resetAt[key]; !ok || now.After(reset) {
		l.counts[key] = 0
		l.resetAt[key] = now.Add(window)
		// Opportunistic cleanup; these maps are keyed by IP and would
		// otherwise grow without bound over a long uptime.
		if len(l.counts) > 10000 {
			for k, r := range l.resetAt {
				if now.After(r) {
					delete(l.counts, k)
					delete(l.resetAt, k)
				}
			}
		}
	}
	l.counts[key]++
	return l.counts[key]
}

// RateLimiter rate-limits with a fixed Redis window, falling back to an
// in-process counter when Redis is unreachable.
func RateLimiter(config RateLimitConfig) func(next http.Handler) http.Handler {
	name := config.Name
	if name == "" {
		name = "api"
	}
	windowSec := int(config.Window.Seconds())
	if windowSec < 1 {
		windowSec = 1
	}
	fallback := newLocalLimiter()

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			identifier := ""
			if config.Identifier != nil {
				identifier = config.Identifier(r)
			}
			if identifier == "" {
				identifier = ClientIP(r)
			}
			key := "rl:" + name + ":" + identifier

			var n int64
			switch {
			case config.Redis == nil:
				if !config.FailClosed {
					next.ServeHTTP(w, r)
					return
				}
				// No Redis configured but this bucket must still be
				// limited — use the in-process counter.
				n = fallback.incr(key, config.Window)
			default:
				count, err := config.Redis.Eval(r.Context(), rateLimitLua, []string{key}, windowSec).Int64()
				if err != nil {
					if !config.FailClosed {
						next.ServeHTTP(w, r)
						return
					}
					log.Printf("[RATELIMIT] %s bucket falling back to in-process counter: %v", name, err)
					n = fallback.incr(key, config.Window)
				} else {
					n = count
				}
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

// NamedIPRateLimiter builds a client-IP-keyed limiter under its own bucket
// name, so unrelated route groups (auth, checkout, chat, ...) don't share a
// budget even for the same caller. Fails open on a Redis error — use
// StrictIPRateLimiter for buckets that must stay enforced.
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

// StrictIPRateLimiter is NamedIPRateLimiter that keeps enforcing through a
// Redis outage, for buckets where unlimited requests cost real money
// (OTP sends) or protect credentials (login).
func StrictIPRateLimiter(rdb *redis.Client, name string, limit int, window time.Duration) func(next http.Handler) http.Handler {
	return RateLimiter(RateLimitConfig{
		Redis:      rdb,
		Limit:      limit,
		Window:     window,
		Name:       name,
		FailClosed: true,
		Identifier: func(r *http.Request) string {
			return ClientIP(r)
		},
	})
}
