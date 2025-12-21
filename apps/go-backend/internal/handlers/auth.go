package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/services"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"golang.org/x/crypto/bcrypt"
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

// Login supports email OR phone + password login
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var payload AuthRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid payload")
		return
	}

	if payload.Password == "" {
		httpjson.Error(w, http.StatusUnauthorized, "password required")
		return
	}

	var user models.User
	// Check if identifier is email or phone
	if strings.Contains(payload.Email, "@") {
		// Email login
		if err := h.DB.Where("email = ?", payload.Email).First(&user).Error; err != nil {
			httpjson.Error(w, http.StatusUnauthorized, "invalid credentials")
			return
		}
	} else {
		// Phone login
		if err := h.DB.Where("phone = ?", payload.Email).First(&user).Error; err != nil {
			httpjson.Error(w, http.StatusUnauthorized, "invalid credentials")
			return
		}
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(payload.Password)); err != nil {
		httpjson.Error(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	token, err := appauth.GenerateToken(h.Cfg.JWTSecret, user.ID, user.Role, 24*time.Hour)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "token issue failed")
		return
	}

	httpjson.JSON(w, http.StatusOK, AuthResponse{Token: token})
}

// SignupRequest represents signup input
type SignupRequest struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Phone    string `json:"phone"`
	Password string `json:"password"`
}

// Signup creates a new user account
func (h *Handler) Signup(w http.ResponseWriter, r *http.Request) {
	var payload SignupRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid payload")
		return
	}

	// Validate input
	if payload.Name == "" {
		httpjson.Error(w, http.StatusBadRequest, "name is required")
		return
	}
	if payload.Email == "" || !strings.Contains(payload.Email, "@") {
		httpjson.Error(w, http.StatusBadRequest, "valid email is required")
		return
	}
	if payload.Phone == "" {
		httpjson.Error(w, http.StatusBadRequest, "phone is required")
		return
	}
	if len(payload.Password) < 6 {
		httpjson.Error(w, http.StatusBadRequest, "password must be at least 6 characters")
		return
	}

	// Check if user already exists
	var existingUser models.User
	if err := h.DB.Where("email = ? OR phone = ?", payload.Email, payload.Phone).First(&existingUser).Error; err == nil {
		httpjson.Error(w, http.StatusConflict, "user with this email or phone already exists")
		return
	}

	// Hash password
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(payload.Password), bcrypt.DefaultCost)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to create account")
		return
	}

	// Create user
	user := models.User{
		Name:          payload.Name,
		Email:         payload.Email,
		Phone:         payload.Phone,
		PasswordHash:  string(passwordHash),
		EmailVerified: false, // User needs to verify email
		Provider:      "local",
		Role:          "user",
	}

	if err := h.DB.Create(&user).Error; err != nil {
		log.Printf("[AUTH] Error creating user: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to create account")
		return
	}

	// Generate token
	token, err := appauth.GenerateToken(h.Cfg.JWTSecret, user.ID, user.Role, 24*time.Hour)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "token issue failed")
		return
	}

	httpjson.JSON(w, http.StatusOK, AuthResponse{Token: token})
}

// CheckUserExists checks if a user exists by email or phone
func (h *Handler) CheckUserExists(w http.ResponseWriter, r *http.Request) {
	email := r.URL.Query().Get("email")
	phone := r.URL.Query().Get("phone")

	if email == "" && phone == "" {
		httpjson.Error(w, http.StatusBadRequest, "email or phone is required")
		return
	}

	var user models.User
	query := h.DB
	if email != "" {
		query = query.Where("email = ?", email)
	}
	if phone != "" {
		if email != "" {
			query = query.Or("phone = ?", phone)
		} else {
			query = query.Where("phone = ?", phone)
		}
	}

	exists := query.First(&user).Error == nil

	httpjson.JSON(w, http.StatusOK, map[string]interface{}{
		"exists": exists,
		"email":  user.Email,
		"phone":  user.Phone,
	})
}

