package shiprocket

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// newTestClient points a client at a stub Shiprocket.
func newTestClient(t *testing.T, handler http.Handler) *Client {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	c := New("api-user@growman.test", "secret", "")
	if c == nil {
		t.Fatal("New() returned nil for valid credentials")
	}
	c.baseURL = srv.URL
	return c
}

// stub serves a login token and a fixed serviceability body, counting the
// login calls so token caching can be asserted.
func stub(t *testing.T, serviceabilityJSON string, logins *int32) http.Handler {
	t.Helper()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/auth/login"):
			if logins != nil {
				atomic.AddInt32(logins, 1)
			}
			w.Write([]byte(`{"token":"test-token"}`))
		case strings.Contains(r.URL.Path, "/courier/serviceability"):
			if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
				t.Errorf("Authorization = %q, want the login token", got)
			}
			w.Write([]byte(serviceabilityJSON))
		default:
			t.Errorf("unexpected request to %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	})
}

const twoCouriers = `{"data":{"available_courier_companies":[
	{"courier_name":"Delhivery Surface","rate":118.5,"estimated_delivery_days":"3"},
	{"courier_name":"Ekart","rate":86.2,"estimated_delivery_days":4}
]}}`

func TestNewRequiresCredentialsOrAToken(t *testing.T) {
	// Shiprocket has no static API key, so a client needs either a full
	// API-user credential pair or a hand-supplied token.
	for _, tc := range []struct {
		name                   string
		email, password, token string
		wantClient             bool
	}{
		{"credentials", "api-user@growman.test", "secret", "", true},
		{"token only", "", "", "eyJ0eXAi", true},
		{"both", "api-user@growman.test", "secret", "eyJ0eXAi", true},
		{"email without password", "api-user@growman.test", "", "", false},
		{"password without email", "", "secret", "", false},
		{"nothing", "  ", "  ", "  ", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := New(tc.email, tc.password, tc.token) != nil
			if got != tc.wantClient {
				t.Errorf("New() returned client = %v, want %v", got, tc.wantClient)
			}
		})
	}
}

func TestNonJWTTokenIsRejected(t *testing.T) {
	// Shiprocket has no static API key, so a short opaque string in
	// SHIPROCKET_TOKEN is someone's password or an unrelated key. Keeping
	// it would earn a 401 on every checkout quote.
	if c := New("", "", "g6HD0aBcDeFgHiJkLmNoPqRsTuVwXyZ1"); c != nil {
		t.Error("New() accepted a non-JWT token; want nil so lookups are skipped")
	}
	// With real credentials alongside it, the client still works — only
	// the unusable token is dropped.
	c := New("api-user@growman.test", "secret", "not-a-jwt")
	if c == nil {
		t.Fatal("New() returned nil despite valid credentials")
	}
	if c.staticToken != "" {
		t.Errorf("staticToken = %q, want it dropped", c.staticToken)
	}
}

func TestBearerPrefixIsStripped(t *testing.T) {
	c := New("", "", "Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig")
	if c == nil {
		t.Fatal("New() returned nil for a token pasted with its Bearer prefix")
	}
	if strings.HasPrefix(c.staticToken, "Bearer ") {
		t.Errorf("staticToken = %q, want the Bearer prefix stripped", c.staticToken)
	}
}

func TestSuppliedTokenIsUsedWithoutLoggingIn(t *testing.T) {
	var logins int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/auth/login") {
			atomic.AddInt32(&logins, 1)
			w.Write([]byte(`{"token":"fetched-token"}`))
			return
		}
		if got := r.Header.Get("Authorization"); got != "Bearer eyJsupplied.token.sig" {
			t.Errorf("Authorization = %q, want the supplied token", got)
		}
		w.Write([]byte(twoCouriers))
	}))
	t.Cleanup(srv.Close)

	c := New("", "", "eyJsupplied.token.sig")
	c.baseURL = srv.URL

	if _, err := c.CheckServiceability(context.Background(), Shipment{
		PickupPincode: "500081", DeliveryPincode: "500034", WeightKg: 1,
	}); err != nil {
		t.Fatalf("CheckServiceability() error = %v", err)
	}
	if logins != 0 {
		t.Errorf("login calls = %d, want 0 — a supplied token needs no password", logins)
	}
}

