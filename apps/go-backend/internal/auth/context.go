package auth

import (
	"context"
	"net/http"
)

// contextKey avoids collisions with other context keys.
type contextKey string

const userCtxKey contextKey = "userClaims"

// SetUserContext stores claims in context.
func SetUserContext(ctx context.Context, claims *Claims) context.Context {
	return context.WithValue(ctx, userCtxKey, claims)
}

// FromContext extracts claims from context.
func FromContext(ctx context.Context) (*Claims, bool) {
	claims, ok := ctx.Value(userCtxKey).(*Claims)
	return claims, ok
}

// Require extracts claims set by AuthMiddleware. On failure — which shouldn't
// happen behind the middleware, but handlers are called directly in tests —
// it writes a 401 and returns false; callers should return immediately:
//
//	claims, ok := appauth.Require(w, r)
//	if !ok {
//		return
//	}
func Require(w http.ResponseWriter, r *http.Request) (*Claims, bool) {
	claims, ok := FromContext(r.Context())
	if !ok {
		writeAuthError(w, http.StatusUnauthorized, "unauthorized")
		return nil, false
	}
	return claims, true
}
