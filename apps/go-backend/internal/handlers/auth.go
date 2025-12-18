package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
)

// AuthRequest captures minimal login input.
type AuthRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// AuthResponse contains a signed JWT.
type AuthResponse struct {
	Token string `json:"token"`
}

// Login is a placeholder JWT login that validates against a seeded user row.
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var payload AuthRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid payload")
		return
	}

	var user models.User
	if err := h.DB.Where("email = ?", payload.Email).First(&user).Error; err != nil {
		httpjson.Error(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	// NOTE: This is a placeholder; replace with hashed password validation.
	if payload.Password == "" {
		httpjson.Error(w, http.StatusUnauthorized, "password required")
		return
	}

	token, err := appauth.GenerateToken(h.Cfg.JWTSecret, user.ID, user.Role, 24*time.Hour)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "token issue failed")
		return
	}

	httpjson.JSON(w, http.StatusOK, AuthResponse{Token: token})
}

// Me returns the authenticated user claims if present.
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.FromContext(r.Context())
	if !ok {
		httpjson.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	// Only return claims for now; extend with DB lookup if needed.
	httpjson.JSON(w, http.StatusOK, map[string]any{
		"userId": claims.UserID,
		"role":   claims.Role,
	})
}
