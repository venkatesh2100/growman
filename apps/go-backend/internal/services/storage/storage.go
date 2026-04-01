package storage

import (
	"context"
	"io"
)

// StorageProvider defines the interface for storage providers (Azure, GCS, S3, etc.)
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

// UploadImage uploads an image to cloud storage and returns the image_key
func (s *ImageService) UploadImage(ctx context.Context, imageKey string, file io.Reader, contentType string) error {
	return s.provider.Upload(ctx, imageKey, file, contentType)
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

