package storage

import (
	"fmt"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/config"
)

// NewStorageProvider creates a storage provider based on configuration.
// Google Cloud Storage is the only supported provider.
func NewStorageProvider(cfg config.Config) (StorageProvider, error) {
	if cfg.GCSBucketName == "" {
		return nil, fmt.Errorf("no storage provider configured: set GCS_BUCKET_NAME")
	}

	// Credentials resolution order (handled by NewGCSStorage):
	// 1. GCS_CREDENTIALS_JSON — path to a service account key file
	// 2. Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS env var,
	//    gcloud user credentials, or the GCP metadata server when running on
	//    Cloud Run/GKE/Compute Engine)
	return NewGCSStorage(cfg.GCSBucketName, cfg.GCSProjectID, cfg.GCSCredentialsJSON)
}

// NewImageServiceFromConfig creates an ImageService from configuration
func NewImageServiceFromConfig(cfg config.Config) (*ImageService, error) {
	if cfg.ImageBaseURL == "" {
		return nil, fmt.Errorf("IMAGE_BASE_URL is required")
	}

	provider, err := NewStorageProvider(cfg)
	if err != nil {
		return nil, err
	}

	return NewImageService(provider, cfg.ImageBaseURL), nil
}
