package storage

import (
	"fmt"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/config"
)

// NewStorageProvider creates a storage provider based on configuration
// Currently supports Azure Blob Storage and Google Cloud Storage
// The provider is determined by which credentials are provided
func NewStorageProvider(cfg config.Config) (StorageProvider, error) {
	// Check for Azure credentials
	if cfg.AzureAccountName != "" && cfg.AzureAccountKey != "" && cfg.AzureContainerName != "" {
		return NewAzureBlobStorage(cfg.AzureAccountName, cfg.AzureAccountKey, cfg.AzureContainerName)
	}

	// Check for GCS credentials
	if cfg.GCSBucketName != "" {
		// For GCS, credentials can come from:
		// 1. Service account JSON file path (GCS_CREDENTIALS_JSON env var)
		// 2. Default credentials (from environment or metadata server)
		credentialsJSON := "" // You can add GCS_CREDENTIALS_JSON to config if needed
		return NewGCSStorage(cfg.GCSBucketName, cfg.GCSProjectID, credentialsJSON)
	}

	// No storage provider configured - return nil (optional, for development)
	// In production, you might want to return an error
	return nil, fmt.Errorf("no storage provider configured. Set either Azure or GCS credentials")
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

