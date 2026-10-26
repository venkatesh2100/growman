package services

import (
	"context"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestAutomatedVisitorRejectsScriptsAndKeepsBrowsers(t *testing.T) {
	chrome := NetHint{
		UserAgent:    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
		Language:     "en-IN,en;q=0.9",
		SecFetchMode: "cors",
	}
	if AutomatedVisitor(chrome) {
		t.Fatal("phone browser was treated as a bot")
	}
	whatsapp := chrome
	whatsapp.UserAgent += " WhatsApp/2.23.20.0"
	if AutomatedVisitor(whatsapp) {
		t.Fatal("WhatsApp in-app browser was treated as a bot")
	}

	cases := []NetHint{
		{UserAgent: "curl/8.4.0", Language: "en", SecFetchMode: "cors"},
		{UserAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", Language: "en", SecFetchMode: "cors"},
		{UserAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/120.0.0.0 Safari/537.36", Language: "en", SecFetchMode: "cors"},
		{UserAgent: chrome.UserAgent, Language: "en-IN", SecFetchMode: ""},
		{UserAgent: chrome.UserAgent, Language: "", SecFetchMode: "cors"},
		{UserAgent: "short", Language: "en", SecFetchMode: "cors"},
	}
	for _, hint := range cases {
		if !AutomatedVisitor(hint) {
			t.Fatalf("accepted automated client %q mode %q", hint.UserAgent, hint.SecFetchMode)
		}
	}
}

func TestDatacenterAndMaps(t *testing.T) {
	home := Place{
		City: "Hyderabad", Region: "Telangana", Postal: "500001", Country: "India",
		Lat: 17.385044, Lng: 78.486671, HasCoord: true,
		ISP: "Jio", Org: "Reliance Jio Infocomm", ASN: 55836, VPN: true,
	}
	if home.Datacenter() {
		t.Fatal("residential VPN was treated as a datacenter")
	}
	if !AllowVisitorAlert(home, nil) {
		t.Fatal("expected a located residential visitor to be allowed")
	}
	if !strings.Contains(home.MapsLink(), "17.385044,78.486671") {
		t.Fatalf("map = %s", home.MapsLink())
	}
	if home.CoordText() != "17.385044, 78.486671" {
		t.Fatalf("coords = %s", home.CoordText())
	}
	if !strings.Contains(home.Label(), "Hyderabad") || !strings.Contains(home.Label(), "500001") {
		t.Fatalf("label = %s", home.Label())
	}
	if !strings.Contains(home.NetworkText(), "AS55836") || !strings.Contains(home.NetworkText(), "VPN") {
		t.Fatalf("network = %s", home.NetworkText())
	}

	cloud := Place{HasCoord: true, Lat: 1, Lng: 2, Hosting: true, ISP: "Google LLC", ASN: 15169}
	if !cloud.Datacenter() || AllowVisitorAlert(cloud, nil) {
		t.Fatal("hosting network should not be a visitor")
	}
	named := Place{HasCoord: true, Lat: 1, Lng: 2, Org: "Amazon Technologies Inc."}
	if !named.Datacenter() {
		t.Fatal("cloud org should not be a visitor")
	}
	if AllowVisitorAlert(home, context.DeadlineExceeded) {
		t.Fatal("lookup failure should not become a visitor alert")
	}
}

func TestLookupPlaceUsesCache(t *testing.T) {
	ResetVisitorCache()
	t.Cleanup(ResetVisitorCache)
	var calls atomic.Int32
	prev := placeFetch
	placeFetch = func(context.Context, string) (Place, error) {
		calls.Add(1)
		return Place{City: "Hyderabad", Country: "India", Lat: 17.385044, Lng: 78.486671, HasCoord: true, ISP: "Jio", ASN: 55836}, nil
	}
	t.Cleanup(func() { placeFetch = prev })

	ctx := context.Background()
	first, err := LookupPlace(ctx, "49.36.14.20")
	if err != nil || !first.HasCoord {
		t.Fatalf("first = %+v err=%v", first, err)
	}
	second, err := LookupPlace(ctx, "49.36.14.20")
	if err != nil || second.City != "Hyderabad" {
		t.Fatalf("second = %+v err=%v", second, err)
	}
	if calls.Load() != 1 {
		t.Fatalf("geolocation calls = %d, want 1", calls.Load())
	}
	if _, err := LookupPlace(ctx, "127.0.0.1"); err == nil {
		t.Fatal("loopback was looked up")
	}
	if calls.Load() != 1 {
		t.Fatal("private address triggered a lookup")
	}
}

func TestClaimVisitorDedupes(t *testing.T) {
	ResetVisitorCache()
	t.Cleanup(ResetVisitorCache)
	if !ClaimVisitor("49.36.14.21") {
		t.Fatal("first claim lost")
	}
	if ClaimVisitor("49.36.14.21") {
		t.Fatal("repeat claim should be rejected")
	}
	if ClaimVisitor("") {
		t.Fatal("empty ip claimed")
	}
}

func TestDeviceText(t *testing.T) {
	got := DeviceText(NetHint{
		UserAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
		Platform:  "Android",
		Model:     "Pixel 7",
		Screen:    "1080x2400",
		Languages: "en-IN, te",
		Timezone:  "Asia/Kolkata",
		Cores:     8,
		Touch:     5,
	})
	for _, want := range []string{"Chrome on Android", "Pixel 7", "1080x2400", "en-IN", "Asia/Kolkata", "8 cores", "touch"} {
		if !strings.Contains(got, want) {
			t.Fatalf("device %q missing %q", got, want)
		}
	}
}

func TestDiscordDetailStaysOffEmail(t *testing.T) {
	msg := DiscordMessage{
		Title:  "Browsing 12 min",
		Fields: []DiscordField{Field("Name", "Asha", true)},
		Detail: LocationFields(Place{
			City: "Hyderabad", Country: "India",
			Lat: 17.385044, Lng: 78.486671, HasCoord: true,
		}),
	}
	plain := msg.Plain()
	if strings.Contains(plain, "17.385044") || strings.Contains(plain, "google.com/maps") {
		t.Fatalf("email fallback included the location block:\n%s", plain)
	}
	if !strings.Contains(plain, "Asha") {
		t.Fatalf("plain = %s", plain)
	}

	var got []byte
	restore := ReplaceDiscordDeliver(func(_ context.Context, _ string, body []byte) error {
		got = append([]byte(nil), body...)
		return nil
	})
	t.Cleanup(restore)
	if err := PostDiscord(context.Background(), "https://discord.com/api/webhooks/123/token", msg); err != nil {
		t.Fatal(err)
	}
	text := string(got)
	if !strings.Contains(text, "17.385044, 78.486671") || !strings.Contains(text, "maps") {
		t.Fatalf("discord payload missing coordinates: %s", text)
	}
}

func TestLookupPlaceTimeoutDoesNotHang(t *testing.T) {
	ResetVisitorCache()
	t.Cleanup(ResetVisitorCache)
	prev := placeFetch
	placeFetch = func(ctx context.Context, _ string) (Place, error) {
		<-ctx.Done()
		return Place{}, ctx.Err()
	}
	t.Cleanup(func() { placeFetch = prev })
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err := LookupPlace(ctx, "49.36.14.22")
	if err == nil {
		t.Fatal("expected timeout")
	}
}
