package middlewares

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSecurityHeaders(t *testing.T) {
	h := SecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing nosniff")
	}
	if rr.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatal("missing frame options")
	}
}

func TestMaxBytesRejectsHugeBody(t *testing.T) {
	h := MaxBytes(8)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf := make([]byte, 64)
		_, err := r.Body.Read(buf)
		if err == nil {
			w.WriteHeader(http.StatusOK)
			return
		}
		http.Error(w, "too large", http.StatusRequestEntityTooLarge)
	}))
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("0123456789abcdef"))
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code == http.StatusOK {
		t.Fatal("expected oversized body to fail")
	}
}

func TestClientIPPrefersCloudflare(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.1:1234"
	req.Header.Set("CF-Connecting-IP", "203.0.113.9")
	if got := ClientIP(req); got != "203.0.113.9" {
		t.Fatalf("got %s", got)
	}
}

func TestExactIPUsesProxyAppendedAddress(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "169.254.1.1:443"
	// The first hop is whatever the caller typed. Cloud Run appends the
	// address it actually accepted the connection from.
	req.Header.Set("X-Forwarded-For", "8.8.8.8, 10.0.0.4, 49.36.14.20")
	req.Header.Set("CF-Connecting-IP", "203.0.113.9")
	if got := ExactIP(req); got != "49.36.14.20" {
		t.Fatalf("got %s", got)
	}
}

func TestExactIPIgnoresPrivatePeer(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "127.0.0.1:4321"
	if ExactIP(req) != "" {
		t.Fatal("loopback should not be reported as a visitor IP")
	}
}