func TestExpiredSuppliedTokenWithoutCredentialsBecomesNotConfigured(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	t.Cleanup(srv.Close)

	c := New("", "", "eyJstale.token.sig")
	c.baseURL = srv.URL
	ctx := context.Background()
	shipment := Shipment{PickupPincode: "500081", DeliveryPincode: "500034", WeightKg: 1}

	if _, err := c.CheckServiceability(ctx, shipment); err == nil {
		t.Fatal("first call error = nil, want unauthorized")
	}
	// With no credentials there is nothing to renew with, so the client
	// reports not-configured and quoting falls back to the fee bands
	// instead of retrying a dead token forever.
	if _, err := c.CheckServiceability(ctx, shipment); err != ErrNotConfigured {
		t.Errorf("second call error = %v, want ErrNotConfigured", err)
	}
}

func TestExpiredSuppliedTokenFallsBackToCredentials(t *testing.T) {
	var logins int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/auth/login"):
			atomic.AddInt32(&logins, 1)
			w.Write([]byte(`{"token":"fresh-token"}`))
		case r.Header.Get("Authorization") == "Bearer fresh-token":
			w.Write([]byte(twoCouriers))
		default:
			w.WriteHeader(http.StatusUnauthorized) // the stale supplied token
		}
	}))
	t.Cleanup(srv.Close)

	c := New("api-user@growman.test", "secret", "eyJstale.token.sig")
	c.baseURL = srv.URL
	ctx := context.Background()
	shipment := Shipment{PickupPincode: "500081", DeliveryPincode: "500034", WeightKg: 1}

	if _, err := c.CheckServiceability(ctx, shipment); err == nil {
		t.Fatal("first call error = nil, want the stale token to be rejected")
	}
	rate, err := c.CheckServiceability(ctx, shipment)
	if err != nil {
		t.Fatalf("second call error = %v, want a successful re-login", err)
	}
	if !rate.Serviceable {
		t.Error("Serviceable = false after re-login, want true")
	}
	if logins != 1 {
		t.Errorf("login calls = %d, want 1", logins)
	}
}

func TestCheckServiceabilityPicksCheapestCourier(t *testing.T) {
	c := newTestClient(t, stub(t, twoCouriers, nil))

	rate, err := c.CheckServiceability(context.Background(), Shipment{
		PickupPincode:   "500081",
		DeliveryPincode: "500034",
		WeightKg:        3,
		DeclaredValue:   899,
	})
	if err != nil {
		t.Fatalf("CheckServiceability() error = %v", err)
	}
	if !rate.Serviceable {
		t.Error("Serviceable = false, want true")
	}
	if rate.RateINR != 86.2 {
		t.Errorf("RateINR = %v, want the cheapest 86.2", rate.RateINR)
	}
	if rate.CourierName != "Ekart" {
		t.Errorf("CourierName = %q, want %q", rate.CourierName, "Ekart")
	}
	// The cheapest courier quoted its days as a JSON number, the other as
	// a string; both must decode.
	if rate.EstimatedDays != 4 {
		t.Errorf("EstimatedDays = %v, want 4", rate.EstimatedDays)
	}
}

func TestEmptyCourierListMeansUnserviceableNotError(t *testing.T) {
	c := newTestClient(t, stub(t, `{"data":{"available_courier_companies":[]}}`, nil))

	rate, err := c.CheckServiceability(context.Background(), Shipment{
		PickupPincode: "500081", DeliveryPincode: "799001", WeightKg: 1,
	})
	if err != nil {
		t.Fatalf("CheckServiceability() error = %v, want nil for an unserviced pincode", err)
	}
	if rate.Serviceable {
		t.Error("Serviceable = true, want false when no courier covers the pincode")
	}
}

func TestTokenIsReusedAcrossCalls(t *testing.T) {
	var logins int32
	c := newTestClient(t, stub(t, twoCouriers, &logins))

	for i := 0; i < 3; i++ {
		if _, err := c.CheckServiceability(context.Background(), Shipment{
			PickupPincode: "500081", DeliveryPincode: "500034", WeightKg: 1,
		}); err != nil {
			t.Fatalf("call %d: %v", i, err)
		}
	}
	if logins != 1 {
		t.Errorf("login calls = %d, want 1 — the token should be cached", logins)
	}
}

func TestUnauthorizedClearsTheCachedToken(t *testing.T) {
	var logins int32
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/auth/login") {
			atomic.AddInt32(&logins, 1)
			w.Write([]byte(`{"token":"test-token"}`))
			return
		}
		w.WriteHeader(http.StatusUnauthorized)
	}))

	ctx := context.Background()
	shipment := Shipment{PickupPincode: "500081", DeliveryPincode: "500034", WeightKg: 1}
	if _, err := c.CheckServiceability(ctx, shipment); err == nil {
		t.Fatal("CheckServiceability() error = nil, want an error on 401")
	}
	// The next call must log in again rather than reuse the dead token.
	if _, err := c.CheckServiceability(ctx, shipment); err == nil {
		t.Fatal("second call error = nil, want an error on 401")
	}
	if logins != 2 {
		t.Errorf("login calls = %d, want 2 — a 401 should invalidate the token", logins)
	}
}

