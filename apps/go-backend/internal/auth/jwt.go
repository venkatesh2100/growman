// Package auth issues and validates the JWTs that authenticate API
// requests, and provides the HTTP middleware (AuthMiddleware, AdminMiddleware,
// ...) that guards routes on them. Claims carry a Scope ("full" or
// "onboarding") in addition to the usual user ID/role — see
// internal/docs/02-auth.md.
package auth

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	ScopeFull       = "full"
	ScopeOnboarding = "onboarding"
)

// Claims represents JWT claims for the API.
type Claims struct {
	UserID uint   `json:"userId"`
	Role   string `json:"role"`
	Scope  string `json:"scope,omitempty"` // "full" (default) or "onboarding"
	jwt.RegisteredClaims
}

// GenerateToken issues a signed JWT for the given user ID and role (full scope).
func GenerateToken(secret string, userID uint, role string, ttl time.Duration) (string, error) {
	return GenerateTokenWithScope(secret, userID, role, ScopeFull, ttl)
}

// GenerateTokenWithScope issues a JWT with an explicit auth scope.
func GenerateTokenWithScope(secret string, userID uint, role, scope string, ttl time.Duration) (string, error) {
	if scope == "" {
		scope = ScopeFull
	}
	claims := &Claims{
		UserID: userID,
		Role:   role,
		Scope:  scope,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// IsAdminRole reports whether role can perform admin mutations.
func IsAdminRole(role string) bool {
	r := strings.ToLower(strings.TrimSpace(role))
	return r == "admin" || r == "superadmin"
}

// ParseToken validates a JWT string and returns claims.
func ParseToken(secret, tokenString string) (*Claims, error) {
	tok, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(secret), nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	if err != nil {
		return nil, err
	}

	if claims, ok := tok.Claims.(*Claims); ok && tok.Valid {
		if claims.Scope == "" {
			claims.Scope = ScopeFull
		}
		return claims, nil
	}

	return nil, errors.New("invalid token")
}

// AuthMiddleware requires a valid Bearer JWT (any scope).
func AuthMiddleware(secret string) func(http.Handler) http.Handler {
	return requireScope(secret, "")
}

// FullAuthMiddleware requires a full-scoped JWT (blocks onboarding tokens).
func FullAuthMiddleware(secret string) func(http.Handler) http.Handler {
	return requireScope(secret, ScopeFull)
}

// OnboardingAuthMiddleware requires an onboarding-scoped JWT.
func OnboardingAuthMiddleware(secret string) func(http.Handler) http.Handler {
	return requireScope(secret, ScopeOnboarding)
}

func requireScope(secret, required string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if header == "" {
				writeAuthError(w, http.StatusUnauthorized, "missing Authorization header")
				return
			}

			parts := strings.SplitN(header, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
				writeAuthError(w, http.StatusUnauthorized, "invalid Authorization header")
				return
			}

			claims, err := ParseToken(secret, parts[1])
			if err != nil {
				writeAuthError(w, http.StatusUnauthorized, "invalid token")
				return
			}

			if required == ScopeFull && claims.Scope == ScopeOnboarding {
				writeAuthError(w, http.StatusForbidden, "complete your profile first")
				return
			}
			if required == ScopeOnboarding && claims.Scope != ScopeOnboarding {
				writeAuthError(w, http.StatusForbidden, "invalid token scope")
				return
			}

			ctx := SetUserContext(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// AdminMiddleware requires a valid JWT with an admin role.
func AdminMiddleware(secret string) func(http.Handler) http.Handler {
	auth := AuthMiddleware(secret)
	return func(next http.Handler) http.Handler {
		return auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := FromContext(r.Context())
			if !ok || !IsAdminRole(claims.Role) {
				writeAuthError(w, http.StatusForbidden, "admin access required")
				return
			}
			next.ServeHTTP(w, r)
		}))
	}
}

func writeAuthError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(`{"error":"` + msg + `"}`))
}
