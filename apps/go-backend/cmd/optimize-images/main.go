// Command optimize-images shrinks images already stored in the GCS bucket
// (same keys, so no database change) and sets an immutable Cache-Control on
// every image, so the storefront stops pulling multi-megabyte originals.
//
//	go run ./cmd/optimize-images -dry-run            # report only
//	go run ./cmd/optimize-images                     # rewrite in place
//	go run ./cmd/optimize-images -prefix products/   # limit to a folder
package main

import (
	"context"
	"flag"
	"log"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/config"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/services/storage"
)

func main() {
	dryRun := flag.Bool("dry-run", false, "report what would change without writing")
	prefix := flag.String("prefix", "", "only process keys with this prefix")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config error: %v", err)
	}
	if cfg.GCSBucketName == "" {
		log.Fatal("GCS_BUCKET_NAME is not set")
	}
	gcs, err := storage.NewGCSStorage(cfg.GCSBucketName, cfg.GCSProjectID, cfg.GCSCredentialsJSON)
	if err != nil {
		log.Fatalf("gcs: %v", err)
	}
	defer gcs.Close()

	res, err := gcs.OptimizeExisting(context.Background(), *prefix, *dryRun, log.Printf)
	if err != nil {
		log.Fatalf("optimize: %v", err)
	}
	mode := "done"
	if *dryRun {
		mode = "dry run"
	}
	log.Printf("%s: %d images scanned, %d downsized, %d cache headers fixed, %d failed; %.1f MB -> %.1f MB",
		mode, res.Scanned, res.Optimized, res.CacheFixed, res.Failed,
		float64(res.BytesBefore)/(1<<20), float64(res.BytesAfter)/(1<<20))
}
