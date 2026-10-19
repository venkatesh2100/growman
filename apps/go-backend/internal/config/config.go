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
	"github.com/venkatesh2100/growman/apps/go-backend/internal/fulfillment"
)

// Config holds runtime configuration for the API server.
type Config struct {
	Port              string
	DatabaseURL       string // Direct database URL (fallback)
	HyperdriveURL     string // Cloudflare Hyperdrive connection string
	JWTSecret         string
	AllowedOrigins    []string
	AppEnv            string
	AutoMigrate       bool
	REDIS_URL         string
	SeedOnStartup     bool
	RazorpayKeyID     string
	RazorpayKeySecret string
	// RazorpayWebhookSecret signs webhook bodies and is a *different*
	// value from RazorpayKeySecret — Razorpay generates it when you create
	// the webhook in the dashboard. Using the key secret here makes every
	// delivery fail its signature check.
	RazorpayWebhookSecret string
	SMTPEmail             string
	SMTPPassword          string
	SMTPHost              string
	SMTPPort              string
	MerchantNotifyEmail   string // Internal ops alerts when Discord is not configured
	// DiscordWebhookURL receives ops alerts (signups, paid orders, checkout
	// drop-offs, long browsing). When set, those alerts are not also emailed.
	DiscordWebhookURL string
	QuotationEmail    string // Inbox that receives bulk quotation enquiries
	WaitlistEmail     string // Inbox that receives Dootha Care waiting list sign-ups
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
	// Pl@ntNet API for plant identification.
	// Free plan: 500 identifications/day, shared by species, disease, and
	// variety scans. PlantNetProject is the flora used when the request
	// has no coordinates ("all" lets Pl@ntNet choose). PlantNetReserve is
	// how many identify credits to keep back for species scans; health and
	// variety calls stop once the day's remaining balance is at or below it.
	PlantNetAPIKey  string
	PlantNetProject string
	PlantNetReserve int
	// PlantNetBaseURL overrides the API host. Empty uses my-api.plantnet.org.
	// Tests point this at a local server.
	PlantNetBaseURL string
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
	// Fulfillment policy overrides (see internal/fulfillment). Zero values
	// mean "keep the built-in default", except FreeDeliveryMinSubtotal
	// where zero legitimately means "no free-delivery threshold".
	StoreLatitude   float64
	StoreLongitude  float64
	StorePincode    string // pickup pincode sent to the courier API
	CourierProvider string
	// RetailMaxZone caps self-serve delivery: store_local, near, mid or
	// far. Past it checkout offers only a store visit or a wholesale
	// quote. Empty keeps the default (mid, ~30 km).
	RetailMaxZone string
	// Shiprocket has no static API key: these are the credentials of a
	// dedicated API user, exchanged for a 10-day JWT. ShiprocketToken can
	// be supplied instead to avoid storing a password, at the cost of
	// manual rotation every 10 days.
	ShiprocketEmail    string
	ShiprocketPassword string
	ShiprocketToken    string
	// ShiprocketPickupLocation is the nickname of the pickup address
	// registered in the Shiprocket dashboard. Bookings are rejected if it
	// does not match one of them exactly.
	ShiprocketPickupLocation string
	// ShiprocketWebhookToken is the shared secret Shiprocket sends in the
	// x-api-key header on tracking webhooks. Without it shipment webhooks
	// are refused rather than trusted.
	ShiprocketWebhookToken  string
	FreeDeliveryMinSubtotal float64
	OwnVehicleMinSubtotal   float64
	BulkMinUnits            int
	BulkMinSubtotal         float64
}

// FulfillmentPolicy returns the delivery rules with any configured
// overrides applied on top of the defaults.
func (c Config) FulfillmentPolicy() fulfillment.Policy {
	p := fulfillment.DefaultPolicy()
	if c.StoreLatitude != 0 && c.StoreLongitude != 0 {
		p.StoreLat, p.StoreLng = c.StoreLatitude, c.StoreLongitude
	}
	if c.CourierProvider != "" {
		p.CourierProvider = c.CourierProvider
	}
	if zone, ok := fulfillment.ParseZone(c.RetailMaxZone); ok {
		p.RetailMaxZone = zone
	}
	p.FreeDeliveryMinSubtotal = c.FreeDeliveryMinSubtotal
	if c.OwnVehicleMinSubtotal > 0 {
		p.OwnVehicleMinSubtotal = c.OwnVehicleMinSubtotal
	}
	if c.BulkMinUnits > 0 {
		p.BulkMinUnits = c.BulkMinUnits
	}
	if c.BulkMinSubtotal > 0 {
		p.BulkMinSubtotal = c.BulkMinSubtotal
	}
	return p
}

