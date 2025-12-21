package db

import (
	"log"
	"time"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/config"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Connect opens a GORM connection to Postgres using the provided config.
// Prioritizes Hyperdrive URL if available, otherwise falls back to direct DATABASE_URL.
// Configures connection pooling for optimal performance.
func Connect(cfg config.Config) (*gorm.DB, error) {
	logLevel := logger.Silent
	if cfg.AppEnv == "development" {
		logLevel = logger.Info
	}

	gormCfg := &gorm.Config{
		Logger: logger.Default.LogMode(logLevel),
		// Disable automatic transaction for better performance
		SkipDefaultTransaction: true,
		// Prepare statements for better performance
		PrepareStmt: true,
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

	// Configure connection pooling for optimal performance
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}

	// Set maximum number of open connections
	// For Google Cloud, keep this reasonable to avoid connection exhaustion
	sqlDB.SetMaxOpenConns(25) // Adjust based on your database tier
	sqlDB.SetMaxIdleConns(10) // Keep some idle connections for faster response
	sqlDB.SetConnMaxLifetime(5 * time.Minute) // Recycle connections periodically
	sqlDB.SetConnMaxIdleTime(10 * time.Minute) // Close idle connections after 10 minutes

	log.Println("Database connection pool configured: MaxOpen=25, MaxIdle=10")

	return db, nil
}
