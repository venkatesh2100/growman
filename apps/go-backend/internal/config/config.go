package config

import (
	"errors"
	"os"
	"strings"

	"github.com/joho/godotenv"
)

// Config holds runtime configuration for the API server.
type Config struct {
	Port           string
	DatabaseURL    string // Direct database URL (fallback)
	HyperdriveURL  string // Cloudflare Hyperdrive connection string
	JWTSecret      string
	AllowedOrigins []string
	AppEnv         string
	AutoMigrate    bool
	REDIS_URL 			string
	SeedOnStartup  bool
	RazorpayKeyID  string
	RazorpayKeySecret string
	SMTPEmail      string
	SMTPPassword   string
	SMTPHost       string
	SMTPPort       string
	// Image storage configuration
	ImageBaseURL   string // Base URL for image storage (e.g., "https://youraccount.blob.core.windows.net/container")
	AzureAccountName string // Azure storage account name (optional, for Azure provider)
	AzureAccountKey  string // Azure storage account key (optional, for Azure provider)
	AzureContainerName string // Azure container name (optional, for Azure provider)
	GCSBucketName     string // Google Cloud Storage bucket name (optional, for GCS provider)
	GCSProjectID       string // Google Cloud project ID (optional, for GCS provider)
	// AI Chat configuration
	OpenAIAPIKey      string // OpenAI API key for chat functionality
	GeminiAPIKey      string // Google Gemini API key for chat functionality
	AIProvider        string // AI provider: "openai", "gemini", "anthropic", or "custom"
	// Pl@ntNet API for plant identification
	PlantNetAPIKey    string // Pl@ntNet API key from https://my.plantnet.org
	// Google OAuth - Web Client ID for verifying id_token from mobile/web
	GoogleClientID string // Web client ID (same as EXPO_PUBLIC_GOOGLE_CLIENT_ID / NEXT_PUBLIC_GOOGLE_CLIENT_ID)
}

// Load reads environment variables (optionally from a .env file) and applies sane defaults.
func Load() (Config, error) {
	_ = godotenv.Load()

	cfg := Config{
		Port:          getenv("GO_PORT", ":8080"),
		DatabaseURL:   os.Getenv("DATABASE_URL"),
		HyperdriveURL: os.Getenv("HYPERDRIVE_URL"),
		JWTSecret:     getenv("JWT_SECRET", "dev-secret-change-me"),
		AppEnv:        getenv("GO_ENV", getenv("APP_ENV", "development")),
		AutoMigrate:   getenv("AUTO_MIGRATE", "true") == "true",
		REDIS_URL:     os.Getenv("REDIS_URL"),
		SeedOnStartup: getenv("SEED_ON_STARTUP", "false") == "true",
		RazorpayKeyID: os.Getenv("RAZORPAY_KEY_ID"),
		RazorpayKeySecret: os.Getenv("RAZORPAY_KEY_SECRET"),
		SMTPEmail:     os.Getenv("SMTP_EMAIL"),
		SMTPPassword:  os.Getenv("SMTP_PASSWORD"),
		SMTPHost:      getenv("SMTP_HOST", "smtp.gmail.com"),
		SMTPPort:      getenv("SMTP_PORT", "587"),
		// Image storage configuration
		ImageBaseURL:      os.Getenv("IMAGE_BASE_URL"),
		AzureAccountName:  os.Getenv("AZURE_STORAGE_ACCOUNT_NAME"),
		AzureAccountKey:    os.Getenv("AZURE_STORAGE_ACCOUNT_KEY"),
		AzureContainerName: os.Getenv("AZURE_STORAGE_CONTAINER_NAME"),
		GCSBucketName:      os.Getenv("GCS_BUCKET_NAME"),
		GCSProjectID:       os.Getenv("GCS_PROJECT_ID"),
		// AI Chat configuration
		OpenAIAPIKey:       os.Getenv("OPENAI_API_KEY"),
		GeminiAPIKey:       os.Getenv("GEMINI_API_KEY"),
		AIProvider:         getenv("AI_PROVIDER", "openai"),
		// Pl@ntNet API
		PlantNetAPIKey:     os.Getenv("PLANTNET_API_KEY"),
		// Google OAuth - Web Client ID for id_token verification (same as mobile/web apps)
		GoogleClientID:     firstNonEmpty(os.Getenv("GOOGLE_CLIENT_ID"), os.Getenv("NEXT_PUBLIC_GOOGLE_CLIENT_ID")),
	}

	allowed := getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001")
	cfg.AllowedOrigins = splitAndTrim(allowed)

	// Hyperdrive URL takes precedence, but fallback to DATABASE_URL
	if cfg.HyperdriveURL == "" && cfg.DatabaseURL == "" {
		return cfg, errors.New("either HYPERDRIVE_URL or DATABASE_URL is required for Go backend")
	}

	return cfg, nil
}
//safe parsing := Trimer
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

//safe fallback
func getenv(key, fallback string) string {
	val := os.Getenv(key)
	if val == "" {
		return fallback
	}
	return val
}

func firstNonEmpty(ss ...string) string {
	for _, s := range ss {
		if s != "" {
			return s
		}
	}
	return ""
}
