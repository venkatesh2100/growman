package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/config"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/services"
)

const chromeUA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"

func TestReportLongBrowseSkipsBotsBeforeLookup(t *testing.T) {
	services.ResetVisitorCache()
	t.Cleanup(services.ResetVisitorCache)
	lookups := 0
	restoreFetch := services.SetPlaceFetchForTest(func(context.Context, string) (services.Place, error) {
		lookups++
		t.Error("geolocation ran for a bot")
		return services.Place{}, nil
	})
	t.Cleanup(restoreFetch)
	posted := make(chan struct{}, 1)
	restoreDiscord := services.ReplaceDiscordDeliver(func(context.Context, string, []byte) error {
		posted <- struct{}{}
		return nil
	})
	t.Cleanup(restoreDiscord)

	h := &Handler{Cfg: config.Config{DiscordWebhookURL: "https://discord.com/api/webhooks/1/token"}}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/engagement/long-browse", strings.NewReader(`{"durationMin":15,"path":"/"}`))
	req.Header.Set("User-Agent", "curl/8.4.0")
	req.Header.Set("Accept-Language", "en")
	req.Header.Set("X-Forwarded-For", "49.36.14.30")
	rr := httptest.NewRecorder()
	h.ReportLongBrowse(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("status %d", rr.Code)
	}
	select {
	case <-posted:
		t.Fatal("bot was posted to Discord")
	case <-time.After(150 * time.Millisecond):
	}
	if lookups != 0 {
		t.Fatalf("lookups = %d", lookups)
	}
}

func TestReportLongBrowsePostsCoordinatesForAPerson(t *testing.T) {
	services.ResetVisitorCache()
	t.Cleanup(services.ResetVisitorCache)
	restoreFetch := services.SetPlaceFetchForTest(func(context.Context, string) (services.Place, error) {
		return services.Place{
			City: "Hyderabad", Region: "Telangana", Postal: "500001", Country: "India",
			Timezone: "Asia/Kolkata",
			Lat:      17.385044, Lng: 78.486671, HasCoord: true,
			ISP: "Jio", Org: "Reliance Jio Infocomm", ASN: 55836,
		}, nil
	})
	t.Cleanup(restoreFetch)
	posted := make(chan string, 1)
	restoreDiscord := services.ReplaceDiscordDeliver(func(_ context.Context, _ string, body []byte) error {
		posted <- string(body)
		return nil
	})
	t.Cleanup(restoreDiscord)

	h := &Handler{Cfg: config.Config{DiscordWebhookURL: "https://discord.com/api/webhooks/1/token"}}
	body := `{"durationMin":12,"path":"/shop","paths":["/","/shop"],"referrer":"https://google.com","screen":"1080x2400","viewport":"412x915","timezone":"Asia/Kolkata","languages":"en-IN","platform":"Android","cores":8,"touch":5,"sessionId":"sess-1"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/engagement/long-browse", strings.NewReader(body))
	req.Header.Set("User-Agent", chromeUA)
	req.Header.Set("Accept-Language", "en-IN")
	req.Header.Set("Sec-Fetch-Mode", "cors")
	req.Header.Set("X-Forwarded-For", "1.2.3.4, 49.36.14.31")
	rr := httptest.NewRecorder()
	h.ReportLongBrowse(rr, req)

	select {
	case payload := <-posted:
		for _, want := range []string{
			`"name":"Exact IP","value":"49.36.14.31"`,
			"Hyderabad",
			"17.385044, 78.486671",
			"google.com/maps",
			"AS55836",
			"1080x2400",
			"/shop",
		} {
			if !strings.Contains(payload, want) {
				t.Fatalf("payload missing %q:\n%s", want, payload)
			}
		}
	case <-time.After(2 * time.Second):
		t.Fatal("visitor alert was not posted")
	}

	// A second hit from the same network must not look up or post again.
	again := httptest.NewRequest(http.MethodPost, "/api/v1/engagement/long-browse", strings.NewReader(body))
	again.Header = req.Header.Clone()
	h.ReportLongBrowse(httptest.NewRecorder(), again)
	select {
	case payload := <-posted:
		t.Fatalf("duplicate visitor posted: %s", payload)
	case <-time.After(150 * time.Millisecond):
	}
}

func TestReportLongBrowseSkipsDatacenter(t *testing.T) {
	services.ResetVisitorCache()
	t.Cleanup(services.ResetVisitorCache)
	looked := make(chan struct{})
	restoreFetch := services.SetPlaceFetchForTest(func(context.Context, string) (services.Place, error) {
		defer close(looked)
		return services.Place{
			City: "The Dalles", Country: "United States",
			Lat: 45.6, Lng: -121.2, HasCoord: true,
			ISP: "Google LLC", ASN: 15169, Hosting: true,
		}, nil
	})
	t.Cleanup(restoreFetch)
	posted := make(chan struct{}, 1)
	restoreDiscord := services.ReplaceDiscordDeliver(func(context.Context, string, []byte) error {
		posted <- struct{}{}
		return nil
	})
	t.Cleanup(restoreDiscord)

	h := &Handler{Cfg: config.Config{DiscordWebhookURL: "https://discord.com/api/webhooks/1/token"}}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/engagement/long-browse", strings.NewReader(`{"durationMin":20,"path":"/"}`))
	req.Header.Set("User-Agent", chromeUA)
	req.Header.Set("Accept-Language", "en-US")
	req.Header.Set("Sec-Fetch-Mode", "cors")
	req.Header.Set("X-Forwarded-For", "34.102.136.180")
	h.ReportLongBrowse(httptest.NewRecorder(), req)
	select {
	case <-looked:
	case <-time.After(2 * time.Second):
		t.Fatal("datacenter address was not classified")
	}
	select {
	case <-posted:
		t.Fatal("datacenter was posted as a visitor")
	case <-time.After(200 * time.Millisecond):
	}
}