func TestRepeatedFailuresPauseLookups(t *testing.T) {
	var calls int32
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusInternalServerError)
	}))

	ctx := context.Background()
	shipment := Shipment{PickupPincode: "500081", DeliveryPincode: "500034", WeightKg: 1}
	for i := 0; i < breakerThreshold; i++ {
		if _, err := c.CheckServiceability(ctx, shipment); err == nil {
			t.Fatalf("call %d error = nil, want a failure", i)
		}
	}
	before := atomic.LoadInt32(&calls)

	// Past the threshold the client stops calling out: bad credentials or
	// a dead endpoint would otherwise tax every checkout quote.
	if _, err := c.CheckServiceability(ctx, shipment); err != ErrCircuitOpen {
		t.Errorf("error after the threshold = %v, want ErrCircuitOpen", err)
	}
	if got := atomic.LoadInt32(&calls); got != before {
		t.Errorf("requests = %d, want no new request while paused (%d)", got, before)
	}
}

func TestCooldownLetsOneProbeThrough(t *testing.T) {
	var serviceability int32
	fail := true
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/auth/login") {
			w.Write([]byte(`{"token":"test-token"}`))
			return
		}
		atomic.AddInt32(&serviceability, 1)
		if fail {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Write([]byte(twoCouriers))
	}))

	ctx := context.Background()
	shipment := Shipment{PickupPincode: "500081", DeliveryPincode: "500034", WeightKg: 1}
	for i := 0; i < breakerThreshold; i++ {
		c.CheckServiceability(ctx, shipment)
	}

	// Pretend the cooldown has elapsed, then let Shiprocket recover: the
	// probe must succeed and clear the breaker rather than stay paused.
	c.mu.Lock()
	c.openedAt = time.Now().Add(-breakerCooldown - time.Second)
	c.mu.Unlock()
	fail = false

	before := atomic.LoadInt32(&serviceability)
	if _, err := c.CheckServiceability(ctx, shipment); err != nil {
		t.Fatalf("probe after the cooldown error = %v, want success", err)
	}
	if got := atomic.LoadInt32(&serviceability); got != before+1 {
		t.Errorf("serviceability requests = %d, want one probe (%d)", got, before+1)
	}
	if _, err := c.CheckServiceability(ctx, shipment); err != nil {
		t.Errorf("call after a successful probe error = %v, want the breaker cleared", err)
	}
}

func TestNilClientIsNotConfiguredForMissingCredentials(t *testing.T) {
	if c := New("", "", ""); c != nil {
		t.Fatal("New() with nothing configured returned a client")
	}
}

func TestMissingPincodeIsRejectedBeforeCallingOut(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("unexpected request to %s for an incomplete shipment", r.URL.Path)
	}))

	if _, err := c.CheckServiceability(context.Background(), Shipment{PickupPincode: "500081"}); err == nil {
		t.Error("CheckServiceability() error = nil, want an error for a missing delivery pincode")
	}
}

func TestNilClientIsNotConfigured(t *testing.T) {
	var c *Client
	if _, err := c.CheckServiceability(context.Background(), Shipment{
		PickupPincode: "500081", DeliveryPincode: "500034",
	}); err != ErrNotConfigured {
		t.Errorf("error = %v, want ErrNotConfigured", err)
	}
}

func TestLoginFailureSurfaces(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))

	if _, err := c.CheckServiceability(context.Background(), Shipment{
		PickupPincode: "500081", DeliveryPincode: "500034", WeightKg: 1,
	}); err == nil {
		t.Error("CheckServiceability() error = nil, want a login failure")
	}
}

func TestZeroWeightIsFloored(t *testing.T) {
	var gotWeight string
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/auth/login") {
			w.Write([]byte(`{"token":"test-token"}`))
			return
		}
		gotWeight = r.URL.Query().Get("weight")
		w.Write([]byte(twoCouriers))
	}))

	if _, err := c.CheckServiceability(context.Background(), Shipment{
		PickupPincode: "500081", DeliveryPincode: "500034", WeightKg: 0,
	}); err != nil {
		t.Fatalf("CheckServiceability() error = %v", err)
	}
	if gotWeight == "0.00" || gotWeight == "" {
		t.Errorf("weight sent = %q, want a non-zero floor", gotWeight)
	}
}
