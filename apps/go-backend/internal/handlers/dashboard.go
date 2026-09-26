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

// mapStat is one row of the admin dashboard's request-count-by-region map.
type mapStat struct {
	Code  string  `json:"code"`
	Name  string  `json:"name"`
	Value float64 `json:"value"`
}

// waeHTTPClient is reused across Cloudflare Analytics Engine (WAE) calls
// rather than constructing a new *http.Client per request.
var waeHTTPClient = &http.Client{Timeout: 20 * time.Second}

// DashboardMap returns request-volume-by-region data for the admin map
// widget (world choropleth, or a drill-down into India's states), backed by
// Cloudflare's Workers Analytics Engine SQL API — see 09-external-integrations.md.
func (h *Handler) DashboardMap(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	if !appauth.IsAdminRole(claims.Role) {
		httpjson.Error(w, http.StatusForbidden, "admin access required")
		return
	}

	timeFrame := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("timeFrame")))
	if timeFrame == "" {
		timeFrame = "daily"
	}
	country := strings.TrimSpace(r.URL.Query().Get("country"))
	mapType := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("mapType")))

	var (
		stats []mapStat
		err   error
	)
	switch mapType {
	case "world":
		stats, err = h.fetchWorldMapStats(timeFrame)
	case "country":
		if !strings.EqualFold(country, "india") {
			httpjson.Error(w, http.StatusBadRequest, "only India country map is supported")
			return
		}
		stats, err = h.fetchIndiaMapStats(timeFrame)
	default:
		httpjson.Error(w, http.StatusBadRequest, "mapType must be world or country")
		return
	}
	if err != nil {
		httpjson.Error(w, http.StatusBadGateway, err.Error())
		return
	}
	httpjson.JSON(w, http.StatusOK, map[string]any{"success": true, "formattedStats": stats})
}

// daysForTimeFrame maps the UI's "daily"/"weekly"/"monthly" filter to the
// SQL INTERVAL day-count WAE queries filter on.
func daysForTimeFrame(timeFrame string) string {
	switch timeFrame {
	case "weekly":
		return "7"
	case "monthly":
		return "30"
	default:
		return "1"
	}
}

// queryWAE POSTs a SQL query to Cloudflare's Analytics Engine and returns
// the decoded result rows. Shared by the world and India map queries below —
// they differ only in the SQL text and in how strictly they treat a
// non-2xx/undecodable response (see each caller).
func (h *Handler) queryWAE(sql string) (rows []map[string]any, status int, err error) {
	endpoint := fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/analytics_engine/sql", h.Cfg.CloudflareAccountID)
	req, err := http.NewRequest(http.MethodPost, endpoint, strings.NewReader(sql))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+h.Cfg.CloudflareAPIToken)

	res, err := waeHTTPClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return nil, res.StatusCode, nil
	}

	var parsed struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.NewDecoder(res.Body).Decode(&parsed); err != nil {
		return nil, res.StatusCode, err
	}
	return parsed.Data, res.StatusCode, nil
}

// waeFloat reads a WAE numeric result cell, which JSON-decodes as either
// float64 or int depending on the aggregate used.
func waeFloat(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	default:
		return 0
	}
}

// fetchWorldMapStats returns request counts per country. Soft-fails to an
// empty result (not an error) when Cloudflare analytics isn't configured or
// the API call itself doesn't succeed — the world map is a "nice to have"
// widget, not worth surfacing an error banner for.
func (h *Handler) fetchWorldMapStats(timeFrame string) ([]mapStat, error) {
	if h.Cfg.CloudflareAccountID == "" {
		return []mapStat{}, nil
	}
	sql := fmt.Sprintf(`
SELECT
  blob1 AS countryCode,
  SUM(_sample_interval * double1) AS requests
FROM wae_events_v2
WHERE timestamp > NOW() - INTERVAL '%s' DAY
GROUP BY countryCode
ORDER BY requests DESC
LIMIT 250`, daysForTimeFrame(timeFrame))

	rows, status, err := h.queryWAE(sql)
	if err != nil || status >= 300 {
		return []mapStat{}, nil
	}

	stats := make([]mapStat, 0, len(rows))
	for _, row := range rows {
		code := strings.TrimSpace(fmt.Sprint(row["countryCode"]))
		if code == "" || strings.EqualFold(code, "null") {
			continue
		}
		stats = append(stats, mapStat{Code: code, Name: code, Value: waeFloat(row["requests"])})
	}
	return stats, nil
}

// fetchIndiaMapStats returns request counts per Indian state/region. Unlike
// the world map, this drill-down is user-requested explicitly, so a
// misconfiguration or failed query is reported as a real error instead of
// silently returning an empty map.
func (h *Handler) fetchIndiaMapStats(timeFrame string) ([]mapStat, error) {
	if h.Cfg.CloudflareAPIToken == "" || h.Cfg.CloudflareAccountID == "" {
		return nil, fmt.Errorf("cloudflare account analytics is not configured")
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
LIMIT 100`, daysForTimeFrame(timeFrame))

	rows, status, err := h.queryWAE(sql)
	if err != nil {
		return nil, fmt.Errorf("cloudflare wae query failed: %w", err)
	}
	if status >= 300 {
		return nil, fmt.Errorf("cloudflare wae request failed (status %d)", status)
	}

	stats := make([]mapStat, 0, len(rows))
	for _, row := range rows {
		stats = append(stats, mapStat{
			Code:  fmt.Sprint(row["regionCode"]),
			Name:  fmt.Sprint(row["region"]),
			Value: waeFloat(row["requests"]),
		})
	}
	return stats, nil
}
