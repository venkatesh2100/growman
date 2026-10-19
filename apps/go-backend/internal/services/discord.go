package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	ColorGreen  = 0x1F7A4D
	ColorOrange = 0xE67E22
	ColorRed    = 0xC0392B
	ColorBlue   = 0x1D6FBF
	ColorPurple = 0x8E44AD
	ColorSlate  = 0x546E7A
)

// DiscordField is one row in a Discord embed.
type DiscordField struct {
	Name   string
	Value  string
	Inline bool
}

// DiscordMessage is an ops alert posted to a Discord incoming webhook.
type DiscordMessage struct {
	Title       string
	Description string
	URL         string
	Color       int
	Fields      []DiscordField
	Footer      string
}

type discordStatusError struct{ Code int }

func (e discordStatusError) Error() string {
	return fmt.Sprintf("discord status %d", e.Code)
}

var discordHTTP = &http.Client{Timeout: 8 * time.Second}

// discordDeliver is replaced in tests. It must not be called with a
// non-Discord URL; PostDiscord checks the host first.
var discordDeliver = func(ctx context.Context, webhook string, body []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, webhook, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := discordHTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1024))
	if resp.StatusCode >= 300 {
		return discordStatusError{Code: resp.StatusCode}
	}
	return nil
}

// Field builds an embed field. Discord rejects empty values, so a blank
// value is shown as an em dash.
func Field(name, value string, inline bool) DiscordField {
	value = strings.TrimSpace(value)
	if value == "" {
		value = "—"
	}
	return DiscordField{Name: name, Value: value, Inline: inline}
}

// MapsURL is a Google Maps search link for a coordinate pair, or for a
// postal address when no coordinates were captured.
func MapsURL(lat, lng *float64, address string) string {
	if lat != nil && lng != nil && (*lat != 0 || *lng != 0) {
		return "https://www.google.com/maps/search/?api=1&query=" +
			strconv.FormatFloat(*lat, 'f', 6, 64) + "," +
			strconv.FormatFloat(*lng, 'f', 6, 64)
	}
	address = strings.Join(strings.Fields(address), " ")
	if address == "" {
		return ""
	}
	return "https://www.google.com/maps/search/?api=1&query=" + url.QueryEscape(address)
}

// ColorFor picks an embed color from a plain-text alert title.
func ColorFor(subject string) int {
	s := strings.ToLower(subject)
	switch {
	case strings.Contains(s, "dispute"), strings.Contains(s, "urgent"):
		return ColorRed
	case strings.Contains(s, "cancel"), strings.Contains(s, "drop"), strings.Contains(s, "abandon"):
		return ColorOrange
	case strings.Contains(s, "paid"):
		return ColorGreen
	case strings.Contains(s, "browse"):
		return ColorPurple
	case strings.Contains(s, "eras"):
		return ColorSlate
	default:
		return ColorBlue
	}
}

// Plain renders the alert as text for the email fallback.
func (m DiscordMessage) Plain() string {
	var b strings.Builder
	if text := strings.TrimSpace(m.Description); text != "" {
		b.WriteString(text)
		if len(m.Fields) > 0 {
			b.WriteString("\n\n")
		}
	}
	for _, field := range m.Fields {
		fmt.Fprintf(&b, "%s: %s\n", field.Name, field.Value)
	}
	if m.URL != "" {
		fmt.Fprintf(&b, "Map: %s\n", m.URL)
	}
	if m.Footer != "" {
		fmt.Fprintf(&b, "\n%s\n", m.Footer)
	}
	return b.String()
}

// PostDiscord sends one embed. Errors never include the webhook URL,
// because the URL itself is the credential.
func PostDiscord(ctx context.Context, webhook string, msg DiscordMessage) error {
	if _, err := parseDiscordWebhook(webhook); err != nil {
		return err
	}
	body, err := buildDiscordPayload(msg)
	if err != nil {
		return err
	}
	if err := discordDeliver(ctx, webhook, body); err != nil {
		var status discordStatusError
		if errors.As(err, &status) {
			return fmt.Errorf("discord webhook rejected the alert (HTTP %d)", status.Code)
		}
		return fmt.Errorf("discord webhook post failed")
	}
	return nil
}

func parseDiscordWebhook(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.User != nil {
		return nil, fmt.Errorf("discord webhook must be an https URL")
	}
	switch strings.ToLower(u.Hostname()) {
	case "discord.com", "discordapp.com", "canary.discord.com", "ptb.discord.com":
	default:
		return nil, fmt.Errorf("discord webhook host is not Discord")
	}
	if !strings.HasPrefix(u.Path, "/api/webhooks/") {
		return nil, fmt.Errorf("discord webhook path is not a webhook")
	}
	return u, nil
}

type discordWire struct {
	Username string         `json:"username"`
	Embeds   []discordEmbed `json:"embeds"`
}

type discordEmbed struct {
	Title       string         `json:"title,omitempty"`
	Description string         `json:"description,omitempty"`
	URL         string         `json:"url,omitempty"`
	Color       int            `json:"color,omitempty"`
	Fields      []discordField `json:"fields,omitempty"`
	Footer      *discordFooter `json:"footer,omitempty"`
}

type discordField struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline,omitempty"`
}

type discordFooter struct {
	Text string `json:"text"`
}

func buildDiscordPayload(msg DiscordMessage) ([]byte, error) {
	embed := discordEmbed{
		Title:       clipRunes(msg.Title, 256),
		Description: clipRunes(strings.TrimSpace(msg.Description), 4096),
		URL:         strings.TrimSpace(msg.URL),
		Color:       msg.Color,
	}
	if embed.Color == 0 {
		embed.Color = ColorGreen
	}
	fields := msg.Fields
	if len(fields) > 25 {
		fields = fields[:25]
	}
	for _, field := range fields {
		name := clipRunes(strings.TrimSpace(field.Name), 256)
		if name == "" {
			name = "Detail"
		}
		value := clipRunes(strings.TrimSpace(field.Value), 1024)
		if value == "" {
			value = "—"
		}
		embed.Fields = append(embed.Fields, discordField{Name: name, Value: value, Inline: field.Inline})
	}
	if footer := clipRunes(strings.TrimSpace(msg.Footer), 2048); footer != "" {
		embed.Footer = &discordFooter{Text: footer}
	}
	payload := discordWire{Username: "Growman", Embeds: []discordEmbed{embed}}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(payload); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func clipRunes(s string, max int) string {
	if max <= 0 || s == "" {
		return ""
	}
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	if max == 1 {
		return "…"
	}
	return string(runes[:max-1]) + "…"
}
