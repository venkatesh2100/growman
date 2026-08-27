package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/msg91"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/phoneutil"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/services"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/truecaller"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/api/idtoken"
)

// AuthRequest captures minimal login input.
type AuthRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// AuthResponse ctemontains a signed JWT.
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
			httpjson.Error(w, http.StatusUnauthorized, "account not found")
			return
		}
	} else {
		// Phone login — match 10-digit and 91-prefixed rows
		if err := h.DB.Where("phone IN ?", phoneutil.LookupVariants(payload.Email)).First(&user).Error; err != nil {
			httpjson.Error(w, http.StatusUnauthorized, "account not found")
			return
		}
	}

	hash := user.PasswordHashOrEmpty()
	if hash == "" {
		httpjson.Error(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(payload.Password)); err != nil {
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

// AdminLogin allows only admin/superadmin users to sign in.
func (h *Handler) AdminLogin(w http.ResponseWriter, r *http.Request) {
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
	if strings.Contains(payload.Email, "@") {
		if err := h.DB.Where("email = ?", payload.Email).First(&user).Error; err != nil {
			httpjson.Error(w, http.StatusUnauthorized, "account not found")
			return
		}
	} else {
		if err := h.DB.Where("phone IN ?", phoneutil.LookupVariants(payload.Email)).First(&user).Error; err != nil {
			httpjson.Error(w, http.StatusUnauthorized, "account not found")
			return
		}
	}

	hash := user.PasswordHashOrEmpty()
	if hash == "" {
		httpjson.Error(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(payload.Password)); err != nil {
		httpjson.Error(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	if user.Role != "admin" && user.Role != "superadmin" {
		httpjson.Error(w, http.StatusForbidden, "admin access required")
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
	pw := string(passwordHash)
	user := models.User{
		Name:          payload.Name,
		Email:         models.StrPtr(payload.Email),
		Phone:         models.StrPtr(payload.Phone),
		PasswordHash:  &pw,
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

// CheckUserExists checks if a user exists by email or phone.
// Phone matches 10-digit and 91-prefixed variants stored in users.phone.
func (h *Handler) CheckUserExists(w http.ResponseWriter, r *http.Request) {
	email := strings.TrimSpace(r.URL.Query().Get("email"))
	phone := strings.TrimSpace(r.URL.Query().Get("phone"))

	if email == "" && phone == "" {
		httpjson.Error(w, http.StatusBadRequest, "email or phone is required")
		return
	}

	var user models.User
	query := h.DB.Model(&models.User{})
	switch {
	case email != "" && phone != "":
		variants := phoneutil.LookupVariants(phone)
		query = query.Where("email = ? OR phone IN ?", email, variants)
	case email != "":
		query = query.Where("email = ?", email)
	default:
		query = query.Where("phone IN ?", phoneutil.LookupVariants(phone))
	}

	exists := query.First(&user).Error == nil

	httpjson.JSON(w, http.StatusOK, map[string]interface{}{
		"exists": exists,
		"email":  user.EmailOrEmpty(),
		"phone":  user.PhoneOrEmpty(),
	})
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return strings.TrimSpace(xri)
	}
	host := r.RemoteAddr
	if i := strings.LastIndex(host, ":"); i >= 0 {
		return host[:i]
	}
	return host
}

// parseRetryChannel accepts JSON number or string ("12") from channel / retryChannel.
func parseRetryChannel(primary, fallback json.RawMessage) int {
	for _, raw := range []json.RawMessage{primary, fallback} {
		if len(raw) == 0 || string(raw) == "null" {
			continue
		}
		var asInt int
		if err := json.Unmarshal(raw, &asInt); err == nil && asInt > 0 {
			return asInt
		}
		var asStr string
		if err := json.Unmarshal(raw, &asStr); err == nil {
			asStr = strings.TrimSpace(asStr)
			var n int
			if _, err := fmt.Sscanf(asStr, "%d", &n); err == nil && n > 0 {
				return n
			}
		}
	}
	return 0
}

// SendPhoneOTP sends an MSG91 OTP (widget API preferred; REST template fallback).
func (h *Handler) SendPhoneOTP(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Phone        string          `json:"phone"`
		ReqID        string          `json:"reqId"`        // optional — when set, treat as resend/retry
		Channel      json.RawMessage `json:"channel"`      // optional retry: 11 SMS, 4 VOICE, 12 WHATSAPP
		RetryChannel json.RawMessage `json:"retryChannel"` // alias (MSG91 field name)
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "bad request")
		return
	}
	channel := parseRetryChannel(req.RetryChannel, req.Channel)
	ten := phoneutil.TenDigitIN(req.Phone)
	if ten == "" {
		httpjson.Error(w, http.StatusBadRequest, "Enter a valid 10-digit mobile number")
		return
	}
	phone := phoneutil.Msg91Format(ten)

	useWidget := h.Cfg.MSG91WidgetID != "" && h.Cfg.MSG91TokenAuth != ""
	useTemplate := h.Cfg.MSG91AuthKey != "" && h.Cfg.MSG91TemplateID != ""
	if !useWidget && !useTemplate {
		httpjson.Error(w, http.StatusServiceUnavailable, "OTP service is not configured (set MSG91_WIDGET_ID + MSG91_TOKEN_AUTH)")
		return
	}
	if h.Redis == nil {
		httpjson.Error(w, http.StatusServiceUnavailable, "OTP service temporarily unavailable")
		return
	}

	throttle := &msg91.Throttle{RDB: h.Redis}
	isRetry := strings.TrimSpace(req.ReqID) != ""
	ok, reason, retryAfter, err := throttle.Allow(r.Context(), phone, clientIP(r), isRetry)
	if err != nil {
		log.Printf("[OTP] throttle error: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "Couldn't send the code. Try again.")
		return
	}
	if !ok {
		secs := int(retryAfter.Seconds())
		if secs < 1 {
			secs = 30
		}
		msg := "Too many attempts. Try again shortly."
		switch reason {
		case msg91.BlockCooldown:
			msg = fmt.Sprintf("Please wait %d seconds before requesting another code.", secs)
		case msg91.BlockDayCap:
			msg = "Daily OTP limit reached for this number. Try again tomorrow, or clear otp:daycap:* in Redis while testing."
		case msg91.BlockIPCap:
			msg = "Too many OTP requests from this network. Try again in a bit."
		}
		log.Printf("[OTP] throttled phone=%s reason=%s retryAfter=%ds", phone, reason, secs)
		w.Header().Set("Retry-After", fmt.Sprintf("%d", secs))
		httpjson.Error(w, http.StatusTooManyRequests, msg)
		return
	}

	if useWidget {
		client := msg91.NewWidgetClient(h.Cfg.MSG91AuthKey, h.Cfg.MSG91WidgetID, h.Cfg.MSG91TokenAuth)
		if strings.TrimSpace(req.ReqID) != "" {
			if channel == 0 {
				channel = 11
			}
			newID, err := client.WidgetRetryOTP(r.Context(), strings.TrimSpace(req.ReqID), channel)
			if err != nil {
				log.Printf("[OTP] msg91 widget retry failed phone=%s channel=%d: %v", phone, channel, err)
				httpjson.Error(w, http.StatusBadGateway, "Couldn't resend the code on that channel. Try SMS or another option.")
				return
			}
			log.Printf("[OTP] widget retry ok phone=%s channel=%d reqId=%s", phone, channel, newID)
			httpjson.JSON(w, http.StatusOK, map[string]any{
				"cooldownSeconds": 30,
				"reqId":           newID,
				"channel":         channel,
			})
			return
		}

		reqID, accessToken, err := client.WidgetSendOTP(r.Context(), phone)
		if err != nil {
			log.Printf("[OTP] msg91 widget send failed phone=%s: %v", phone, err)
			errMsg := err.Error()
			userFacing := "Couldn't send the code. Check MSG91 Mobile Integration and try again."
			if strings.Contains(strings.ToLower(errMsg), "ipblocked") || strings.Contains(errMsg, "blocked this server IP") {
				userFacing = "MSG91 blocked this server's IP. Whitelist your public IP in the MSG91 dashboard (Authkey → IP security), then retry."
			}
			httpjson.Error(w, http.StatusBadGateway, userFacing)
			return
		}
		if accessToken != "" {
			log.Printf("[OTP] widget invisible/already verified phone=%s", phone)
			user, isNew, err := h.findOrCreateByPhone(ten)
			if err != nil {
				httpjson.Error(w, http.StatusInternalServerError, "server error")
				return
			}
			needsProfile := strings.TrimSpace(user.Name) == ""
			scope := appauth.ScopeFull
			if needsProfile {
				scope = appauth.ScopeOnboarding
			}
			token, err := appauth.GenerateTokenWithScope(h.Cfg.JWTSecret, user.ID, user.Role, scope, 24*time.Hour)
			if err != nil {
				httpjson.Error(w, http.StatusInternalServerError, "token issue failed")
				return
			}
			httpjson.JSON(w, http.StatusOK, map[string]any{
				"token":        token,
				"isNewUser":    needsProfile,
				"isNewAccount": isNew,
				"verified":     true,
			})
			return
		}
		log.Printf("[OTP] widget send ok phone=%s reqId=%s", phone, reqID)
		httpjson.JSON(w, http.StatusOK, map[string]any{"cooldownSeconds": 30, "reqId": reqID})
		return
	}

	client := msg91.NewClient(h.Cfg.MSG91AuthKey, h.Cfg.MSG91TemplateID)
	if err := client.SendOTP(r.Context(), phone); err != nil {
		log.Printf("[OTP] msg91 send failed: %v", err)
		httpjson.Error(w, http.StatusBadGateway, "Couldn't send the code. Try again.")
		return
	}
	log.Printf("[OTP] template send ok phone=%s", phone)
	httpjson.JSON(w, http.StatusOK, map[string]any{"cooldownSeconds": 30})
}

// VerifyWidgetOTP verifies an MSG91 OTP Widget access-token and issues a Growman JWT.
// Use this when the mobile app uses @msg91comm/sendotp-react-native DefaultWidget
// (MSG91 default SMS / no custom DLT template required on your side).
func (h *Handler) VerifyWidgetOTP(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AccessToken string `json:"accessToken"`
		Identifier  string `json:"identifier"` // optional hint from the widget (e.g. 9198…)
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "bad request")
		return
	}
	accessToken := strings.TrimSpace(req.AccessToken)
	if accessToken == "" {
		httpjson.Error(w, http.StatusBadRequest, "accessToken is required")
		return
	}
	if h.Cfg.MSG91AuthKey == "" {
		httpjson.Error(w, http.StatusServiceUnavailable, "OTP service is not configured")
		return
	}

	client := msg91.NewClient(h.Cfg.MSG91AuthKey, h.Cfg.MSG91TemplateID)
	verifiedID, err := client.VerifyAccessToken(r.Context(), accessToken)
	if err != nil {
		log.Printf("[OTP] widget access-token verify failed: %v", err)
		httpjson.Error(w, http.StatusUnauthorized, "That verification didn't check out. Try again.")
		return
	}

	// Prefer server-verified identifier; fall back to client hint if MSG91 shape is odd.
	raw := verifiedID
	if raw == "" {
		raw = req.Identifier
	}
	ten := phoneutil.TenDigitIN(raw)
	if ten == "" {
		log.Printf("[OTP] widget identifier not a mobile: %q", raw)
		httpjson.Error(w, http.StatusBadRequest, "Verified identifier must be an Indian mobile number")
		return
	}

	user, _, err := h.findOrCreateByPhone(ten)
	if err != nil {
		log.Printf("[OTP] findOrCreate: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "server error")
		return
	}

	h.respondPhoneAuth(w, user, false)
}

// VerifyPhoneOTP verifies MSG91 OTP and issues a JWT (onboarding scope for new users).
func (h *Handler) VerifyPhoneOTP(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Phone string `json:"phone"`
		OTP   string `json:"otp"`
		ReqID string `json:"reqId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "bad request")
		return
	}
	ten := phoneutil.TenDigitIN(req.Phone)
	otp := strings.TrimSpace(req.OTP)
	reqID := strings.TrimSpace(req.ReqID)
	if ten == "" || len(otp) < 4 {
		httpjson.Error(w, http.StatusBadRequest, "bad request")
		return
	}
	phone := phoneutil.Msg91Format(ten)

	useWidget := h.Cfg.MSG91WidgetID != "" && h.Cfg.MSG91TokenAuth != "" && reqID != ""
	if useWidget {
		client := msg91.NewWidgetClient(h.Cfg.MSG91AuthKey, h.Cfg.MSG91WidgetID, h.Cfg.MSG91TokenAuth)
		if _, err := client.WidgetVerifyOTP(r.Context(), reqID, otp); err != nil {
			log.Printf("[OTP] widget verify failed phone=%s: %v", phone, err)
			httpjson.Error(w, http.StatusUnauthorized, "That code didn't match.")
			return
		}
		log.Printf("[OTP] widget verify ok phone=%s", phone)
	} else {
		if h.Cfg.MSG91AuthKey == "" || h.Cfg.MSG91TemplateID == "" {
			httpjson.Error(w, http.StatusServiceUnavailable, "OTP service is not configured")
			return
		}
		client := msg91.NewClient(h.Cfg.MSG91AuthKey, h.Cfg.MSG91TemplateID)
		if err := client.VerifyOTP(r.Context(), phone, otp); err != nil {
			log.Printf("[OTP] verify failed: %v", err)
			httpjson.Error(w, http.StatusUnauthorized, "That code didn't match.")
			return
		}
	}

	user, isNew, err := h.findOrCreateByPhone(ten)
	if err != nil {
		log.Printf("[OTP] findOrCreate: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "server error")
		return
	}

	h.respondPhoneAuth(w, user, isNew)
}

// VerifyTruecaller exchanges an Android Truecaller OAuth code for a Growman JWT.
// When Truecaller returns a name, the user skips complete-profile.
func (h *Handler) VerifyTruecaller(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AuthorizationCode string `json:"authorizationCode"`
		CodeVerifier      string `json:"codeVerifier"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "bad request")
		return
	}
	code := strings.TrimSpace(req.AuthorizationCode)
	verifier := strings.TrimSpace(req.CodeVerifier)
	if code == "" || verifier == "" {
		httpjson.Error(w, http.StatusBadRequest, "authorizationCode and codeVerifier are required")
		return
	}
	if strings.TrimSpace(h.Cfg.TruecallerClientID) == "" {
		httpjson.Error(w, http.StatusServiceUnavailable, "Truecaller is not configured")
		return
	}

	tc := truecaller.New(h.Cfg.TruecallerClientID)
	accessToken, err := tc.ExchangeCode(r.Context(), code, verifier)
	if err != nil {
		log.Printf("[Truecaller] token exchange failed: %v", err)
		httpjson.Error(w, http.StatusUnauthorized, "Truecaller verification failed. Try SMS instead.")
		return
	}
	profile, err := tc.UserInfo(r.Context(), accessToken)
	if err != nil {
		log.Printf("[Truecaller] userinfo failed: %v", err)
		httpjson.Error(w, http.StatusUnauthorized, "Couldn't read your Truecaller profile. Try SMS instead.")
		return
	}

	ten := phoneutil.TenDigitIN(profile.PhoneNumber)
	if ten == "" {
		httpjson.Error(w, http.StatusBadRequest, "Truecaller didn't return a valid Indian mobile number")
		return
	}

	user, isNew, err := h.findOrCreateByPhone(ten, phoneAuthProfile{
		Name:     profile.FullName(),
		Email:    strings.TrimSpace(profile.Email),
		Provider: "truecaller",
	})
	if err != nil {
		log.Printf("[Truecaller] findOrCreate: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "server error")
		return
	}

	log.Printf("[Truecaller] ok phone=%s name=%q new=%v", ten, user.Name, isNew)
	h.respondPhoneAuth(w, user, isNew)
}

type phoneAuthProfile struct {
	Name     string
	Email    string
	Provider string
}

// respondPhoneAuth issues JWT. isNewUser means "needs complete-profile" (missing name),
// not merely that the DB row was just inserted — Truecaller users with a name skip onboarding.
func (h *Handler) respondPhoneAuth(w http.ResponseWriter, user models.User, isNewAccount bool) {
	needsProfile := strings.TrimSpace(user.Name) == ""
	scope := appauth.ScopeFull
	if needsProfile {
		scope = appauth.ScopeOnboarding
	}
	token, err := appauth.GenerateTokenWithScope(h.Cfg.JWTSecret, user.ID, user.Role, scope, 24*time.Hour)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "token issue failed")
		return
	}
	httpjson.JSON(w, http.StatusOK, map[string]any{
		"token":        token,
		"isNewUser":    needsProfile,
		"isNewAccount": isNewAccount,
		"user": map[string]any{
			"id":    user.ID,
			"name":  user.Name,
			"email": user.EmailOrEmpty(),
			"phone": user.PhoneOrEmpty(),
			"role":  user.Role,
		},
	})
}

// findOrCreateByPhone creates a passwordless phone user (email optional).
func (h *Handler) findOrCreateByPhone(tenDigit string, profile ...phoneAuthProfile) (models.User, bool, error) {
	var opt phoneAuthProfile
	if len(profile) > 0 {
		opt = profile[0]
	}
	if opt.Provider == "" {
		opt.Provider = "phone"
	}

	variants := phoneutil.LookupVariants(tenDigit)
	var user models.User
	err := h.DB.Where("phone IN ?", variants).First(&user).Error
	if err == nil {
		now := time.Now()
		user.PhoneVerifiedAt = &now
		if user.Phone == nil || *user.Phone == "" {
			user.Phone = models.StrPtr(tenDigit)
		}
		if strings.TrimSpace(user.Name) == "" && strings.TrimSpace(opt.Name) != "" {
			user.Name = strings.TrimSpace(opt.Name)
		}
		if user.Email == nil && strings.TrimSpace(opt.Email) != "" && strings.Contains(opt.Email, "@") {
			user.Email = models.StrPtr(strings.TrimSpace(opt.Email))
		}
		// Keep password nil for phone/truecaller accounts — never invent one.
		_ = h.DB.Save(&user).Error
		return user, false, nil
	}

	now := time.Now()
	user = models.User{
		Name:            strings.TrimSpace(opt.Name),
		Email:           nil,
		Phone:           models.StrPtr(tenDigit),
		PasswordHash:    nil, // passwordless — OTP / Truecaller only
		PhoneVerifiedAt: &now,
		Provider:        opt.Provider,
		Role:            "user",
	}
	if email := strings.TrimSpace(opt.Email); email != "" && strings.Contains(email, "@") {
		user.Email = models.StrPtr(email)
	}
	if err := h.DB.Create(&user).Error; err != nil {
		return models.User{}, false, err
	}
	return user, true, nil
}

// CompletePhoneProfile finalizes a new phone user's name/email and upgrades JWT scope.
func (h *Handler) CompletePhoneProfile(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.FromContext(r.Context())
	if !ok {
		httpjson.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if claims.Scope != appauth.ScopeOnboarding {
		httpjson.Error(w, http.StatusForbidden, "invalid token scope")
		return
	}

	var req struct {
		Name  string  `json:"name"`
		Email *string `json:"email,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		httpjson.Error(w, http.StatusBadRequest, "name is required")
		return
	}

	var user models.User
	if err := h.DB.First(&user, claims.UserID).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "user not found")
		return
	}

	user.Name = strings.TrimSpace(req.Name)
	if req.Email != nil {
		email := strings.TrimSpace(*req.Email)
		if email != "" {
			if !strings.Contains(email, "@") {
				httpjson.Error(w, http.StatusBadRequest, "valid email is required")
				return
			}
			var existing models.User
			if err := h.DB.Where("email = ? AND id != ?", email, user.ID).First(&existing).Error; err == nil {
				httpjson.Error(w, http.StatusConflict, "email already in use")
				return
			}
			user.Email = models.StrPtr(email)
		}
	}

	if err := h.DB.Save(&user).Error; err != nil {
		log.Printf("[OTP] complete profile: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "server error")
		return
	}

	token, err := appauth.GenerateTokenWithScope(h.Cfg.JWTSecret, user.ID, user.Role, appauth.ScopeFull, 24*time.Hour)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "token issue failed")
		return
	}

	httpjson.JSON(w, http.StatusOK, map[string]any{
		"token": token,
		"user": map[string]any{
			"id":    user.ID,
			"name":  user.Name,
			"email": user.EmailOrEmpty(),
			"phone": user.PhoneOrEmpty(),
			"role":  user.Role,
		},
	})
}

// Me returns the authenticated user data
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.FromContext(r.Context())
	if !ok {
		httpjson.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	// Fetch user from database - only select needed fields
	var user models.User
	if err := h.DB.Select("id, name, email, phone, email_verified, role, address_line, city, state, pincode, country, latitude, longitude").
		First(&user, claims.UserID).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "user not found")
		return
	}

	// Return user data (excluding sensitive fields)
	httpjson.JSON(w, http.StatusOK, map[string]any{
		"id":            user.ID,
		"name":          user.Name,
		"email":         user.EmailOrEmpty(),
		"phone":         user.PhoneOrEmpty(),
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
			Email:         models.StrPtr(googleUser.Email),
			Phone:         nil,
			PasswordHash:  nil,
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

// verifyGoogleToken verifies the Google token and returns user info.
// Accepts both:
// - id_token (JWT) from mobile app (React Native Google Sign-In)
// - access_token from web app (@react-oauth/google useGoogleLogin)
func (h *Handler) verifyGoogleToken(token string) (*GoogleUserInfo, error) {
	// JWT format: header.payload.signature (3 base64 parts separated by dots)
	if isJWT(token) && h.Cfg.GoogleClientID != "" {
		return h.verifyGoogleIDToken(token)
	}
	// OAuth access token (web app)
	return h.verifyGoogleAccessToken(token)
}

func isJWT(s string) bool {
	parts := strings.Split(s, ".")
	return len(parts) == 3 && len(parts[0]) > 0 && len(parts[1]) > 0 && len(parts[2]) > 0
}

func (h *Handler) verifyGoogleIDToken(idToken string) (*GoogleUserInfo, error) {
	payload, err := idtoken.Validate(context.Background(), idToken, h.Cfg.GoogleClientID)
	if err != nil {
		return nil, err
	}
	claims := payload.Claims
	email, _ := claims["email"].(string)
	if email == "" {
		return nil, errors.New("email not provided by google")
	}
	name, _ := claims["name"].(string)
	picture, _ := claims["picture"].(string)
	sub, _ := claims["sub"].(string)
	verifiedEmail, _ := claims["email_verified"].(bool)
	return &GoogleUserInfo{
		ID:            sub,
		Email:         email,
		VerifiedEmail: verifiedEmail,
		Name:          name,
		Picture:       picture,
	}, nil
}

func (h *Handler) verifyGoogleAccessToken(accessToken string) (*GoogleUserInfo, error) {
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
	pw := string(passwordHash)
	user.PasswordHash = &pw
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
		user.Phone = models.StrPtr(req.Phone)
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
			"email":         user.EmailOrEmpty(),
			"phone":         user.PhoneOrEmpty(),
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
