package handlers

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
)

// UploadImage handles image upload requests
// Expects multipart/form-data with a file field named "image"
// Returns the image_key that should be stored in the database
func (h *Handler) UploadImage(w http.ResponseWriter, r *http.Request) {
	if h.ImageService == nil {
		httpjson.Error(w, http.StatusInternalServerError, "image service not configured")
		return
	}

	// Parse multipart form (max 10MB)
	err := r.ParseMultipartForm(10 << 20) // 10MB
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "failed to parse multipart form")
		return
	}

	file, header, err := r.FormFile("image")
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "image file is required")
		return
	}
	defer file.Close()

	prefix := sanitizeUploadPrefix(r.FormValue("prefix"))

	ext := strings.ToLower(filepath.Ext(header.Filename))
	if ext == "" {
		ext = ".jpg"
	}
	if !allowedImageExt(ext) {
		httpjson.Error(w, http.StatusBadRequest, "unsupported image type")
		return
	}

	// Generate unique filename: timestamp-random
	// timestamp := time.Now().Unix()
	// random := fmt.Sprintf("%d", time.Now().UnixNano()%1000000)
	// imageKey := fmt.Sprintf("%s/%d-%s%s", prefix, timestamp, random, ext)
	//?Generate Humanreadable names
	imageKey := GenerateImageKey(prefix, header.Filename)
	contentType := header.Header.Get("Content-Type")
	if !allowedImageMIME(contentType) {
		contentType = contentTypeFromExt(ext)
	}
	if !allowedImageMIME(contentType) {
		httpjson.Error(w, http.StatusBadRequest, "unsupported image type")
		return
	}

	// Upload to cloud storage
	err = h.ImageService.UploadImage(r.Context(), imageKey, file, contentType)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, fmt.Sprintf("failed to upload image: %v", err))
		return
	}

	// Return the image_key (client should store this in database)
	httpjson.JSON(w, http.StatusOK, map[string]string{
		"imageKey": imageKey,
		"imageUrl": h.ImageService.ResolveImageURL(imageKey),
	})
}

// GenerateImageKey generates an image key for a given prefix and optional custom name
// This is a helper function that can be used when you want to generate keys programmatically
func GenerateImageKey(prefix, filename string) string {
	if prefix == "" {
		prefix = "uploads"
	}

	ext := filepath.Ext(filename)
	if ext == "" {
		ext = ".jpg"
	}

	// If filename is provided, sanitize it
	if filename != "" {
		base := strings.TrimSuffix(filepath.Base(filename), ext)
		// Sanitize: remove special characters, keep alphanumeric and hyphens
		base = strings.ToLower(base)
		base = strings.ReplaceAll(base, " ", "-")
		base = strings.ReplaceAll(base, "_", "-")
		var sanitized strings.Builder
		for _, r := range base {
			if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
				sanitized.WriteRune(r)
			}
		}
		timestamp := time.Now().Unix()
		return fmt.Sprintf("%s/%d-%s%s", prefix, timestamp, sanitized.String(), ext)
	}

	// Generate random key
	timestamp := time.Now().Unix()
	random := fmt.Sprintf("%d", time.Now().UnixNano()%1000000)
	return fmt.Sprintf("%s/%d-%s%s", prefix, timestamp, random, ext)
}

// UploadImageFromReader uploads an image from an io.Reader
// This is useful when you already have the file data in memory
func (h *Handler) UploadImageFromReader(ctx context.Context, imageKey string, reader io.Reader, contentType string) error {
	if h.ImageService == nil {
		return fmt.Errorf("image service not configured")
	}
	return h.ImageService.UploadImage(ctx, imageKey, reader, contentType)
}

func sanitizeUploadPrefix(prefix string) string {
	prefix = strings.ToLower(strings.Trim(prefix, "/"))
	prefix = strings.ReplaceAll(prefix, "..", "")
	prefix = strings.ReplaceAll(prefix, "\\", "")
	var b strings.Builder
	for _, r := range prefix {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			b.WriteRune(r)
		}
	}
	out := b.String()
	if out == "" {
		return "uploads"
	}
	return out
}

func allowedImageExt(ext string) bool {
	switch strings.ToLower(ext) {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp":
		return true
	default:
		return false
	}
}

func allowedImageMIME(ct string) bool {
	ct = strings.ToLower(strings.TrimSpace(strings.Split(ct, ";")[0]))
	switch ct {
	case "image/jpeg", "image/png", "image/gif", "image/webp":
		return true
	default:
		return false
	}
}
