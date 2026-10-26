package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/plantnet"
)

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

// careGuide asks the RAG service for a short care sheet grounded in the
// Growman knowledge file. The result is cached per species, so a repeat
// scan does not call the service again. Pl@ntNet does not provide care text.
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
	if strings.TrimSpace(h.Cfg.RAGServiceURL) == "" {
		return nil
	}

	var countries []string
	if origin != nil {
		countries = origin.NativeCountries
	}
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	raw, err := h.askRAGCare(ctx, ragCareRequest{
		Species:         name,
		CommonNames:     hit.CommonNames,
		Family:          hit.Family,
		OriginCountries: countries,
		Language:        lang,
	})
	if err != nil {
		log.Printf("[plants] care guide unavailable: %v", err)
		return nil
	}
	obj := extractJSONObject(string(raw))
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
