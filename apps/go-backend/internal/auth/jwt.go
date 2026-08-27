package auth

import (
	"errors"
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

// ParseToken validates a JWT string and returns claims.
func ParseToken(secret, tokenString string) (*Claims, error) {
	tok, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	})
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
				http.Error(w, "missing Authorization header", http.StatusUnauthorized)
				return
			}

			parts := strings.SplitN(header, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
				http.Error(w, "invalid Authorization header", http.StatusUnauthorized)
				return
			}

			claims, err := ParseToken(secret, parts[1])
			if err != nil {
				http.Error(w, "invalid token", http.StatusUnauthorized)
				return
			}

			if required == ScopeFull && claims.Scope == ScopeOnboarding {
				http.Error(w, "complete your profile first", http.StatusForbidden)
				return
			}
			if required == ScopeOnboarding && claims.Scope != ScopeOnboarding {
				http.Error(w, "invalid token scope", http.StatusForbidden)
				return
			}

			ctx := SetUserContext(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
