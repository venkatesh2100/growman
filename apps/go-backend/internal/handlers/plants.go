package handlers

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
)

const plantnetIdentifyURL = "https://my-api.plantnet.org/v2/identify/all"

func contentTypeFromExt(ext string) string {
	switch strings.ToLower(ext) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	default:
		return "image/jpeg"
	}
}

// IdentifyPlant handles plant identification requests by proxying to Pl@ntNet API.
// Expects multipart/form-data with "image" file(s). Optional "organs" (auto, flower, leaf, fruit, bark).
// Plant images are silently uploaded to cloud storage in the background.
func (h *Handler) IdentifyPlant(w http.ResponseWriter, r *http.Request) {
	apiKey := h.Cfg.PlantNetAPIKey
	if apiKey == "" {
		httpjson.Error(w, http.StatusServiceUnavailable, "plant identification not configured")
		return
	}

	// Parse incoming multipart form (max 50MB per Pl@ntNet limits)
	err := r.ParseMultipartForm(50 << 20)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "failed to parse multipart form")
		return
	}

	// Get image files - support "image" or "images" for multiple
	form := r.MultipartForm
	files := form.File["image"]
	if len(files) == 0 {
		files = form.File["images"]
	}
	if len(files) == 0 {
		httpjson.Error(w, http.StatusBadRequest, "at least one image is required")
		return
	}
	if len(files) > 5 {
		httpjson.Error(w, http.StatusBadRequest, "maximum 5 images allowed")
		return
	}

	// Read all files into buffers (needed for Pl@ntNet and cloud storage upload)
	type fileData struct {
		buf         []byte
		contentType string
		filename    string
	}
	var fileBuffers []fileData

	// Build multipart request to Pl@ntNet
	body := &bytes.Buffer{}
	mpw := multipart.NewWriter(body)

	// Add organs - use "auto" for each image if not provided
	organs := r.Form["organs"]
	for i := 0; i < len(files); i++ {
		organ := "auto"
		if i < len(organs) && organs[i] != "" {
			organ = organs[i]
		}
		_ = mpw.WriteField("organs", organ)
	}

	// Add image files and collect buffers for cloud storage upload
	for _, fh := range files {
		file, err := fh.Open()
		if err != nil {
			httpjson.Error(w, http.StatusBadRequest, "failed to read image file")
			return
		}
		buf := &bytes.Buffer{}
		_, err = io.Copy(buf, file)
		file.Close()
		if err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "failed to read image")
			return
		}

		// Write to Pl@ntNet multipart
		part, err := mpw.CreateFormFile("images", fh.Filename)
		if err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "failed to build request")
			return
		}
		_, _ = part.Write(buf.Bytes())

		// Keep copy for silent cloud storage upload (goroutine will use it)
		contentType := fh.Header.Get("Content-Type")
		if contentType == "" {
			contentType = contentTypeFromExt(filepath.Ext(fh.Filename))
		}
		fileBuffers = append(fileBuffers, fileData{
			buf:         append([]byte(nil), buf.Bytes()...),
			contentType: contentType,
			filename:    fh.Filename,
		})
	}

	// Optional params
	if nb := r.FormValue("nb-results"); nb != "" {
		_ = mpw.WriteField("nb-results", nb)
	}
	if lang := r.FormValue("lang"); lang != "" {
		_ = mpw.WriteField("lang", lang)
	}

	if err := mpw.Close(); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to build request")
		return
	}

	// Silently upload plant images to cloud storage in the background (non-blocking)
	if h.ImageService != nil && len(fileBuffers) > 0 {
		buffers := fileBuffers
		go func() {
			ctx := context.Background()
			for i, fd := range buffers {
				filename := fd.filename
				if len(buffers) > 1 {
					base := strings.TrimSuffix(filename, filepath.Ext(filename))
					ext := filepath.Ext(filename)
					filename = fmt.Sprintf("%s-%d%s", base, i+1, ext)
				}
				imageKey := GenerateImageKey("plants", filename)
				err := h.ImageService.UploadImage(ctx, imageKey, bytes.NewReader(fd.buf), fd.contentType)
				if err != nil {
					log.Printf("[plants] silent cloud storage upload failed for %s: %v", fd.filename, err)
				}
			}
		}()
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, plantnetIdentifyURL+"?api-key="+apiKey, body)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to create request")
		return
	}
	req.Header.Set("Content-Type", mpw.FormDataContentType())

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		httpjson.Error(w, http.StatusBadGateway, "plant identification service unavailable")
		return
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		httpjson.Error(w, http.StatusBadGateway, "failed to read identification response")
		return
	}

	if resp.StatusCode != http.StatusOK {
		httpjson.Error(w, resp.StatusCode, "plant identification failed")
		return
	}

	// Return raw JSON from Pl@ntNet for full compatibility
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(respBody)
}
