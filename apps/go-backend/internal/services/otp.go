package services

import (
	"context"
	"crypto/rand"
	"fmt"
	"time"

	"github.com/go-redis/redis/v8"
	"golang.org/x/crypto/bcrypt"
)

const (
	OTPExpiryMinutes       = 5
	OTPResendCooldown      = 60 * time.Second
	OTPCooldownPrefix      = "otp:cooldown:"
	OTPKeyPrefix           = "otp:email:"
	PasswordResetOTPPrefix = "otp:password-reset:"
)

type OTPService struct {
	Redis *redis.Client
}

func NewOTPService(rdb *redis.Client) *OTPService {
	return &OTPService{Redis: rdb}
}

// GenerateOTP generates a 6-digit OTP and stores it in Redis
func (s *OTPService) GenerateOTP(ctx context.Context, email string) (string, error) {
	if s.Redis == nil {
		return "", fmt.Errorf("Redis not configured")
	}

	// Generate 6-digit OTP
	otpBytes := make([]byte, 3)
	if _, err := rand.Read(otpBytes); err != nil {
		return "", err
	}
	otp := fmt.Sprintf("%06d", int(otpBytes[0])*256*256+int(otpBytes[1])*256+int(otpBytes[2]))[:6]

	// Hash OTP using bcrypt
	hashedOTP, err := bcrypt.GenerateFromPassword([]byte(otp), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}

	// Store in Redis with expiry
	key := OTPKeyPrefix + email
	if err := s.Redis.Set(ctx, key, string(hashedOTP), OTPExpiryMinutes*time.Minute).Err(); err != nil {
		return "", err
	}

	return otp, nil
}

// VerifyOTP verifies an OTP for an email
func (s *OTPService) VerifyOTP(ctx context.Context, email, otp string) (bool, error) {
	if s.Redis == nil {
		return false, fmt.Errorf("Redis not configured")
	}

	key := OTPKeyPrefix + email
	hashedOTP, err := s.Redis.Get(ctx, key).Result()
	if err == redis.Nil {
		return false, nil // OTP not found or expired
	}
	if err != nil {
		return false, err
	}

	// Compare OTP
	err = bcrypt.CompareHashAndPassword([]byte(hashedOTP), []byte(otp))
	if err != nil {
		return false, nil // Invalid OTP
	}

	// Delete OTP after successful verification
	s.Redis.Del(ctx, key)

	return true, nil
}

// CheckOTPExists checks if an OTP exists for an email (for rate limiting)
func (s *OTPService) CheckOTPExists(ctx context.Context, email string) (bool, error) {
	if s.Redis == nil {
		return false, fmt.Errorf("Redis not configured")
	}

	key := OTPKeyPrefix + email
	exists, err := s.Redis.Exists(ctx, key).Result()
	return exists > 0, err
}

// GeneratePasswordResetOTP generates a 6-digit OTP for password reset
func (s *OTPService) GeneratePasswordResetOTP(ctx context.Context, email string) (string, error) {
	if s.Redis == nil {
		return "", fmt.Errorf("Redis not configured")
	}

	// Generate 6-digit OTP
	otpBytes := make([]byte, 3)
	if _, err := rand.Read(otpBytes); err != nil {
		return "", err
	}
	otp := fmt.Sprintf("%06d", int(otpBytes[0])*256*256+int(otpBytes[1])*256+int(otpBytes[2]))[:6]

	// Hash OTP using bcrypt
	hashedOTP, err := bcrypt.GenerateFromPassword([]byte(otp), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}

	// Store in Redis with expiry
	key := PasswordResetOTPPrefix + email
	if err := s.Redis.Set(ctx, key, string(hashedOTP), OTPExpiryMinutes*time.Minute).Err(); err != nil {
		return "", err
	}

	return otp, nil
}

// VerifyPasswordResetOTP verifies an OTP for password reset
func (s *OTPService) VerifyPasswordResetOTP(ctx context.Context, email, otp string) (bool, error) {
	if s.Redis == nil {
		return false, fmt.Errorf("Redis not configured")
	}

	key := PasswordResetOTPPrefix + email
	hashedOTP, err := s.Redis.Get(ctx, key).Result()
	if err == redis.Nil {
		return false, nil // OTP not found or expired
	}
	if err != nil {
		return false, err
	}

	// Compare OTP
	err = bcrypt.CompareHashAndPassword([]byte(hashedOTP), []byte(otp))
	if err != nil {
		return false, nil // Invalid OTP
	}

	// Don't delete OTP here - keep it for password reset step
	return true, nil
}

// CheckPasswordResetOTPExists checks if a password reset OTP exists for an email
func (s *OTPService) CheckPasswordResetOTPExists(ctx context.Context, email string) (bool, error) {
	if s.Redis == nil {
		return false, fmt.Errorf("Redis not configured")
	}

	key := PasswordResetOTPPrefix + email
	exists, err := s.Redis.Exists(ctx, key).Result()
	return exists > 0, err
}

// DeletePasswordResetOTP deletes the password reset OTP after successful password reset
func (s *OTPService) DeletePasswordResetOTP(ctx context.Context, email string) error {
	if s.Redis == nil {
		return fmt.Errorf("Redis not configured")
	}

	key := PasswordResetOTPPrefix + email
	return s.Redis.Del(ctx, key).Err()
}

// CanResendOTP checks if user can request a new OTP
func (s *OTPService) CanResendOTP(ctx context.Context, email string) (bool, time.Duration, error) {
	key := OTPCooldownPrefix + email
	ttl, err := s.Redis.TTL(ctx, key).Result()
	if err != nil && err != redis.Nil {
		return false, 0, err
	}

	if ttl <= 0 {
		return true, 0, nil
	}

	return false, ttl, nil
}

// SetResendCooldown sets a 60-second cooldown in Redis
func (s *OTPService) SetResendCooldown(ctx context.Context, email string) error {
	key := OTPCooldownPrefix + email
	return s.Redis.Set(ctx, key, 1, OTPResendCooldown).Err()
}
