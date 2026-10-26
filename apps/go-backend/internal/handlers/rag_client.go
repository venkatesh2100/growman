package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
)

// ragAnswer is the Dootha service reply. Prices in the text were checked
// against the live catalog; the cards below are loaded again from Postgres
// so the widget shows the current price and image.
type ragAnswer struct {
	Response     string   `json:"response"`
	ProductSlugs []string `json:"productSlugs"`
	Route        string   `json:"route"`
	UsedLLM      bool     `json:"usedLlm"`
}

type ragCareRequest struct {
	Species         string   `json:"species"`
	CommonNames     []string `json:"commonNames,omitempty"`
	Family          string   `json:"family,omitempty"`
	OriginCountries []string `json:"originCountries,omitempty"`
	Language        string   `json:"language,omitempty"`
}

func (h *Handler) askRAG(ctx context.Context, message string, history []ChatMessage) (ragAnswer, error) {
	if history == nil {
		history = []ChatMessage{}
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	body, status, err := h.postRAG(ctx, "/v1/answer", map[string]any{
		"message": message,
		"history": history,
	})
	if err != nil {
		return ragAnswer{}, err
	}
	if status != 200 {
		return ragAnswer{}, fmt.Errorf("rag status %d", status)
	}
	var ans ragAnswer
	if err := json.Unmarshal(body, &ans); err != nil {
		return ragAnswer{}, err
	}
	return ans, nil
}

func (h *Handler) askRAGCare(ctx context.Context, req ragCareRequest) ([]byte, error) {
	body, status, err := h.postRAG(ctx, "/v1/care", req)
	if err != nil {
		return nil, err
	}
	if status != 200 {
		return nil, fmt.Errorf("rag care status %d", status)
	}
	return body, nil
}

func (h *Handler) postRAG(ctx context.Context, path string, payload any) ([]byte, int, error) {
	base := strings.TrimRight(strings.TrimSpace(h.Cfg.RAGServiceURL), "/")
	if base == "" {
		return nil, 0, fmt.Errorf("rag service url is empty")
	}
	status, body, err := postJSONContext(ctx, base+path, payload, map[string]string{
		"X-Growman-RAG-Secret": h.Cfg.RAGSharedSecret,
	})
	return body, status, err
}

// productsBySlugs keeps the order the RAG service returned and drops anything
// that is not an active catalog row.
func (h *Handler) productsBySlugs(slugs []string) []ProductRecommendation {
	if h.DB == nil || len(slugs) == 0 {
		return nil
	}
	if len(slugs) > 3 {
		slugs = slugs[:3]
	}
	var products []models.Product
	h.DB.Select("id, name, slug, price, image_key").
		Where("status = ? AND slug IN ?", "active", slugs).
		Find(&products)
	bySlug := make(map[string]models.Product, len(products))
	for _, product := range products {
		bySlug[product.Slug] = product
	}
	out := make([]ProductRecommendation, 0, len(slugs))
	for _, slug := range slugs {
		product, ok := bySlug[slug]
		if !ok {
			continue
		}
		out = append(out, ProductRecommendation{
			ID:       product.ID,
			Name:     product.Name,
			Slug:     product.Slug,
			Price:    product.Price,
			ImageURL: h.displayPhotoURL(product.ID, product.ImageKey),
		})
	}
	return out
}
