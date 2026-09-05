// Package config loads runtime configuration from environment variables
// (optionally via a .env file). Every third-party integration's credentials
// are optional here — the handlers that use them degrade to a 503 rather
// than the server refusing to start.
package config

import (
	"errors"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

// Config holds runtime configuration for the API server.
type Config struct {
	Port                string
	DatabaseURL         string // Direct database URL (fallback)
	HyperdriveURL       string // Cloudflare Hyperdrive connection string
	JWTSecret           string
	AllowedOrigins      []string
	AppEnv              string
	AutoMigrate         bool
	REDIS_URL           string
	SeedOnStartup       bool
	RazorpayKeyID       string
	RazorpayKeySecret   string
	SMTPEmail           string
	SMTPPassword        string
	SMTPHost            string
	SMTPPort            string
	MerchantNotifyEmail string // Internal ops alerts (signups, orders, long browse)
	// Image storage configuration (Google Cloud Storage)
	ImageBaseURL       string // Base URL for image storage (e.g., "https://storage.googleapis.com/your-bucket")
	GCSBucketName      string // Google Cloud Storage bucket name
	GCSProjectID       string // Google Cloud project ID (optional; usually inferred from credentials)
	GCSCredentialsJSON string // Path to a service account JSON key file (optional; falls back to default credentials)
	// Connection pooling
	DBMaxOpenConns int
	DBMaxIdleConns int
	RedisPoolSize  int
	// AI Chat configuration
	OpenAIAPIKey string // OpenAI API key for chat functionality
	GeminiAPIKey string // Google Gemini API key for chat functionality
	AIProvider   string // AI provider: "openai", "gemini", "anthropic", or "custom"
	// Pl@ntNet API for plant identification
	PlantNetAPIKey string // Pl@ntNet API key from https://my.plantnet.org
	// Google OAuth - Web Client ID for verifying id_token from mobile/web
	GoogleClientID string // Web client ID (same as EXPO_PUBLIC_GOOGLE_CLIENT_ID / NEXT_PUBLIC_GOOGLE_CLIENT_ID)
	// Cloudflare analytics configuration (dashboard map)
	CloudflareAPIToken  string
	CloudflareZoneID    string
	CloudflareAccountID string
	// MSG91 phone OTP
	MSG91AuthKey    string
	MSG91TemplateID string
	MSG91WidgetID   string
	MSG91TokenAuth  string
	// Truecaller OAuth (Android client id from developer portal)
	TruecallerClientID string
}

// Load reads environment variables (optionally from a .env file) and applies sane defaults.
func Load() (Config, error) {
	_ = godotenv.Load()

	cfg := Config{
		Port:                getenv("GO_PORT", ":8080"),
		DatabaseURL:         os.Getenv("DATABASE_URL"),
		HyperdriveURL:       os.Getenv("HYPERDRIVE_URL"),
		JWTSecret:           getenv("JWT_SECRET", "dev-secret-change-me"),
		AppEnv:              getenv("GO_ENV", getenv("APP_ENV", "development")),
		AutoMigrate:         getenv("AUTO_MIGRATE", "true") == "true",
		REDIS_URL:           os.Getenv("REDIS_URL"),
		SeedOnStartup:       getenv("SEED_ON_STARTUP", "false") == "true",
		RazorpayKeyID:       os.Getenv("RAZORPAY_KEY_ID"),
		RazorpayKeySecret:   os.Getenv("RAZORPAY_KEY_SECRET"),
		SMTPEmail:           os.Getenv("SMTP_EMAIL"),
		SMTPPassword:        os.Getenv("SMTP_PASSWORD"),
		SMTPHost:            getenv("SMTP_HOST", "smtp.gmail.com"),
		SMTPPort:            getenv("SMTP_PORT", "587"),
		MerchantNotifyEmail: getenv("MERCHANT_NOTIFY_EMAIL", "zoroboro.ynm@gmail.com"),
		// Image storage configuration (Google Cloud Storage)
		ImageBaseURL:       os.Getenv("IMAGE_BASE_URL"),
		GCSBucketName:      os.Getenv("GCS_BUCKET_NAME"),
		GCSProjectID:       os.Getenv("GCS_PROJECT_ID"),
		GCSCredentialsJSON: os.Getenv("GCS_CREDENTIALS_JSON"),
		// AI Chat configuration
		OpenAIAPIKey: os.Getenv("OPENAI_API_KEY"),
		GeminiAPIKey: os.Getenv("GEMINI_API_KEY"),
		AIProvider:   getenv("AI_PROVIDER", "openai"),
		// Pl@ntNet API
		PlantNetAPIKey: os.Getenv("PLANTNET_API_KEY"),
		// Google OAuth - Web Client ID for id_token verification (same as mobile/web apps)
		GoogleClientID:      firstNonEmpty(os.Getenv("GOOGLE_CLIENT_ID"), os.Getenv("NEXT_PUBLIC_GOOGLE_CLIENT_ID")),
		CloudflareAPIToken:  os.Getenv("CLOUDFLARE_API_TOKEN"),
		CloudflareZoneID:    os.Getenv("CLOUDFLARE_ZONE_ID"),
		CloudflareAccountID: strings.TrimSpace(os.Getenv("CLOUDFLARE_ACCOUNT_ID")),
		MSG91AuthKey:        os.Getenv("MSG91_AUTH_KEY"),
		MSG91TemplateID:     os.Getenv("MSG91_TEMPLATE_ID"),
		MSG91WidgetID:       os.Getenv("MSG91_WIDGET_ID"),
		MSG91TokenAuth:      os.Getenv("MSG91_TOKEN_AUTH"),
		TruecallerClientID:  firstNonEmpty(os.Getenv("TRUECALLER_CLIENT_ID"), os.Getenv("TRUECALLER_ANDROID_CLIENT_ID")),
		DBMaxOpenConns:      getenvInt("DB_MAX_OPEN_CONNS", 40),
		DBMaxIdleConns:      getenvInt("DB_MAX_IDLE_CONNS", 10),
		RedisPoolSize:       getenvInt("REDIS_POOL_SIZE", 20),
	}

	allowed := getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001")
	cfg.AllowedOrigins = splitAndTrim(allowed)

	// Hyperdrive URL takes precedence, but fallback to DATABASE_URL
	if cfg.HyperdriveURL == "" && cfg.DatabaseURL == "" {
		return cfg, errors.New("either HYPERDRIVE_URL or DATABASE_URL is required for Go backend")
	}

	if isProd(cfg.AppEnv) && (cfg.JWTSecret == "" || cfg.JWTSecret == "dev-secret-change-me") {
		return cfg, errors.New("JWT_SECRET must be set to a strong secret in production")
	}

	return cfg, nil
}

// splitAndTrim splits a comma-separated string into trimmed, non-empty parts.
func splitAndTrim(input string) []string {
	parts := strings.Split(input, ",")
	var out []string
	for _, p := range parts {
		clean := strings.TrimSpace(p)
		if clean != "" {
			out = append(out, clean)
		}
	}
	return out
}

// getenv returns the named env var, or fallback if it's unset/empty.
func getenv(key, fallback string) string {
	val := os.Getenv(key)
	if val == "" {
		return fallback
	}
	return val
}

func getenvInt(key string, fallback int) int {
	val := os.Getenv(key)
	if val == "" {
		return fallback
	}
	n, err := strconv.Atoi(val)
	if err != nil || n <= 0 {
		return fallback
	}
	return n
}

func isProd(env string) bool {
	e := strings.ToLower(strings.TrimSpace(env))
	return e == "production" || e == "prod"
}

func firstNonEmpty(ss ...string) string {
	for _, s := range ss {
		if s != "" {
			return s
		}
	}
	return ""
}
