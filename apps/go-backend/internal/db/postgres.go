// Package db owns the two external connections every request may touch:
// Postgres via GORM (this file) and Redis (redis.go). Both are configured
// to fail soft where the rest of the app expects that — Redis is optional
// everywhere; Postgres is not.
package db

import (
	"log"
	"os"
	"time"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/config"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func Connect(cfg config.Config) (*gorm.DB, error) {
	slow := 800 * time.Millisecond
	level := logger.Warn
	if cfg.AppEnv != "development" {
		level = logger.Error
		slow = 1500 * time.Millisecond
	}
	if os.Getenv("LOG_SQL") == "1" || os.Getenv("LOG_SQL") == "true" {
		level = logger.Info
		slow = 200 * time.Millisecond
	}

	gormLogger := logger.New(
		log.New(os.Stdout, "\r\n", log.LstdFlags),
		logger.Config{
			SlowThreshold:             slow,
			LogLevel:                  level,
			IgnoreRecordNotFoundError: true,
			Colorful:                  false,
		},
	)

	gormCfg := &gorm.Config{
		Logger:                 gormLogger,
		SkipDefaultTransaction: true,
		PrepareStmt:            true,
	}

	// Prefer direct DATABASE_URL. Hyperdrive helps Cloudflare Workers ↔ Postgres;
	// using it from a local/VM Go process often adds multi-second latency per query.
	connectionString := cfg.DatabaseURL
	using := "DATABASE_URL"
	if connectionString == "" {
		connectionString = cfg.HyperdriveURL
		using = "HYPERDRIVE_URL"
	}
	if connectionString == "" {
		return nil, errNoDatabaseURL
	}
	if cfg.AppEnv == "development" {
		log.Printf("[DB] connecting via %s", using)
	}

	db, err := gorm.Open(postgres.Open(connectionString), gormCfg)
	if err != nil {
		return nil, err
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}

	maxOpen := cfg.DBMaxOpenConns
	if maxOpen <= 0 {
		maxOpen = 40
	}
	maxIdle := cfg.DBMaxIdleConns
	if maxIdle <= 0 {
		maxIdle = 10
	}
	if maxIdle > maxOpen {
		maxIdle = maxOpen
	}

	sqlDB.SetMaxOpenConns(maxOpen)
	sqlDB.SetMaxIdleConns(maxIdle)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)
	sqlDB.SetConnMaxIdleTime(10 * time.Minute)

	warm := maxIdle
	if warm > 4 {
		warm = 4
	}
	for i := 0; i < warm; i++ {
		_ = sqlDB.Ping()
	}

	return db, nil
}

var errNoDatabaseURL = errString("DATABASE_URL or HYPERDRIVE_URL is required")

type errString string

func (e errString) Error() string { return string(e) }
