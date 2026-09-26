// Package storage abstracts image storage behind a small StorageProvider
// interface (currently backed only by Google Cloud Storage, gcs.go) and an
// ImageService that resolves a stored "image key" to a full URL — see
// internal/docs/07-images-and-storage.md.
package storage

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
)

// StorageProvider defines the interface for a cloud storage backend (currently Google Cloud Storage)
type StorageProvider interface {
	// Upload uploads a file to cloud storage and returns the image_key
	// imageKey: the path/key where the file should be stored (e.g., "products/130239.jpg")
	// file: the file content to upload
	Upload(ctx context.Context, imageKey string, file io.Reader, contentType string) error

	// Delete deletes a file from cloud storage
	Delete(ctx context.Context, imageKey string) error

	// Exists checks if a file exists in cloud storage
	Exists(ctx context.Context, imageKey string) (bool, error)
}

// ImageService provides image handling functionality
type ImageService struct {
	provider StorageProvider
	baseURL  string
}

// NewImageService creates a new ImageService with the given storage provider and base URL
func NewImageService(provider StorageProvider, baseURL string) *ImageService {
	return &ImageService{
		provider: provider,
		baseURL:  baseURL,
	}
}

// maxUploadBytes bounds how much of an upload is buffered for optimization.
const maxUploadBytes = 40 << 20

// UploadImage stores an image under imageKey, first downsizing and
// recompressing large JPEG/PNG originals (see OptimizeImage).
func (s *ImageService) UploadImage(ctx context.Context, imageKey string, file io.Reader, contentType string) error {
	data, err := io.ReadAll(io.LimitReader(file, maxUploadBytes+1))
	if err != nil {
		return fmt.Errorf("read image: %w", err)
	}
	if len(data) > maxUploadBytes {
		return fmt.Errorf("image larger than %d MB", maxUploadBytes>>20)
	}
	if optimized, ok := OptimizeImage(data, contentType); ok {
		log.Printf("[IMAGE] optimized %s: %d KB -> %d KB", imageKey, len(data)>>10, len(optimized)>>10)
		data = optimized
	}
	return s.provider.Upload(ctx, imageKey, bytes.NewReader(data), contentType)
}

// DeleteImage deletes an image from cloud storage
func (s *ImageService) DeleteImage(ctx context.Context, imageKey string) error {
	return s.provider.Delete(ctx, imageKey)
}

// ResolveImageURL builds the full image URL from an image_key
// Returns empty string if imageKey is empty
func (s *ImageService) ResolveImageURL(imageKey string) string {
	if imageKey == "" {
		return ""
	}
	// Ensure baseURL doesn't end with / and imageKey doesn't start with /
	base := s.baseURL
	if len(base) > 0 && base[len(base)-1] == '/' {
		base = base[:len(base)-1]
	}
	key := imageKey
	if len(key) > 0 && key[0] == '/' {
		key = key[1:]
	}
	return base + "/" + key
}

// ResolveImageURLs resolves multiple image keys to full URLs
func (s *ImageService) ResolveImageURLs(imageKeys []string) []string {
	urls := make([]string, 0, len(imageKeys))
	for _, key := range imageKeys {
		if url := s.ResolveImageURL(key); url != "" {
			urls = append(urls, url)
		}
	}
	return urls
}
