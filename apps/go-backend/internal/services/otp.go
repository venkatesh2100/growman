package services

import (
	"context"
	"crypto/rand"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/go-redis/redis/v8"
	"golang.org/x/crypto/bcrypt"
)

const (
	OTPExpiryMinutes            = 5
	OTPResendCooldown           = 60 * time.Second
	OTPCooldownPrefix           = "otp:cooldown:"
	OTPKeyPrefix                = "otp:email:"
	PasswordResetOTPPrefix      = "otp:password-reset:"
	PasswordResetCooldownPrefix = "otp:password-reset:cooldown:"
	PasswordResetVerifiedPrefix = "otp:password-reset:verified:"
	redisOpTimeout              = 800 * time.Millisecond
)

type OTPService struct {
	Redis *redis.Client
}

func NewOTPService(rdb *redis.Client) *OTPService {
	return &OTPService{Redis: rdb}
}

type memEntry struct {
	value     string
	expiresAt time.Time
}

var memStore sync.Map

func memSet(key, value string, ttl time.Duration) {
	memStore.Store(key, memEntry{
		value:     value,
		expiresAt: time.Now().Add(ttl),
	})
}

func memGet(key string) (string, bool) {
	raw, ok := memStore.Load(key)
	if !ok {
		return "", false
	}
	entry := raw.(memEntry)
	if time.Now().After(entry.expiresAt) {
		memStore.Delete(key)
		return "", false
	}
	return entry.value, true
}

func memDel(key string) {
	memStore.Delete(key)
}

func memTTL(key string) time.Duration {
	raw, ok := memStore.Load(key)
	if !ok {
		return 0
	}
	entry := raw.(memEntry)
	ttl := time.Until(entry.expiresAt)
	if ttl <= 0 {
		memStore.Delete(key)
		return 0
	}
	return ttl
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func (s *OTPService) withRedisTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithTimeout(ctx, redisOpTimeout)
}

// setValue writes to the in-memory store (always) and Redis (best-effort,
// when configured), so a Redis blip never breaks OTP issuance — memory is
// the fallback of record, not an afterthought.
func (s *OTPService) setValue(ctx context.Context, key, value string, ttl time.Duration) error {
	memSet(key, value, ttl)
	if s.Redis == nil {
		return nil
	}
	rctx, cancel := s.withRedisTimeout(ctx)
	defer cancel()
	_ = s.Redis.Set(rctx, key, value, ttl).Err() // best-effort; memory already has it
	return nil
}

// getValue reads Redis first (shared across instances), falling back to the
// local memory store when Redis is unset or misses.
func (s *OTPService) getValue(ctx context.Context, key string) (string, bool, error) {
	if s.Redis != nil {
		rctx, cancel := s.withRedisTimeout(ctx)
		val, err := s.Redis.Get(rctx, key).Result()
		cancel()
		if err == nil {
			return val, true, nil
		}
	}
	if val, ok := memGet(key); ok {
		return val, true, nil
	}
	return "", false, nil
}

func (s *OTPService) delValue(ctx context.Context, key string) {
	memDel(key)
	if s.Redis == nil {
		return
	}
	rctx, cancel := s.withRedisTimeout(ctx)
	defer cancel()
	_ = s.Redis.Del(rctx, key).Err() // best-effort
}

func (s *OTPService) cooldownTTL(ctx context.Context, key string) (time.Duration, error) {
	if s.Redis != nil {
		rctx, cancel := s.withRedisTimeout(ctx)
		ttl, err := s.Redis.TTL(rctx, key).Result()
		cancel()
		if err == nil && ttl > 0 {
			return ttl, nil
		}
	}
	return memTTL(key), nil
}

func generateDigits() (string, error) {
	otpBytes := make([]byte, 3)
	if _, err := rand.Read(otpBytes); err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", int(otpBytes[0])*256*256+int(otpBytes[1])*256+int(otpBytes[2]))[:6], nil
}

func hashOTP(otp string) (string, error) {
	hashed, err := bcrypt.GenerateFromPassword([]byte(otp), 4)
	if err != nil {
		return "", err
	}
	return string(hashed), nil
}

// GenerateOTP generates a 6-digit OTP and stores it (Redis + memory fallback).
func (s *OTPService) GenerateOTP(ctx context.Context, email string) (string, error) {
	email = normalizeEmail(email)
	otp, err := generateDigits()
	if err != nil {
		return "", err
	}
	hashed, err := hashOTP(otp)
	if err != nil {
		return "", err
	}
	key := OTPKeyPrefix + email
	if err := s.setValue(ctx, key, hashed, OTPExpiryMinutes*time.Minute); err != nil {
		return "", err
	}
	return otp, nil
}

