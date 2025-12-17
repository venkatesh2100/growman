package auth

import "context"

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