// Me returns the authenticated user data
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.FromContext(r.Context())
	if !ok {
		httpjson.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	// Fetch user from database
	var user models.User
	if err := h.DB.First(&user, claims.UserID).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "user not found")
		return
	}

	// Return user data (excluding sensitive fields)
	httpjson.JSON(w, http.StatusOK, map[string]any{
		"id":            user.ID,
		"name":          user.Name,
		"email":         user.Email,
		"phone":         user.Phone,
		"emailVerified": user.EmailVerified,
		"role":          user.Role,
		"address": map[string]any{
			"line":      user.AddressLine,
			"city":      user.City,
			"state":     user.State,
			"pincode":   user.Pincode,
			"country":   user.Country,
			"latitude":  user.Latitude,
			"longitude": user.Longitude,
		},
	})
}

// GoogleAuthRequest contains the Google OAuth access token
type GoogleAuthRequest struct {
	Token string `json:"token"`
}

// GoogleUserInfo represents user info from Google
type GoogleUserInfo struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	VerifiedEmail bool   `json:"verified_email"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
}

// Google handles Google OAuth login/signup
func (h *Handler) Google(w http.ResponseWriter, r *http.Request) {
	var payload GoogleAuthRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid payload")
		return
	}

	if payload.Token == "" {
		httpjson.Error(w, http.StatusBadRequest, "token is required")
		return
	}

	// Verify token with Google and get user info
	googleUser, err := h.verifyGoogleToken(payload.Token)
	if err != nil {
		log.Printf("[AUTH] Google token verification failed: %v", err)
		httpjson.Error(w, http.StatusUnauthorized, "invalid google token")
		return
	}

	// Check if user exists by email
	var user models.User
	if err := h.DB.Where("email = ?", googleUser.Email).First(&user).Error; err != nil {
		// User doesn't exist, create new account
		user = models.User{
			Name:          googleUser.Name,
			Email:         googleUser.Email,
			Phone:         "", // Google doesn't provide phone
			PasswordHash:  "", // No password for OAuth users
			EmailVerified: googleUser.VerifiedEmail,
			Provider:      "google",
			Role:          "user",
		}

		if err := h.DB.Create(&user).Error; err != nil {
			log.Printf("[AUTH] Error creating Google user: %v", err)
			httpjson.Error(w, http.StatusInternalServerError, "failed to create account")
			return
		}
	} else {
		// User exists, update provider if needed
		if user.Provider != "google" {
			user.Provider = "google"
			user.EmailVerified = googleUser.VerifiedEmail
			if user.Name == "" {
				user.Name = googleUser.Name
			}
			h.DB.Save(&user)
		}
	}

	// Generate JWT token
	token, err := appauth.GenerateToken(h.Cfg.JWTSecret, user.ID, user.Role, 24*time.Hour)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "token issue failed")
		return
	}

	httpjson.JSON(w, http.StatusOK, AuthResponse{Token: token})
}

// GoogleSignup handles Google OAuth signup (same as login, but explicit)
func (h *Handler) GoogleSignup(w http.ResponseWriter, r *http.Request) {
	// Google signup is the same as login - if user exists, login; if not, create
	h.Google(w, r)
}

// verifyGoogleToken verifies the Google OAuth token and returns user info
func (h *Handler) verifyGoogleToken(accessToken string) (*GoogleUserInfo, error) {
	// Make request to Google's userinfo endpoint
	req, err := http.NewRequest("GET", "https://www.googleapis.com/oauth2/v2/userinfo", nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, errors.New("google token verification failed")
	}

	var userInfo GoogleUserInfo
	if err := json.NewDecoder(resp.Body).Decode(&userInfo); err != nil {
		return nil, err
	}

	if userInfo.Email == "" {
		return nil, errors.New("email not provided by google")
	}

	return &userInfo, nil
}

// PasswordResetRequest represents request to send password reset OTP
type PasswordResetRequest struct {
	Email string `json:"email"`
}

// SendPasswordResetOTP sends an OTP to user's email for password reset
func (h *Handler) SendPasswordResetOTP(w http.ResponseWriter, r *http.Request) {
	var req PasswordResetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate email
	if req.Email == "" || !strings.Contains(req.Email, "@") {
		httpjson.Error(w, http.StatusBadRequest, "valid email is required")
		return
	}

	// Check if user exists
	var user models.User
	if err := h.DB.Where("email = ?", req.Email).First(&user).Error; err != nil {
		// Don't reveal if user exists or not for security
		httpjson.JSON(w, http.StatusOK, map[string]interface{}{
			"message": "If an account exists with this email, a password reset code has been sent",
		})
		return
	}

	// Check rate limiting (1 OTP per 60 seconds)
	otpService := services.NewOTPService(h.Redis)
	ctx := context.Background()

	exists, err := otpService.CheckPasswordResetOTPExists(ctx, req.Email)
	if err == nil && exists {
		httpjson.Error(w, http.StatusTooManyRequests, "please wait before requesting another OTP")
		return
	}

	// Generate and send OTP
	otp, err := otpService.GeneratePasswordResetOTP(ctx, req.Email)
	if err != nil {
		log.Printf("[PASSWORD RESET] Error generating OTP: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to generate OTP")
		return
	}

	// Send email
	emailService := services.NewEmailService(h.Cfg.SMTPHost, h.Cfg.SMTPPort, h.Cfg.SMTPEmail, h.Cfg.SMTPPassword)
	if err := emailService.SendPasswordResetOTP(req.Email, otp); err != nil {
		log.Printf("[PASSWORD RESET] Error sending OTP email: %v", err)
		// Don't fail the request if email fails, but log it
	}

	httpjson.JSON(w, http.StatusOK, map[string]interface{}{
		"message": "If an account exists with this email, a password reset code has been sent",
	})
}

// VerifyPasswordResetOTPRequest represents request to verify password reset OTP
type VerifyPasswordResetOTPRequest struct {
	Email string `json:"email"`
	OTP   string `json:"otp"`
}

// VerifyPasswordResetOTP verifies the OTP for password reset
func (h *Handler) VerifyPasswordResetOTP(w http.ResponseWriter, r *http.Request) {
	var req VerifyPasswordResetOTPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate email
	if req.Email == "" || !strings.Contains(req.Email, "@") {
		httpjson.Error(w, http.StatusBadRequest, "valid email is required")
		return
	}

	if req.OTP == "" {
		httpjson.Error(w, http.StatusBadRequest, "OTP is required")
		return
	}

	// Verify OTP
	otpService := services.NewOTPService(h.Redis)
	ctx := context.Background()

	valid, err := otpService.VerifyPasswordResetOTP(ctx, req.Email, req.OTP)
	if err != nil {
		log.Printf("[PASSWORD RESET] Error verifying OTP: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to verify OTP")
		return
	}

	if !valid {
		httpjson.Error(w, http.StatusBadRequest, "invalid or expired OTP")
		return
	}

	httpjson.JSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "OTP verified successfully",
	})
}

// ResetPasswordRequest represents request to reset password
type ResetPasswordRequest struct {
	Email           string `json:"email"`
	OTP             string `json:"otp"`
	NewPassword     string `json:"newPassword"`
	ConfirmPassword string `json:"confirmPassword"`
}

// ResetPassword resets the user's password after OTP verification
func (h *Handler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var req ResetPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate input
	if req.Email == "" || !strings.Contains(req.Email, "@") {
		httpjson.Error(w, http.StatusBadRequest, "valid email is required")
		return
	}

	if req.OTP == "" {
		httpjson.Error(w, http.StatusBadRequest, "OTP is required")
		return
	}

	if req.NewPassword == "" || len(req.NewPassword) < 6 {
		httpjson.Error(w, http.StatusBadRequest, "password must be at least 6 characters")
		return
	}

	if req.NewPassword != req.ConfirmPassword {
		httpjson.Error(w, http.StatusBadRequest, "passwords do not match")
		return
	}

	// Verify OTP first
	otpService := services.NewOTPService(h.Redis)
	ctx := context.Background()

	valid, err := otpService.VerifyPasswordResetOTP(ctx, req.Email, req.OTP)
	if err != nil {
		log.Printf("[PASSWORD RESET] Error verifying OTP: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to verify OTP")
		return
	}

	if !valid {
		httpjson.Error(w, http.StatusBadRequest, "invalid or expired OTP")
		return
	}

	// Find user
	var user models.User
	if err := h.DB.Where("email = ?", req.Email).First(&user).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "user not found")
		return
	}

	// Hash new password
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to reset password")
		return
	}

	// Update password
	user.PasswordHash = string(passwordHash)
	if err := h.DB.Save(&user).Error; err != nil {
		log.Printf("[PASSWORD RESET] Error updating password: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to reset password")
		return
	}

	// Delete OTP after successful password reset
	otpService.DeletePasswordResetOTP(ctx, req.Email)

	httpjson.JSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Password reset successfully",
	})
}

// UpdateProfileRequest represents request to update user profile
type UpdateProfileRequest struct {
	Name          string   `json:"name,omitempty"`
	Phone         string   `json:"phone,omitempty"`
	AlternatePhone string  `json:"alternatePhone,omitempty"`
	AddressLine   string   `json:"addressLine,omitempty"`
	City          string   `json:"city,omitempty"`
	State         string   `json:"state,omitempty"`
	Pincode       string   `json:"pincode,omitempty"`
	Country       string   `json:"country,omitempty"`
	Latitude      *float64 `json:"latitude,omitempty"`
	Longitude     *float64 `json:"longitude,omitempty"`
}

// UpdateProfile updates the authenticated user's profile
func (h *Handler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.FromContext(r.Context())
	if !ok {
		httpjson.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req UpdateProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Fetch user
	var user models.User
	if err := h.DB.First(&user, claims.UserID).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "user not found")
		return
	}

	// Update fields if provided
	if req.Name != "" {
		user.Name = req.Name
	}
	if req.Phone != "" {
		// Check if phone is already taken by another user
		var existingUser models.User
		if err := h.DB.Where("phone = ? AND id != ?", req.Phone, user.ID).First(&existingUser).Error; err == nil {
			httpjson.Error(w, http.StatusConflict, "phone number already in use")
			return
		}
		user.Phone = req.Phone
	}
	if req.AddressLine != "" {
		user.AddressLine = req.AddressLine
	}
	if req.City != "" {
		user.City = req.City
	}
	if req.State != "" {
		user.State = req.State
	}
	if req.Pincode != "" {
		user.Pincode = req.Pincode
	}
	if req.Country != "" {
		user.Country = req.Country
	}
	if req.Latitude != nil {
		user.Latitude = req.Latitude
	}
	if req.Longitude != nil {
		user.Longitude = req.Longitude
	}

	// Save updated user
	if err := h.DB.Save(&user).Error; err != nil {
		log.Printf("[AUTH] Error updating profile: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to update profile")
		return
	}

	httpjson.JSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Profile updated successfully",
		"user": map[string]any{
			"id":            user.ID,
			"name":          user.Name,
			"email":         user.Email,
			"phone":         user.Phone,
			"address": map[string]any{
				"line":      user.AddressLine,
				"city":      user.City,
				"state":     user.State,
				"pincode":   user.Pincode,
				"country":   user.Country,
				"latitude":  user.Latitude,
				"longitude": user.Longitude,
			},
		},
	})
}

// SaveLocationRequest represents request to save location data
type SaveLocationRequest struct {
	AddressLine string   `json:"addressLine"`
	City        string   `json:"city"`
	State       string   `json:"state"`
	Pincode     string   `json:"pincode"`
	Country     string   `json:"country"`
	Latitude    float64  `json:"latitude"`
	Longitude   float64  `json:"longitude"`
}

// SaveLocation saves location data for the authenticated user
func (h *Handler) SaveLocation(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.FromContext(r.Context())
	if !ok {
		httpjson.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req SaveLocationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate required fields
	if req.Latitude == 0 || req.Longitude == 0 {
		httpjson.Error(w, http.StatusBadRequest, "latitude and longitude are required")
		return
	}

	// Fetch user
	var user models.User
	if err := h.DB.First(&user, claims.UserID).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "user not found")
		return
	}

	// Update location fields
	user.AddressLine = req.AddressLine
	user.City = req.City
	user.State = req.State
	user.Pincode = req.Pincode
	user.Country = req.Country
	user.Latitude = &req.Latitude
	user.Longitude = &req.Longitude

	// Save updated user
	if err := h.DB.Save(&user).Error; err != nil {
		log.Printf("[AUTH] Error saving location: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to save location")
		return
	}

	httpjson.JSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Location saved successfully",
	})
}
