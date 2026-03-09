package handlers

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/http"

	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
)

const plantnetIdentifyURL = "https://my-api.plantnet.org/v2/identify/all"

// IdentifyPlant handles plant identification requests by proxying to Pl@ntNet API.
// Expects multipart/form-data with "image" file(s). Optional "organs" (auto, flower, leaf, fruit, bark).
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

	// Add image files
	for _, fh := range files {
		file, err := fh.Open()
		if err != nil {
			httpjson.Error(w, http.StatusBadRequest, "failed to read image file")
			return
		}
		part, err := mpw.CreateFormFile("images", fh.Filename)
		if err != nil {
			file.Close()
			httpjson.Error(w, http.StatusInternalServerError, "failed to build request")
			return
		}
		_, err = io.Copy(part, file)
		file.Close()
		if err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "failed to read image")
			return
		}
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
