package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestGenerateAndParseToken(t *testing.T) {
	tok, err := GenerateToken("secret", 42, "user", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := ParseToken("secret", tok)
	if err != nil {
		t.Fatal(err)
	}
	if claims.UserID != 42 || claims.Role != "user" {
		t.Fatalf("claims = %+v", claims)
	}
}

func TestParseTokenRejectsWrongAlg(t *testing.T) {
	// Header alg=none is a classic JWT bypass attempt.
	none := "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VySWQiOjEsInJvbGUiOiJhZG1pbiJ9."
	if _, err := ParseToken("secret", none); err == nil {
		t.Fatal("alg=none token should be rejected")
	}
}

func TestAdminMiddleware(t *testing.T) {
	okTok, _ := GenerateToken("secret", 1, "admin", time.Hour)
	userTok, _ := GenerateToken("secret", 2, "user", time.Hour)

	h := AdminMiddleware("secret")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodPost, "/products", nil)
	req.Header.Set("Authorization", "Bearer "+okTok)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("admin status = %d body=%s", rr.Code, rr.Body.String())
	}

	req2 := httptest.NewRequest(http.MethodPost, "/products", nil)
	req2.Header.Set("Authorization", "Bearer "+userTok)
	rr2 := httptest.NewRecorder()
	h.ServeHTTP(rr2, req2)
	if rr2.Code != http.StatusForbidden {
		t.Fatalf("user status = %d", rr2.Code)
	}
}

func TestIsAdminRole(t *testing.T) {
	if !IsAdminRole("admin") || !IsAdminRole("superadmin") || IsAdminRole("user") {
		t.Fatal("role checks failed")
	}
}
