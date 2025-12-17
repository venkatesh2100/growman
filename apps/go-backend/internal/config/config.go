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
	SeedOnStartup  bool
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
		SeedOnStartup: getenv("SEED_ON_STARTUP", "false") == "true",
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
