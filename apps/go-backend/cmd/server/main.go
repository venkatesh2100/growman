package main

import (
    "log"
    "net/http"
    "fmt"

    "github.com/venkatesh2100/growman/apps/go-backend/internal/config"
    "github.com/venkatesh2100/growman/apps/go-backend/internal/db"
    "github.com/venkatesh2100/growman/apps/go-backend/internal/handlers"
    "github.com/venkatesh2100/growman/apps/go-backend/internal/server"
    "github.com/venkatesh2100/growman/apps/go-backend/seed"
)

func main() {
    fmt.Println("Server is Running")

    // Load configuration
    cfg, err := config.Load()
    if err != nil {
        log.Fatalf("config error: %v", err)
    }

    // Connect to database
    dbConn, err := db.Connect(cfg)
    if err != nil {
        log.Fatalf("db connection error: %v", err)
    }

    // Connect to Redis (returns nil if connection fails)
    rdb := db.ConnectRedis(cfg)
    defer func() {
        if rdb != nil {
            if err := rdb.Close(); err != nil {
                log.Printf("[REDIS] Error closing connection: %v", err)
            }
        }
    }()

    // Initialize handlers with Redis
    h := handlers.New(dbConn, cfg, rdb)

    // Run migrations if enabled
    if cfg.AutoMigrate {
        if err := h.AutoMigrate(); err != nil {
            log.Fatalf("migration error: %v", err)
        }
    } else {
        log.Println("AUTO_MIGRATE is disabled; skipping AutoMigrate")
    }

    // Seed database if enabled
    if cfg.SeedOnStartup {
        log.Println("SEED_ON_STARTUP is enabled, seeding sample data...")
        if err := seed.EnsureSampleData(dbConn); err != nil {
            log.Fatalf("seed error: %v", err)
        }
    } else {
        log.Println("SEED_ON_STARTUP is disabled, skipping seed. Set SEED_ON_STARTUP=true to enable automatic seeding.")
    }

    // Initialize router
    r := server.NewRouter(h, cfg)

    log.Printf("Go backend running on %s", cfg.Port)
    if err := http.ListenAndServe(cfg.Port, r); err != nil {
        log.Fatalf("server error: %v", err)
    }
}