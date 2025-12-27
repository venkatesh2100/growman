package main

import (
	"log"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/config"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/db"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/handlers"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/services/storage"
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

	// Initialize image service (optional for migrations)
	var imageService *storage.ImageService
	if cfg.ImageBaseURL != "" {
		imgSvc, err := storage.NewImageServiceFromConfig(cfg)
		if err != nil {
			log.Printf("[IMAGE] Warning: Image service initialization failed: %v. Continuing with migrations.", err)
		} else {
			imageService = imgSvc
		}
	}

	// Initialize handlers (imageService can be nil for migrations)
	h := handlers.New(dbConn, cfg, nil, imageService)

	// Run migrations
	if err := h.AutoMigrate(); err != nil {
		log.Fatalf("migration error: %v", err)
	}

	log.Println("Migrations completed successfully!")
}

