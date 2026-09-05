package storage

import (
	"context"
	"fmt"
	"io"

	"cloud.google.com/go/storage"
	"google.golang.org/api/option"
)

// GCSStorage implements StorageProvider for Google Cloud Storage
type GCSStorage struct {
	bucketName string
	client     *storage.Client
}

// NewGCSStorage creates a new Google Cloud Storage provider
// bucketName: GCS bucket name
// projectID: Google Cloud project ID (optional, can be empty if using default credentials)
// credentialsJSON: Path to service account JSON file (optional, can use default credentials)
func NewGCSStorage(bucketName, projectID, credentialsJSON string) (*GCSStorage, error) {
	if bucketName == "" {
		return nil, fmt.Errorf("GCS bucket name is required")
	}

	ctx := context.Background()
	var opts []option.ClientOption
	if credentialsJSON != "" {
		// Service account key file — the credential-type-specific option
		// (vs. the deprecated, type-unaware WithCredentialsFile) so an
		// unexpected credential type in that file is rejected rather than
		// silently loaded.
		opts = append(opts, option.WithAuthCredentialsFile(option.ServiceAccount, credentialsJSON))
	}
	// With no explicit credentials, the client falls back to Application
	// Default Credentials (env var, gcloud user creds, or the GCP metadata
	// server on Cloud Run/GKE/Compute Engine).
	client, err := storage.NewClient(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCS client: %w", err)
	}

	return &GCSStorage{
		bucketName: bucketName,
		client:     client,
	}, nil
}

// Upload uploads a file to Google Cloud Storage
func (g *GCSStorage) Upload(ctx context.Context, imageKey string, file io.Reader, contentType string) error {
	bucket := g.client.Bucket(g.bucketName)
	obj := bucket.Object(imageKey)

	writer := obj.NewWriter(ctx)
	if contentType != "" {
		writer.ContentType = contentType
	}

	if _, err := io.Copy(writer, file); err != nil {
		writer.Close()
		return fmt.Errorf("failed to copy file to GCS: %w", err)
	}

	if err := writer.Close(); err != nil {
		return fmt.Errorf("failed to close GCS writer: %w", err)
	}

	return nil
}

// Delete deletes a file from Google Cloud Storage
func (g *GCSStorage) Delete(ctx context.Context, imageKey string) error {
	bucket := g.client.Bucket(g.bucketName)
	obj := bucket.Object(imageKey)

	if err := obj.Delete(ctx); err != nil {
		return fmt.Errorf("failed to delete from GCS: %w", err)
	}

	return nil
}

// Exists checks if a file exists in Google Cloud Storage
func (g *GCSStorage) Exists(ctx context.Context, imageKey string) (bool, error) {
	bucket := g.client.Bucket(g.bucketName)
	obj := bucket.Object(imageKey)

	_, err := obj.Attrs(ctx)
	if err != nil {
		if err == storage.ErrObjectNotExist {
			return false, nil
		}
		return false, fmt.Errorf("failed to check existence: %w", err)
	}

	return true, nil
}

// Close closes the GCS client
func (g *GCSStorage) Close() error {
	if g.client != nil {
		return g.client.Close()
	}
	return nil
}
