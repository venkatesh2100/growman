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
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config error: %v", err)
	}

	dbConn, err := db.Connect(cfg)
	if err != nil {
		log.Fatalf("db connection error: %v", err)
	}

	h := handlers.New(dbConn, cfg)
	if cfg.AutoMigrate {
		if err := h.AutoMigrate(); err != nil {
			log.Fatalf("migration error: %v", err)
		}
	} else {
		log.Println("AUTO_MIGRATE is disabled; skipping AutoMigrate")
	}

	if cfg.SeedOnStartup {
		log.Println("SEED_ON_STARTUP is enabled, seeding sample data...")
		if err := seed.EnsureSampleData(dbConn); err != nil {
			log.Fatalf("seed error: %v", err)
		}
	} else {
		log.Println("SEED_ON_STARTUP is disabled, skipping seed. Set SEED_ON_STARTUP=true to enable automatic seeding.")
	}

	r := server.NewRouter(h, cfg)

	log.Printf("Go backend running on %s", cfg.Port)
	if err := http.ListenAndServe(cfg.Port, r); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

func main()  {
	fmt.Println("Hello world")
}
