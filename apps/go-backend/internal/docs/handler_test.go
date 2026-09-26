package docs

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestServeSpec(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/openapi.yaml", nil)
	rr := httptest.NewRecorder()
	ServeSpec(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	body := rr.Body.String()
	if !strings.HasPrefix(body, "openapi: 3.0.3") {
		t.Fatalf("spec missing openapi header")
	}
	for _, path := range []string{
		"/api/v1/auth/login",
		"/api/v1/products",
		"/api/v1/checkout/create-order",
		"/api/v1/wishlist",
		"/webhooks/razorpay",
	} {
		if !strings.Contains(body, path) {
			t.Errorf("spec missing path %s", path)
		}
	}
}

func TestServeUI(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/docs", nil)
	rr := httptest.NewRecorder()
	ServeUI(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); !strings.Contains(ct, "text/html") {
		t.Fatalf("content-type = %q", ct)
	}
	if !strings.Contains(rr.Body.String(), "swagger-ui") {
		t.Fatal("ui html missing swagger-ui")
	}
}

func TestServeRedoc(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/redoc", nil)
	rr := httptest.NewRecorder()
	ServeRedoc(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "redoc") {
		t.Fatal("redoc html missing redoc")
	}
}

func TestRedirectDocs(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/swagger", nil)
	rr := httptest.NewRecorder()
	RedirectDocs(rr, req)
	if rr.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302", rr.Code)
	}
	if loc := rr.Header().Get("Location"); loc != "/docs" {
		t.Fatalf("location = %q, want /docs", loc)
	}
}
