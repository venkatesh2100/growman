package main

import (
	"log"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/config"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/db"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/handlers"
)

func main() {
	log.Println("Running database migrations...")

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

	// Initialize handlers
	h := handlers.New(dbConn, cfg, nil)

	// Run migrations
	if err := h.AutoMigrate(); err != nil {
		log.Fatalf("migration error: %v", err)
	}

	log.Println("Migrations completed successfully!")
}

