package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/plantnet"
)

var errNoCareModel = errors.New("care model unavailable")

const gbifUserAgent = "Growman/1.0 (plant-care; +https://growman.live)"

// lookupOrigin uses the GBIF id already returned by species identification.
// GBIF is a separate public service, so this does not spend a Pl@ntNet credit.
func (h *Handler) lookupOrigin(ctx context.Context, gbifID string) *plantnet.Origin {
	gbifID = strings.TrimSpace(gbifID)
	if gbifID == "" {
		return nil
	}
	codes := h.gbifNativeCountries(ctx, gbifID)
	summary := plantnet.NativeCountrySummary(codes)
	if summary == "" {
		return nil
	}
	return &plantnet.Origin{
		Summary:         summary,
		NativeCountries: codes,
		Source:          "gbif",
	}
}

func (h *Handler) gbifNativeCountries(ctx context.Context, gbifID string) []string {
	key := "plantnet:gbif:" + gbifID
	now := time.Now()
	if raw, ok := h.plantLoad(ctx, key, now); ok {
		var codes []string
		if json.Unmarshal(raw, &codes) == nil {
			return codes
		}
	}
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.gbif.org/v1/species/"+gbifID+"/distributions?limit=300", nil)
	if err != nil {
		return nil
	}
	req.Header.Set("User-Agent", gbifUserAgent)
	req.Header.Set("Accept", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Printf("[plants] gbif lookup failed: %v", err)
		return nil
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil || resp.StatusCode != http.StatusOK {
		return nil
	}
	var doc struct {
		Results []struct {
			Country            string `json:"country"`
			EstablishmentMeans string `json:"establishmentMeans"`
		} `json:"results"`
	}
	if json.Unmarshal(body, &doc) != nil {
		return nil
	}
	var codes []string
	for _, row := range doc.Results {
		if strings.EqualFold(row.EstablishmentMeans, "NATIVE") {
			codes = append(codes, row.Country)
		}
	}
	codes = plantnet.CleanCountryCodes(codes)
	// Cache misses too, so an unknown id is not looked up on every scan.
	if raw, err := json.Marshal(codes); err == nil {
		h.plantSet(ctx, key, raw, 14*24*time.Hour, now)
	}
	return codes
}

func postJSONContext(ctx context.Context, url string, body any, headers map[string]string) (status int, respBody []byte, err error) {
	data, err := json.Marshal(body)
	if err != nil {
		return 0, nil, fmt.Errorf("failed to marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return 0, nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	respBody, err = io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return 0, nil, err
	}
	return resp.StatusCode, respBody, nil
}

// careGuide asks the configured chat model for a short care sheet.
// The result is cached per species, so a repeat scan does not call the
// model again. Pl@ntNet does not provide care or origin text.
func (h *Handler) careGuide(ctx context.Context, hit plantnet.SpeciesHit, lang string, origin *plantnet.Origin) map[string]any {
	name := hit.ScientificNameWithoutAuthor
	if name == "" {
		name = hit.ScientificName
	}
	if strings.TrimSpace(name) == "" {
		return nil
	}
	if lang == "" {
		lang = "en"
	}
	key := "plantnet:care:v1:" + lang + ":" + plantnet.Binomial(name)
	now := time.Now()
	if raw, ok := h.plantLoad(ctx, key, now); ok {
		var cached map[string]any
		if json.Unmarshal(raw, &cached) == nil && len(cached) > 0 {
			return cached
		}
	}
	if h.Cfg.GeminiAPIKey == "" && h.Cfg.OpenAIAPIKey == "" {
		return nil
	}

	var b strings.Builder
	b.WriteString("Species: " + name + "\n")
	if hit.ScientificName != "" && hit.ScientificName != name {
		b.WriteString("Full name: " + hit.ScientificName + "\n")
	}
	if len(hit.CommonNames) > 0 {
		b.WriteString("Common names: " + strings.Join(hit.CommonNames, ", ") + "\n")
	}
	if hit.Family != "" {
		b.WriteString("Family: " + hit.Family + "\n")
	}
	if origin != nil && len(origin.NativeCountries) > 0 {
		b.WriteString("GBIF native country codes: " + strings.Join(origin.NativeCountries, ", ") + "\n")
	}
	b.WriteString("Language: " + lang + "\n")

	system := `You write a short care sheet for one plant grown in an Indian home or garden.
Reply with a single JSON object and nothing else.
Keys: origin, light, water, soil, temperature, fertilizer, pests, diseases.
origin is one sentence. pests and diseases are arrays of at most 4 short names of typical problems, not a diagnosis of a photo.
If GBIF native country codes are given, origin must agree with them.
If you are unsure, say so briefly instead of inventing a precise number.`

	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	text, err := h.completeJSON(ctx, system, b.String())
	if err != nil {
		log.Printf("[plants] care guide unavailable: %v", err)
		return nil
	}
	obj := extractJSONObject(text)
	var guide struct {
		Origin      string   `json:"origin"`
		Light       string   `json:"light"`
		Water       string   `json:"water"`
		Soil        string   `json:"soil"`
		Temperature string   `json:"temperature"`
		Fertilizer  string   `json:"fertilizer"`
		Pests       []string `json:"pests"`
		Diseases    []string `json:"diseases"`
	}
	if json.Unmarshal([]byte(obj), &guide) != nil {
		return nil
	}
	out := map[string]any{}
	put := func(k, v string) {
		v = clipText(v, 240)
		if v != "" {
			out[k] = v
		}
	}
	put("origin", guide.Origin)
	put("light", guide.Light)
	put("water", guide.Water)
	put("soil", guide.Soil)
	put("temperature", guide.Temperature)
	put("fertilizer", guide.Fertilizer)
	if pests := clipList(guide.Pests, 4); len(pests) > 0 {
		out["pests"] = pests
	}
	if diseases := clipList(guide.Diseases, 4); len(diseases) > 0 {
		out["diseases"] = diseases
	}
	if len(out) == 0 {
		return nil
	}
	out["source"] = "guidance"
	if raw, err := json.Marshal(out); err == nil {
		h.plantSet(ctx, key, raw, 14*24*time.Hour, now)
	}
	return out
}

func (h *Handler) completeJSON(ctx context.Context, system, user string) (string, error) {
	provider := strings.ToLower(h.Cfg.AIProvider)
	switch provider {
	case "gemini":
		return h.careGemini(ctx, system, user)
	case "openai":
		return h.careOpenAI(ctx, system, user)
	default:
		if h.Cfg.GeminiAPIKey != "" {
			return h.careGemini(ctx, system, user)
		}
		return h.careOpenAI(ctx, system, user)
	}
}

func (h *Handler) careGemini(ctx context.Context, system, user string) (string, error) {
	if h.Cfg.GeminiAPIKey == "" {
		return "", errNoCareModel
	}
	reqBody := GeminiRequest{
		SystemInstruction: &GeminiContent{Parts: []GeminiPart{{Text: system}}},
		Contents: []GeminiContent{{
			Role:  "user",
			Parts: []GeminiPart{{Text: user}},
		}},
	}
	reqBody.GenerationConfig.Temperature = 0.2
	reqBody.GenerationConfig.MaxOutputTokens = 500
	apiURL := "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent"
	status, body, err := postJSONContext(ctx, apiURL, reqBody, map[string]string{"X-goog-api-key": h.Cfg.GeminiAPIKey})
	if err != nil {
		return "", err
	}
	if status != http.StatusOK {
		return "", errNoCareModel
	}
	var resp GeminiResponse
	if json.Unmarshal(body, &resp) != nil || len(resp.Candidates) == 0 || len(resp.Candidates[0].Content.Parts) == 0 {
		return "", errNoCareModel
	}
	return resp.Candidates[0].Content.Parts[0].Text, nil
}

func (h *Handler) careOpenAI(ctx context.Context, system, user string) (string, error) {
	if h.Cfg.OpenAIAPIKey == "" {
		return "", errNoCareModel
	}
	reqBody := map[string]any{
		"model": "gpt-3.5-turbo",
		"messages": []ChatMessage{
			{Role: "system", Content: system},
			{Role: "user", Content: user},
		},
		"max_tokens":      500,
		"temperature":     0.2,
		"response_format": map[string]string{"type": "json_object"},
	}
	status, body, err := postJSONContext(ctx, "https://api.openai.com/v1/chat/completions", reqBody, map[string]string{
		"Authorization": "Bearer " + h.Cfg.OpenAIAPIKey,
	})
	if err != nil {
		return "", err
	}
	if status != http.StatusOK {
		return "", errNoCareModel
	}
	var resp OpenAIResponse
	if json.Unmarshal(body, &resp) != nil || len(resp.Choices) == 0 {
		return "", errNoCareModel
	}
	return resp.Choices[0].Message.Content, nil
}

func extractJSONObject(s string) string {
	s = strings.TrimSpace(s)
	i := strings.Index(s, "{")
	j := strings.LastIndex(s, "}")
	if i < 0 || j <= i {
		return ""
	}
	return s[i : j+1]
}

func clipText(s string, max int) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	runes := []rune(s)
	return strings.TrimSpace(string(runes[:max]))
}

func clipList(items []string, max int) []string {
	var out []string
	for _, item := range items {
		item = clipText(item, 80)
		if item == "" {
			continue
		}
		out = append(out, item)
		if len(out) >= max {
			break
		}
	}
	return out
}