// VerifyOTP verifies an OTP for an email
func (s *OTPService) VerifyOTP(ctx context.Context, email, otp string) (bool, error) {
	email = normalizeEmail(email)
	key := OTPKeyPrefix + email
	hashedOTP, ok, err := s.getValue(ctx, key)
	if err != nil {
		return false, err
	}
	if !ok {
		return false, nil
	}
	if bcrypt.CompareHashAndPassword([]byte(hashedOTP), []byte(otp)) != nil {
		return false, nil
	}
	s.delValue(ctx, key)
	return true, nil
}

// GeneratePasswordResetOTP generates a 6-digit OTP for password reset
func (s *OTPService) GeneratePasswordResetOTP(ctx context.Context, email string) (string, error) {
	email = normalizeEmail(email)
	otp, err := generateDigits()
	if err != nil {
		return "", err
	}
	hashed, err := hashOTP(otp)
	if err != nil {
		return "", err
	}
	key := PasswordResetOTPPrefix + email
	if err := s.setValue(ctx, key, hashed, OTPExpiryMinutes*time.Minute); err != nil {
		return "", err
	}
	// Clear any previous verified marker
	s.delValue(ctx, PasswordResetVerifiedPrefix+email)
	return otp, nil
}

// VerifyPasswordResetOTP verifies the OTP for password reset and marks the email verified.
func (s *OTPService) VerifyPasswordResetOTP(ctx context.Context, email, otp string) (bool, error) {
	email = normalizeEmail(email)
	key := PasswordResetOTPPrefix + email
	hashedOTP, ok, err := s.getValue(ctx, key)
	if err != nil {
		return false, err
	}
	if !ok {
		return false, nil
	}
	if bcrypt.CompareHashAndPassword([]byte(hashedOTP), []byte(otp)) != nil {
		return false, nil
	}
	// Keep OTP for the reset step, and mark verified so reset can proceed if Redis flakes.
	_ = s.setValue(ctx, PasswordResetVerifiedPrefix+email, otp, OTPExpiryMinutes*time.Minute)
	return true, nil
}

// ConsumePasswordResetOTP validates OTP (or a prior verification) then deletes reset keys.
func (s *OTPService) ConsumePasswordResetOTP(ctx context.Context, email, otp string) (bool, error) {
	email = normalizeEmail(email)
	verifiedKey := PasswordResetVerifiedPrefix + email
	otpKey := PasswordResetOTPPrefix + email

	if stored, ok, _ := s.getValue(ctx, verifiedKey); ok && stored == otp {
		s.delValue(ctx, verifiedKey)
		s.delValue(ctx, otpKey)
		return true, nil
	}

	valid, err := s.VerifyPasswordResetOTP(ctx, email, otp)
	if err != nil || !valid {
		return valid, err
	}
	s.delValue(ctx, verifiedKey)
	s.delValue(ctx, otpKey)
	return true, nil
}

// DeletePasswordResetOTP deletes the password reset OTP after successful password reset
func (s *OTPService) DeletePasswordResetOTP(ctx context.Context, email string) error {
	email = normalizeEmail(email)
	s.delValue(ctx, PasswordResetOTPPrefix+email)
	s.delValue(ctx, PasswordResetVerifiedPrefix+email)
	return nil
}

// CanResendOTP checks if user can request a new OTP
func (s *OTPService) CanResendOTP(ctx context.Context, email string) (bool, time.Duration, error) {
	email = normalizeEmail(email)
	ttl, err := s.cooldownTTL(ctx, OTPCooldownPrefix+email)
	if err != nil {
		return false, 0, err
	}
	if ttl <= 0 {
		return true, 0, nil
	}
	return false, ttl, nil
}

// SetResendCooldown sets a 60-second cooldown
func (s *OTPService) SetResendCooldown(ctx context.Context, email string) error {
	email = normalizeEmail(email)
	return s.setValue(ctx, OTPCooldownPrefix+email, "1", OTPResendCooldown)
}

// CanResendPasswordResetOTP checks the 60s password-reset resend cooldown.
func (s *OTPService) CanResendPasswordResetOTP(ctx context.Context, email string) (bool, time.Duration, error) {
	email = normalizeEmail(email)
	ttl, err := s.cooldownTTL(ctx, PasswordResetCooldownPrefix+email)
	if err != nil {
		return false, 0, err
	}
	if ttl <= 0 {
		return true, 0, nil
	}
	return false, ttl, nil
}

// SetPasswordResetCooldown sets a 60-second password-reset resend cooldown.
func (s *OTPService) SetPasswordResetCooldown(ctx context.Context, email string) error {
	email = normalizeEmail(email)
	return s.setValue(ctx, PasswordResetCooldownPrefix+email, "1", OTPResendCooldown)
}
