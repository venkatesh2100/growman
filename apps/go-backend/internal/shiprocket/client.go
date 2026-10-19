// Package shiprocket is a thin client for the Shiprocket aggregator API.
//
// It serves two distinct purposes, and they fail differently on purpose:
//
// At checkout, serviceability (this file) answers whether any courier will
// service a pincode and what they would charge Growman. Growman does not
// quote Shiprocket's rate to the customer — the customer-facing fee comes
// from the zone bands in internal/fulfillment — so the rate returned here
// is recorded as the order's cost, which is what makes the delivery subsidy
// measurable. This path fails soft behind a circuit breaker: a courier API
// outage must not stop people buying plants.
//
// After payment, booking (shipments.go) creates the courier order, assigns
// an AWB and requests pickup. That path fails loud and deliberately stays
// outside the circuit breaker, since a validation error on one order should
// not pause bookings for every other order.
package shiprocket

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultBaseURL = "https://apiv2.shiprocket.in/v1/external"
	// Shiprocket tokens last 10 days; refresh well before that rather than
	// waiting for a 401 mid-checkout.
	tokenTTL = 9 * 24 * time.Hour
	// Checkout must not stall on the courier API. A lookup that misses
	// this budget is treated as "unknown", not as "undeliverable".
	defaultTimeout = 4 * time.Second
	// A dead endpoint or a rejected password fails identically on every
	// call, so after this many consecutive failures the client stops
	// trying for a cooldown. Without it, bad credentials cost every single
	// checkout quote a login round trip plus a timeout.
	breakerThreshold = 3
	breakerCooldown  = 5 * time.Minute
)

// ErrNotConfigured is returned when no Shiprocket credentials are set.
// Callers treat it as "skip the lookup", not as a failure.
var ErrNotConfigured = errors.New("shiprocket credentials not configured")

// ErrCircuitOpen is returned while lookups are paused after repeated
// failures. Like ErrNotConfigured it means "no answer", not "no courier",
// and is expected often enough that callers should not log it each time.
var ErrCircuitOpen = errors.New("shiprocket: lookups paused after repeated failures")

// Client talks to Shiprocket. Safe for concurrent use; the auth token is
// fetched once and shared until it nears expiry.
//
// Shiprocket issues no static API key: the credentials of a dedicated API
// user (Settings → API → Create an API User, on an email different from
// the dashboard login) are exchanged for a JWT valid 10 days. A token can
// be supplied directly instead, which avoids storing a password but has to
// be replaced by hand every 10 days.
type Client struct {
	email    string
	password string
	// staticToken is a hand-supplied token, used until it is rejected.
	staticToken string
	baseURL     string
	http        *http.Client

	mu        sync.Mutex
	token     string
	tokenTime time.Time
	// failures counts consecutive failures; openedAt is when the breaker
	// last tripped.
	failures int
	openedAt time.Time
}

// breakerOpen reports whether lookups are currently paused. After the
// cooldown it lets a single request through — a successful probe clears the
// breaker, a failed one trips it again for another cooldown.
func (c *Client) breakerOpen() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.failures < breakerThreshold {
		return false
	}
	if time.Since(c.openedAt) >= breakerCooldown {
		c.failures = breakerThreshold - 1
		return false
	}
	return true
}

func (c *Client) recordFailure() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.failures++
	if c.failures >= breakerThreshold {
		c.openedAt = time.Now()
	}
}

func (c *Client) recordSuccess() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.failures = 0
}

// New returns a client, or nil when there is neither a credential pair nor
// a token, so callers can degrade to the static fee bands on a nil check.
func New(email, password, token string) *Client {
	email, password = strings.TrimSpace(email), strings.TrimSpace(password)
	token = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(token), "Bearer "))

	// Shiprocket's only credential is a JWT from /auth/login, which is long
	// and starts with "eyJ". Anything else — an API key copied from a
	// channel integration, a password pasted into the wrong variable — can
	// only ever earn a 401, so it is dropped here with an explanation
	// rather than retried against the API on every checkout.
	if token != "" && !strings.HasPrefix(token, "eyJ") {
		log.Printf("[SHIPROCKET] ignoring SHIPROCKET_TOKEN: expected a JWT from /auth/login (one starts with %q), got %d characters. "+
			"Shiprocket issues no static API key — set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD to a dedicated API user instead "+
			"(Settings → API → Configure → Create an API User)", "eyJ", len(token))
		token = ""
	}

	hasCredentials := email != "" && password != ""
	if !hasCredentials && token == "" {
		return nil
	}
	return &Client{
		email:       email,
		password:    password,
		staticToken: token,
		baseURL:     defaultBaseURL,
		http:        &http.Client{Timeout: defaultTimeout},
	}
}

// Rate is the cheapest serviceable courier for a shipment.
type Rate struct {
	// Serviceable is false when Shiprocket answered but no courier covers
	// the pincode — a real answer, not an error.
	Serviceable bool
	// RateINR is what the courier charges Growman, not the customer.
	RateINR       float64
	CourierName   string
	EstimatedDays int
}

// Shipment describes what is being sent where.
type Shipment struct {
	PickupPincode   string
	DeliveryPincode string
	WeightKg        float64
	DeclaredValue   float64
}

