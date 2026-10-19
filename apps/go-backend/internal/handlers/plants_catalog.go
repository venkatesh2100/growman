package handlers

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/plantnet"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
)

// The catalog routes below are not identify calls. Projects and languages
// are unlimited. Species, diseases, varieties, and quota have their own
// daily budgets, so responses are cached and the species list refuses an
// unpaginated download of the world flora.

func (h *Handler) PlantNetStatus(w http.ResponseWriter, r *http.Request) {
	h.servePlantGet(w, r, "/v2/_status", nil, 30*time.Second)
}

func (h *Handler) PlantNetLanguages(w http.ResponseWriter, r *http.Request) {
	h.servePlantGet(w, r, "/v2/languages", nil, 24*time.Hour)
}

func (h *Handler) PlantNetProjects(w http.ResponseWriter, r *http.Request) {
	if strings.EqualFold(r.URL.Query().Get("type"), "legacy") {
		httpjson.Error(w, http.StatusBadRequest, "Legacy floras use an outdated model and are not available here.")
		return
	}
	q := url.Values{}
	if raw := strings.TrimSpace(r.URL.Query().Get("lang")); raw != "" {
		lang := strings.ToLower(raw)
		if !plantnet.ValidLang(lang) {
			httpjson.Error(w, http.StatusBadRequest, "unsupported language")
			return
		}
		q.Set("lang", lang)
	}
	lat, lon, ok := parseLatLon(r.URL.Query().Get("lat"), r.URL.Query().Get("lon"))
	if r.URL.Query().Get("lat") != "" || r.URL.Query().Get("lon") != "" {
		if !ok {
			httpjson.Error(w, http.StatusBadRequest, "lat and lon must be decimal degrees")
			return
		}
		q.Set("lat", strconv.FormatFloat(lat, 'f', 4, 64))
		q.Set("lon", strconv.FormatFloat(lon, 'f', 4, 64))
	}
	h.servePlantGet(w, r, "/v2/projects", q, 24*time.Hour)
}

func (h *Handler) PlantNetSpecies(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("images") == "true" {
		httpjson.Error(w, http.StatusBadRequest, "Species illustrations require a Pl@ntNet pro plan, so this route does not request them.")
		return
	}
	prefix := strings.TrimSpace(r.URL.Query().Get("prefix"))
	page := strings.TrimSpace(r.URL.Query().Get("page"))
	if prefix == "" && page == "" {
		httpjson.Error(w, http.StatusBadRequest, "Pass prefix or page. The full species list is too large to pull on the free plan.")
		return
	}
	if len(prefix) > 80 {
		httpjson.Error(w, http.StatusBadRequest, "prefix is too long")
		return
	}
	q := url.Values{}
	if prefix != "" {
		q.Set("prefix", prefix)
	}
	if page != "" {
		p, err := strconv.Atoi(page)
		if err != nil || p < 1 {
			httpjson.Error(w, http.StatusBadRequest, "page must be a positive integer")
			return
		}
		q.Set("page", strconv.Itoa(p))
		q.Set("pageSize", strconv.Itoa(boundedPageSize(r.URL.Query().Get("pageSize"))))
	}
	if lang := strings.TrimSpace(r.URL.Query().Get("lang")); lang != "" {
		if !plantnet.ValidLang(strings.ToLower(lang)) {
			httpjson.Error(w, http.StatusBadRequest, "unsupported language")
			return
		}
		q.Set("lang", strings.ToLower(lang))
	}
	path := "/v2/species"
	if project := strings.TrimSpace(r.URL.Query().Get("project")); project != "" {
		if !plantnet.ValidProject(project) {
			httpjson.Error(w, http.StatusBadRequest, "unknown project")
			return
		}
		path = "/v2/projects/" + url.PathEscape(project) + "/species"
	}
	h.servePlantGet(w, r, path, q, 6*time.Hour)
}

func (h *Handler) PlantNetDiseases(w http.ResponseWriter, r *http.Request) {
	q, ok := catalogQuery(w, r)
	if !ok {
		return
	}
	h.servePlantGet(w, r, "/v2/diseases", q, 24*time.Hour)
}

func (h *Handler) PlantNetVarieties(w http.ResponseWriter, r *http.Request) {
	q, ok := catalogQuery(w, r)
	if !ok {
		return
	}
	h.servePlantGet(w, r, "/v2/varieties", q, 24*time.Hour)
}

func (h *Handler) PlantNetQuota(w http.ResponseWriter, r *http.Request) {
	if h.Cfg.PlantNetAPIKey == "" {
		httpjson.Error(w, http.StatusServiceUnavailable, "plant identification not configured")
		return
	}
	granted, err := h.cachedPlantGet(r.Context(), "/v2/quota", nil, time.Minute)
	if err != nil {
		writePlantNetError(w, err)
		return
	}
	today, err := h.cachedPlantGet(r.Context(), "/v2/quota/daily", nil, 45*time.Second)
	if err != nil {
		writePlantNetError(w, err)
		return
	}
	payload := map[string]any{
		"granted": json.RawMessage(granted),
		"today":   json.RawMessage(today),
		"reserve": h.Cfg.PlantNetReserve,
	}
	if n, ok := h.identifyRemaining(r.Context(), time.Now()); ok {
		payload["identifyRemaining"] = n
	}
	if r.URL.Query().Get("history") == "1" {
		history, err := h.cachedPlantGet(r.Context(), "/v2/quota/history", nil, time.Hour)
		if err != nil {
			writePlantNetError(w, err)
			return
		}
		payload["history"] = json.RawMessage(history)
	}
	httpjson.JSON(w, http.StatusOK, payload)
}

func (h *Handler) servePlantGet(w http.ResponseWriter, r *http.Request, path string, q url.Values, ttl time.Duration) {
	if h.Cfg.PlantNetAPIKey == "" {
		httpjson.Error(w, http.StatusServiceUnavailable, "plant identification not configured")
		return
	}
	raw, err := h.cachedPlantGet(r.Context(), path, q, ttl)
	if err != nil {
		writePlantNetError(w, err)
		return
	}
	httpjson.Raw(w, http.StatusOK, raw)
}

func catalogQuery(w http.ResponseWriter, r *http.Request) (url.Values, bool) {
	q := url.Values{}
	prefix := strings.TrimSpace(r.URL.Query().Get("prefix"))
	if len(prefix) > 80 {
		httpjson.Error(w, http.StatusBadRequest, "prefix is too long")
		return nil, false
	}
	if prefix != "" {
		q.Set("prefix", prefix)
	}
	if lang := strings.TrimSpace(r.URL.Query().Get("lang")); lang != "" {
		lang = strings.ToLower(lang)
		if !plantnet.ValidLang(lang) {
			httpjson.Error(w, http.StatusBadRequest, "unsupported language")
			return nil, false
		}
		q.Set("lang", lang)
	}
	return q, true
}

func boundedPageSize(s string) int {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil || n < 1 {
		return 20
	}
	if n > 20 {
		return 20
	}
	return n
}
