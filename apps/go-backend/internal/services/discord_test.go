package services

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestMapsURL(t *testing.T) {
	lat, lng := 12.971599, 77.594566
	got := MapsURL(&lat, &lng, "ignored")
	want := "https://www.google.com/maps/search/?api=1&query=12.971599,77.594566"
	if got != want {
		t.Fatalf("coords url = %s", got)
	}

	zero := 0.0
	got = MapsURL(&zero, &zero, "12 MG Road, Bengaluru")
	if !strings.Contains(got, "12+MG+Road") && !strings.Contains(got, "12%20MG%20Road") {
		t.Fatalf("address url = %s", got)
	}
	if MapsURL(nil, nil, "  ") != "" {
		t.Fatal("empty address should not produce a map link")
	}
}

func TestPostDiscordRejectsNonDiscordHost(t *testing.T) {
	called := false
	prev := discordDeliver
	discordDeliver = func(context.Context, string, []byte) error {
		called = true
		return nil
	}
	t.Cleanup(func() { discordDeliver = prev })

	err := PostDiscord(context.Background(), "https://example.com/api/webhooks/1/secret", DiscordMessage{Title: "Hi"})
	if err == nil {
		t.Fatal("expected host rejection")
	}
	if called {
		t.Fatal("delivery ran for a non-Discord host")
	}
	if strings.Contains(err.Error(), "secret") {
		t.Fatalf("error leaked the webhook: %v", err)
	}
}

func TestPostDiscordPayload(t *testing.T) {
	var got []byte
	var gotURL string
	prev := discordDeliver
	discordDeliver = func(_ context.Context, webhook string, body []byte) error {
		gotURL = webhook
		got = append([]byte(nil), body...)
		return nil
	}
	t.Cleanup(func() { discordDeliver = prev })

	lat := 13.08
	lng := 80.27
	err := PostDiscord(context.Background(), "https://discord.com/api/webhooks/123/super-secret-token", DiscordMessage{
		Title:  "Checkout dropped",
		Color:  ColorOrange,
		URL:    MapsURL(&lat, &lng, ""),
		Footer: "Today (IST) · 2 signups · 4 checkouts · 1 dropped · 3 paid · 0 payment failed · ₹900 revenue",
		Fields: []DiscordField{
			Field("Name", "Priya", true),
			Field("Phone", "", true),
			{Name: "Note", Value: strings.Repeat("a", 1100)},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(gotURL, "discord.com/api/webhooks/") {
		t.Fatalf("url = %s", gotURL)
	}

	var payload struct {
		Username string `json:"username"`
		Embeds   []struct {
			Title  string `json:"title"`
			URL    string `json:"url"`
			Color  int    `json:"color"`
			Fields []struct {
				Name  string `json:"name"`
				Value string `json:"value"`
			} `json:"fields"`
			Footer struct {
				Text string `json:"text"`
			} `json:"footer"`
		} `json:"embeds"`
	}
	if err := json.Unmarshal(got, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Username != "Growman" || len(payload.Embeds) != 1 {
		t.Fatalf("payload = %+v", payload)
	}
	embed := payload.Embeds[0]
	if embed.Title != "Checkout dropped" || embed.Color != ColorOrange {
		t.Fatalf("embed header = %+v", embed)
	}
	if embed.Fields[1].Value != "—" {
		t.Fatalf("blank phone = %q", embed.Fields[1].Value)
	}
	if len([]rune(embed.Fields[2].Value)) != 1024 {
		t.Fatalf("field len = %d", len([]rune(embed.Fields[2].Value)))
	}
	if !strings.Contains(embed.Footer.Text, "1 dropped") {
		t.Fatalf("footer = %s", embed.Footer.Text)
	}
	if strings.Contains(string(got), "super-secret-token") {
		t.Fatal("payload included the webhook token")
	}
}

func TestPostDiscordHidesDeliveryFailure(t *testing.T) {
	prev := discordDeliver
	discordDeliver = func(context.Context, string, []byte) error {
		return discordStatusError{Code: 429}
	}
	t.Cleanup(func() { discordDeliver = prev })

	err := PostDiscord(context.Background(), "https://discord.com/api/webhooks/9/token", DiscordMessage{Title: "Hi"})
	if err == nil || !strings.Contains(err.Error(), "HTTP 429") || strings.Contains(err.Error(), "token") {
		t.Fatalf("err = %v", err)
	}
}