// CheckServiceability returns the cheapest courier that will carry the
// shipment. A pincode no courier covers yields Serviceable=false with a
// nil error; only transport, auth and decoding problems are errors.
func (c *Client) CheckServiceability(ctx context.Context, s Shipment) (Rate, error) {
	if c == nil {
		return Rate{}, ErrNotConfigured
	}
	if s.PickupPincode == "" || s.DeliveryPincode == "" {
		return Rate{}, errors.New("shiprocket: pickup and delivery pincodes are required")
	}
	// Shiprocket rejects a zero weight; a small floor is closer to reality
	// than an error for a single plant.
	if s.WeightKg <= 0 {
		s.WeightKg = 0.5
	}
	if c.breakerOpen() {
		return Rate{}, ErrCircuitOpen
	}

	token, err := c.authToken(ctx)
	if err != nil {
		// Missing credentials are a configuration state, not a fault, so
		// they must not trip the breaker.
		if !errors.Is(err, ErrNotConfigured) {
			c.recordFailure()
		}
		return Rate{}, err
	}

	q := url.Values{}
	q.Set("pickup_postcode", s.PickupPincode)
	q.Set("delivery_postcode", s.DeliveryPincode)
	q.Set("weight", strconv.FormatFloat(s.WeightKg, 'f', 2, 64))
	q.Set("cod", "0")
	if s.DeclaredValue > 0 {
		q.Set("declared_value", strconv.FormatFloat(s.DeclaredValue, 'f', 2, 64))
	}

	var body struct {
		Data struct {
			AvailableCourierCompanies []struct {
				CourierName string    `json:"courier_name"`
				Rate        flexFloat `json:"rate"`
				Days        flexInt   `json:"estimated_delivery_days"`
			} `json:"available_courier_companies"`
		} `json:"data"`
	}
	if err := c.get(ctx, token, "/courier/serviceability/?"+q.Encode(), &body); err != nil {
		c.recordFailure()
		return Rate{}, err
	}
	c.recordSuccess()

	couriers := body.Data.AvailableCourierCompanies
	if len(couriers) == 0 {
		return Rate{Serviceable: false}, nil
	}

	best := couriers[0]
	for _, cc := range couriers[1:] {
		if float64(cc.Rate) < float64(best.Rate) {
			best = cc
		}
	}
	return Rate{
		Serviceable:   true,
		RateINR:       float64(best.Rate),
		CourierName:   best.CourierName,
		EstimatedDays: int(best.Days),
	}, nil
}

// authToken returns a cached token, logging in when there is none or it is
// close to expiry. A hand-supplied token is preferred while it lasts,
// since it means no password needs to be stored.
func (c *Client) authToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.token != "" && time.Since(c.tokenTime) < tokenTTL {
		return c.token, nil
	}
	if c.staticToken != "" {
		c.token, c.tokenTime = c.staticToken, time.Now()
		return c.token, nil
	}
	if c.email == "" || c.password == "" {
		// A supplied token expired and there are no credentials to renew
		// it with. Surfaced as not-configured so quoting falls back to the
		// fee bands rather than failing the checkout.
		return "", ErrNotConfigured
	}

	payload, err := json.Marshal(map[string]string{"email": c.email, "password": c.password})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/auth/login", strings.NewReader(string(payload)))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("shiprocket: login: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("shiprocket: login returned %d: %s", resp.StatusCode, snippet(raw))
	}

	var out struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("shiprocket: decode login: %w", err)
	}
	if out.Token == "" {
		return "", errors.New("shiprocket: login returned no token")
	}

	c.token, c.tokenTime = out.Token, time.Now()
	return c.token, nil
}

func (c *Client) get(ctx context.Context, token, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("shiprocket: request: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode == http.StatusUnauthorized {
		// Force a fresh login on the next call. A rejected token is dead
		// whether it was supplied or fetched, so discard it either way —
		// otherwise a stale SHIPROCKET_TOKEN would be retried forever.
		c.mu.Lock()
		c.token, c.staticToken = "", ""
		c.mu.Unlock()
		// Shiprocket distinguishes a dead token from an API user without
		// access to this module, and only the body says which.
		return fmt.Errorf("shiprocket: unauthorized: %s", snippet(raw))
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("shiprocket: returned %d: %s", resp.StatusCode, snippet(raw))
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("shiprocket: decode response: %w", err)
	}
	return nil
}

// snippet trims a response body down to something loggable. Shiprocket's
// error bodies are short JSON, but a proxy or a login page in front of it
// is not, and neither belongs in full in the log.
func snippet(raw []byte) string {
	s := strings.Join(strings.Fields(string(raw)), " ")
	if len(s) > 200 {
		return s[:200] + "…"
	}
	if s == "" {
		return "(empty body)"
	}
	return s
}

// Shiprocket is inconsistent about whether numbers arrive as JSON numbers
// or as quoted strings, and varies by field and by account. These types
// accept either so a response shape change cannot break checkout.

type flexFloat float64

func (f *flexFloat) UnmarshalJSON(b []byte) error {
	s := strings.Trim(strings.TrimSpace(string(b)), `"`)
	if s == "" || s == "null" {
		*f = 0
		return nil
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return nil // a malformed rate is better read as zero than fatal
	}
	*f = flexFloat(v)
	return nil
}

type flexInt int

func (i *flexInt) UnmarshalJSON(b []byte) error {
	s := strings.Trim(strings.TrimSpace(string(b)), `"`)
	if s == "" || s == "null" {
		*i = 0
		return nil
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return nil
	}
	*i = flexInt(int(v))
	return nil
}
