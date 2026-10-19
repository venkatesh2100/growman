// Command server is the Growman API's HTTP entrypoint: loads config,
// connects to Postgres/Redis/image storage, migrates and (optionally)
// seeds the database, then serves the router until SIGINT/SIGTERM.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/config"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/db"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/handlers"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/server"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/services/storage"
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

	rdb := db.ConnectRedis(cfg)
	defer func() {
		if rdb != nil {
			_ = rdb.Close()
		}
	}()

	var imageService *storage.ImageService
	if cfg.ImageBaseURL != "" {
		imgSvc, err := storage.NewImageServiceFromConfig(cfg)
		if err != nil {
			log.Printf("[IMAGE] init failed: %v (uploads disabled)", err)
		} else {
			imageService = imgSvc
		}
	}

	h := handlers.New(dbConn, cfg, rdb, imageService)

	if cfg.AutoMigrate {
		if err := h.AutoMigrate(); err != nil {
			log.Fatalf("migration error: %v", err)
		}
	}

	if cfg.SeedOnStartup {
		if err := seed.EnsureSampleData(dbConn); err != nil {
			log.Fatalf("seed error: %v", err)
		}
	}

	// Background workers share one context so shutdown stops them all.
	// They are deliberately started before the listener: the inventory
	// sweep in particular should run even if no request ever arrives.
	workerCtx, stopWorkers := context.WithCancel(context.Background())
	defer stopWorkers()

	// Returns stock held by orders that were never paid.
	h.StartInventorySweeper(workerCtx, 5*time.Minute)
	// Books courier shipments for paid orders, refreshes tracking as a
	// backstop for missed webhooks, and sends post-delivery review asks.
	h.StartShipmentWorker(workerCtx, 15*time.Minute)
	// Enforces DPDP purpose-limited retention.
	h.StartRetentionSweeper(workerCtx)

	handler := server.NewRouter(h, cfg)
	addr := cfg.Port
	if addr != "" && addr[0] != ':' && addr[0] != '/' {
		addr = ":" + addr
	}

	srv := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       90 * time.Second,
		MaxHeaderBytes:    1 << 16,
	}

	go func() {
		stop := make(chan os.Signal, 1)
		signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
		<-stop
		log.Printf("shutting down")
		// Stop the workers first so none of them is mid-transaction while
		// the connection pool is closing.
		stopWorkers()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()

	log.Printf("listening on %s", addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}

	// Close the pool explicitly: in-flight worker transactions have
	// already been cancelled, and leaving sockets open delays container
	// exit for no benefit.
	if sqlDB, err := dbConn.DB(); err == nil {
		_ = sqlDB.Close()
	}
}
