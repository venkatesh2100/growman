package middlewares

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// With no Redis, a fail-open bucket must stay fully open (a cache outage
// should not take the catalogue offline) while a fail-closed bucket keeps
// enforcing from the in-process counter.
func TestRateLimiterRedisUnavailable(t *testing.T) {
	tests := []struct {
		name         string
		failClosed   bool
		requests     int
		wantAllowed  int
		wantThrottle bool
	}{
		{"fail open lets everything through", false, 10, 10, false},
		{"fail closed still enforces", true, 10, 3, true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			limiter := RateLimiter(RateLimitConfig{
				Redis:      nil,
				Limit:      3,
				Window:     time.Minute,
				Name:       "test-" + tc.name,
				FailClosed: tc.failClosed,
				Identifier: func(*http.Request) string { return "1.2.3.4" },
			})

			handler := limiter(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			}))

			allowed, throttled := 0, 0
			for range tc.requests {
				rec := httptest.NewRecorder()
				handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/auth/login", nil))
				switch rec.Code {
				case http.StatusOK:
					allowed++
				case http.StatusTooManyRequests:
					throttled++
				default:
					t.Fatalf("unexpected status %d", rec.Code)
				}
			}

			if allowed != tc.wantAllowed {
				t.Errorf("allowed %d requests, want %d", allowed, tc.wantAllowed)
			}
			if (throttled > 0) != tc.wantThrottle {
				t.Errorf("throttled %d requests, wantThrottle=%v", throttled, tc.wantThrottle)
			}
		})
	}
}

// Separate callers must not share a budget, or one abusive IP would lock
// out every other customer.
func TestRateLimiterIsolatesIdentifiers(t *testing.T) {
	var currentIP string
	limiter := RateLimiter(RateLimitConfig{
		Limit:      2,
		Window:     time.Minute,
		Name:       "isolation",
		FailClosed: true,
		Identifier: func(*http.Request) string { return currentIP },
	})
	handler := limiter(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	call := func() int {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/auth/login", nil))
		return rec.Code
	}

	currentIP = "10.0.0.1"
	call()
	call()
	if code := call(); code != http.StatusTooManyRequests {
		t.Fatalf("third request from the same IP: got %d, want 429", code)
	}

	currentIP = "10.0.0.2"
	if code := call(); code != http.StatusOK {
		t.Fatalf("first request from a different IP: got %d, want 200", code)
	}
}

func TestLocalLimiterWindowExpiry(t *testing.T) {
	l := newLocalLimiter()
	window := 50 * time.Millisecond

	if n := l.incr("k", window); n != 1 {
		t.Fatalf("first incr = %d, want 1", n)
	}
	if n := l.incr("k", window); n != 2 {
		t.Fatalf("second incr = %d, want 2", n)
	}

	time.Sleep(window + 10*time.Millisecond)

	if n := l.incr("k", window); n != 1 {
		t.Fatalf("incr after the window elapsed = %d, want the counter to have reset to 1", n)
	}
}
