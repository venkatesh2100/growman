package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
)

type mapStat struct {
	Code  string  `json:"code"`
	Name  string  `json:"name"`
	Value float64 `json:"value"`
}

// DashboardMap returns map data for World and India via WAE SQL.
func (h *Handler) DashboardMap(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.FromContext(r.Context())
	if !ok {
		httpjson.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if claims.Role != "admin" && claims.Role != "superadmin" {
		httpjson.Error(w, http.StatusForbidden, "admin access required")
		return
	}

	timeFrame := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("timeFrame")))
	if timeFrame == "" {
		timeFrame = "daily"
	}
	country := strings.TrimSpace(r.URL.Query().Get("country"))
	mapType := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("mapType")))

	switch mapType {
	case "world":
		stats, err := h.fetchWorldMapStats(timeFrame)
		if err != nil {
			httpjson.Error(w, http.StatusBadGateway, err.Error())
			return
		}
		httpjson.JSON(w, http.StatusOK, map[string]any{
			"success":        true,
			"formattedStats": stats,
		})
		return
	case "country":
		if !strings.EqualFold(country, "india") {
			httpjson.Error(w, http.StatusBadRequest, "only India country map is supported")
			return
		}
		stats, err := h.fetchIndiaMapStats(timeFrame)
		if err != nil {
			httpjson.Error(w, http.StatusBadGateway, err.Error())
			return
		}
		httpjson.JSON(w, http.StatusOK, map[string]any{
			"success":        true,
			"formattedStats": stats,
		})
		return
	default:
		httpjson.Error(w, http.StatusBadRequest, "mapType must be world or country")
	}
}

func (h *Handler) fetchWorldMapStats(timeFrame string) ([]mapStat, error) {
	// World map now uses WAE directly (same approach as country map).
	return h.fetchWorldMapStatsFromWAE(timeFrame)
}

func (h *Handler) fetchWorldMapStatsFromWAE(timeFrame string) ([]mapStat, error) {
	if h.Cfg.CloudflareAccountID == "" {
		return []mapStat{}, nil
	}
	days := "1"
	if timeFrame == "weekly" {
		days = "7"
	}
	if timeFrame == "monthly" {
		days = "30"
	}

	sql := fmt.Sprintf(`
SELECT
  blob1 AS countryCode,
  SUM(_sample_interval * double1) AS requests
FROM wae_events_v2
WHERE timestamp > NOW() - INTERVAL '%s' DAY
GROUP BY countryCode
ORDER BY requests DESC
LIMIT 250`, days)

	endpoint := fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/analytics_engine/sql", h.Cfg.CloudflareAccountID)
	req, _ := http.NewRequest(http.MethodPost, endpoint, strings.NewReader(sql))
	req.Header.Set("Authorization", "Bearer "+h.Cfg.CloudflareAPIToken)

	client := &http.Client{Timeout: 20 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch world wae data")
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return []mapStat{}, nil
	}

	var parsed struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.NewDecoder(res.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("invalid world wae response")
	}

	stats := make([]mapStat, 0, len(parsed.Data))
	for _, row := range parsed.Data {
		code := strings.TrimSpace(fmt.Sprint(row["countryCode"]))
		if code == "" || strings.EqualFold(code, "null") {
			continue
		}
		value := 0.0
		switch v := row["requests"].(type) {
		case float64:
			value = v
		case int:
			value = float64(v)
		}
		stats = append(stats, mapStat{Code: code, Name: code, Value: value})
	}
	return stats, nil
}

func (h *Handler) fetchIndiaMapStats(timeFrame string) ([]mapStat, error) {
	if h.Cfg.CloudflareAPIToken == "" || h.Cfg.CloudflareAccountID == "" {
		return nil, fmt.Errorf("cloudflare account analytics is not configured")
	}
	days := "1"
	if timeFrame == "weekly" {
		days = "7"
	}
	if timeFrame == "monthly" {
		days = "30"
	}

	sql := fmt.Sprintf(`
SELECT
  blob3 AS regionCode,
  blob2 AS region,
  SUM(_sample_interval * double1) AS requests
FROM wae_events_v2
WHERE timestamp > NOW() - INTERVAL '%s' DAY
  AND blob1 = 'IN'
GROUP BY regionCode, region
ORDER BY requests DESC
LIMIT 100`, days)

	endpoint := fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/analytics_engine/sql", h.Cfg.CloudflareAccountID)
	req, _ := http.NewRequest(http.MethodPost, endpoint, strings.NewReader(sql))
	req.Header.Set("Authorization", "Bearer "+h.Cfg.CloudflareAPIToken)

	client := &http.Client{Timeout: 20 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch cloudflare wae")
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return nil, fmt.Errorf("cloudflare wae request failed")
	}

	var parsed struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.NewDecoder(res.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("invalid cloudflare wae response")
	}

	stats := make([]mapStat, 0, len(parsed.Data))
	for _, row := range parsed.Data {
		code := fmt.Sprint(row["regionCode"])
		name := fmt.Sprint(row["region"])
		value := 0.0
		switch v := row["requests"].(type) {
		case float64:
			value = v
		case int:
			value = float64(v)
		}
		stats = append(stats, mapStat{Code: code, Name: name, Value: value})
	}
	return stats, nil
}
