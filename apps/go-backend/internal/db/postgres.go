package db

import (
	"log"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/config"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Connect opens a GORM connection to Postgres using the provided config.
// Prioritizes Hyperdrive URL if available, otherwise falls back to direct DATABASE_URL.
func Connect(cfg config.Config) (*gorm.DB, error) {
	logLevel := logger.Silent
	if cfg.AppEnv == "development" {
		logLevel = logger.Info
	}

	gormCfg := &gorm.Config{
		Logger: logger.Default.LogMode(logLevel),
	}

	// Use Hyperdrive URL if available, otherwise use direct database URL
	connectionString := cfg.HyperdriveURL
	if connectionString == "" {
		connectionString = cfg.DatabaseURL
		if cfg.AppEnv == "development" {
			log.Println("Using direct database connection (DATABASE_URL)")
		}
	} else {
		log.Println("Using Cloudflare Hyperdrive connection (HYPERDRIVE_URL)")
	}

	db, err := gorm.Open(postgres.Open(connectionString), gormCfg)
	if err != nil {
		return nil, err
	}

	return db, nil
}