// Load reads environment variables (optionally from a .env file) and applies sane defaults.
func Load() (Config, error) {
	_ = godotenv.Load()

	cfg := Config{
		Port:                  getenv("GO_PORT", ":8080"),
		DatabaseURL:           os.Getenv("DATABASE_URL"),
		HyperdriveURL:         os.Getenv("HYPERDRIVE_URL"),
		JWTSecret:             getenv("JWT_SECRET", "dev-secret-change-me"),
		AppEnv:                getenv("GO_ENV", getenv("APP_ENV", "development")),
		AutoMigrate:           getenv("AUTO_MIGRATE", "true") == "true",
		REDIS_URL:             os.Getenv("REDIS_URL"),
		SeedOnStartup:         getenv("SEED_ON_STARTUP", "false") == "true",
		RazorpayKeyID:         os.Getenv("RAZORPAY_KEY_ID"),
		RazorpayKeySecret:     os.Getenv("RAZORPAY_KEY_SECRET"),
		RazorpayWebhookSecret: os.Getenv("RAZORPAY_WEBHOOK_SECRET"),
		SMTPEmail:             os.Getenv("SMTP_EMAIL"),
		SMTPPassword:          os.Getenv("SMTP_PASSWORD"),
		SMTPHost:              getenv("SMTP_HOST", "smtp.gmail.com"),
		SMTPPort:              getenv("SMTP_PORT", "587"),
		MerchantNotifyEmail:   getenv("MERCHANT_NOTIFY_EMAIL", "zoroboro.ynm@gmail.com"),
		DiscordWebhookURL:     strings.TrimSpace(os.Getenv("DISCORD_WEBHOOK_URL")),
		QuotationEmail:        getenv("QUOTATION_EMAIL", "growman.live@gmail.com"),
		WaitlistEmail:         getenv("WAITLIST_EMAIL", "growman.live@gmail.com"),
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
		PlantNetAPIKey:  os.Getenv("PLANTNET_API_KEY"),
		PlantNetProject: getenv("PLANTNET_PROJECT", "all"),
		PlantNetReserve: getenvInt("PLANTNET_RESERVE", 40),
		// Google OAuth - Web Client ID for id_token verification (same as mobile/web apps)
		GoogleClientID:           firstNonEmpty(os.Getenv("GOOGLE_CLIENT_ID"), os.Getenv("NEXT_PUBLIC_GOOGLE_CLIENT_ID")),
		CloudflareAPIToken:       os.Getenv("CLOUDFLARE_API_TOKEN"),
		CloudflareZoneID:         os.Getenv("CLOUDFLARE_ZONE_ID"),
		CloudflareAccountID:      strings.TrimSpace(os.Getenv("CLOUDFLARE_ACCOUNT_ID")),
		MSG91AuthKey:             os.Getenv("MSG91_AUTH_KEY"),
		MSG91TemplateID:          os.Getenv("MSG91_TEMPLATE_ID"),
		MSG91WidgetID:            os.Getenv("MSG91_WIDGET_ID"),
		MSG91TokenAuth:           os.Getenv("MSG91_TOKEN_AUTH"),
		TruecallerClientID:       firstNonEmpty(os.Getenv("TRUECALLER_CLIENT_ID"), os.Getenv("TRUECALLER_ANDROID_CLIENT_ID")),
		StoreLatitude:            getenvFloat("STORE_LATITUDE", 0),
		StoreLongitude:           getenvFloat("STORE_LONGITUDE", 0),
		StorePincode:             strings.TrimSpace(os.Getenv("STORE_PINCODE")),
		CourierProvider:          getenv("COURIER_PROVIDER", "Shiprocket"),
		RetailMaxZone:            os.Getenv("RETAIL_MAX_ZONE"),
		ShiprocketEmail:          os.Getenv("SHIPROCKET_EMAIL"),
		ShiprocketPassword:       os.Getenv("SHIPROCKET_PASSWORD"),
		ShiprocketToken:          strings.TrimSpace(os.Getenv("SHIPROCKET_TOKEN")),
		ShiprocketPickupLocation: strings.TrimSpace(os.Getenv("SHIPROCKET_PICKUP_LOCATION")),
		ShiprocketWebhookToken:   strings.TrimSpace(os.Getenv("SHIPROCKET_WEBHOOK_TOKEN")),
		// Off by default: charge the real cost until there is enough order
		// data to know what a waiver costs per order.
		FreeDeliveryMinSubtotal: getenvFloat("FREE_DELIVERY_MIN_SUBTOTAL", 0),
		OwnVehicleMinSubtotal:   getenvFloat("OWN_VEHICLE_MIN_SUBTOTAL", 0),
		BulkMinUnits:            getenvInt("BULK_MIN_UNITS", 0),
		BulkMinSubtotal:         getenvFloat("BULK_MIN_SUBTOTAL", 0),
		DBMaxOpenConns:          getenvInt("DB_MAX_OPEN_CONNS", 40),
		DBMaxIdleConns:          getenvInt("DB_MAX_IDLE_CONNS", 10),
		RedisPoolSize:           getenvInt("REDIS_POOL_SIZE", 20),
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

	// Payment integrity depends on these secrets being present: without
	// them signature verification cannot run, and an unverifiable payment
	// must never be accepted. Fail at boot rather than at checkout.
	if isProd(cfg.AppEnv) {
		if cfg.RazorpayKeySecret == "" {
			return cfg, errors.New("RAZORPAY_KEY_SECRET is required in production to verify payment signatures")
		}
		if cfg.RazorpayWebhookSecret == "" {
			return cfg, errors.New("RAZORPAY_WEBHOOK_SECRET is required in production to verify webhook signatures (this is the dashboard webhook secret, not the API key secret)")
		}
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

func getenvFloat(key string, fallback float64) float64 {
	val := os.Getenv(key)
	if val == "" {
		return fallback
	}
	f, err := strconv.ParseFloat(val, 64)
	if err != nil || f < 0 {
		return fallback
	}
	return f
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
