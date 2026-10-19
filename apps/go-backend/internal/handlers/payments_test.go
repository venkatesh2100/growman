package handlers

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"testing"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/config"
)

// Razorpay sends the checkout signature hex-encoded; some SDKs emit
// base64. Both must verify, and nothing else may.
func TestVerifyRazorpayHMAC(t *testing.T) {
	const secret = "test_key_secret"
	const message = "order_ABC123|pay_XYZ789"

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(message))
	sum := mac.Sum(nil)
	validHex := hex.EncodeToString(sum)
	validB64 := base64.StdEncoding.EncodeToString(sum)

	tests := []struct {
		name      string
		secret    string
		message   string
		signature string
		want      bool
	}{
		{"valid hex", secret, message, validHex, true},
		{"valid hex uppercase", secret, message, "ABCDEF" + validHex[6:], false},
		{"valid base64", secret, message, validB64, true},
		{"wrong signature", secret, message, hex.EncodeToString([]byte("nope")), false},
		{"empty signature", secret, message, "", false},
		{"empty secret", "", message, validHex, false},
		{"wrong secret", "other_secret", message, validHex, false},
		{"tampered message", secret, "order_ABC123|pay_ATTACKER", validHex, false},
		{"truncated signature", secret, message, validHex[:32], false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := verifyRazorpayHMAC(tc.secret, tc.message, tc.signature); got != tc.want {
				t.Fatalf("verifyRazorpayHMAC(%q, %q, %q) = %v, want %v",
					tc.secret, tc.message, tc.signature, got, tc.want)
			}
		})
	}
}

// The checkout signature and the webhook signature use different secrets.
// Keying the webhook with the API key secret is the bug that silently
// breaks every webhook delivery, so assert they are actually distinct.
func TestWebhookAndPaymentSignaturesUseDifferentSecrets(t *testing.T) {
	h := &Handler{Cfg: config.Config{
		RazorpayKeySecret:     "api_key_secret",
		RazorpayWebhookSecret: "dashboard_webhook_secret",
	}}

	body := `{"event":"payment.captured"}`

	withKeySecret := sign("api_key_secret", body)
	withWebhookSecret := sign("dashboard_webhook_secret", body)

	if h.verifyWebhookSignature(body, withKeySecret) {
		t.Error("webhook signature verified against the API key secret; it must use the webhook secret")
	}
	if !h.verifyWebhookSignature(body, withWebhookSecret) {
		t.Error("webhook signature failed against the configured webhook secret")
	}

	// And the payment-verify path must keep using the key secret.
	message := "order_1|pay_1"
	if !h.verifyRazorpaySignature("order_1", "pay_1", sign("api_key_secret", message)) {
		t.Error("payment signature failed against the API key secret")
	}
	if h.verifyRazorpaySignature("order_1", "pay_1", sign("dashboard_webhook_secret", message)) {
		t.Error("payment signature verified against the webhook secret; it must use the key secret")
	}
}

// Signature enforcement may only be relaxed by an explicitly non-production
// AppEnv. A missing key secret must NOT disable it: that turns a
// misconfigured production deployment into one that accepts forged
// payments, which is the opposite of failing safe.
func TestSkipSignatureChecks(t *testing.T) {
	tests := []struct {
		appEnv    string
		keySecret string
		want      bool
	}{
		{"development", "", true},
		{"development", "secret", true},
		{"dev", "secret", true},
		{"test", "secret", true},
		{"production", "secret", false},
		{"production", "", false}, // the critical case
		{"prod", "", false},
		{"staging", "", false},
		{"", "", false}, // unset env must not be permissive
		{"PRODUCTION", "secret", false},
		{"  production  ", "secret", false},
	}

	for _, tc := range tests {
		h := &Handler{Cfg: config.Config{AppEnv: tc.appEnv, RazorpayKeySecret: tc.keySecret}}
		if got := h.skipSignatureChecks(); got != tc.want {
			t.Errorf("skipSignatureChecks(AppEnv=%q, keySecret=%q) = %v, want %v",
				tc.appEnv, tc.keySecret, got, tc.want)
		}
	}
}

func TestPaiseToRupees(t *testing.T) {
	tests := []struct {
		raw  any
		want float64
	}{
		{float64(149900), 1499},
		{int(50000), 500},
		{int64(1), 0.01},
		{float64(0), 0},
		{"not a number", 0},
		{nil, 0},
	}
	for _, tc := range tests {
		if got := paiseToRupees(tc.raw); got != tc.want {
			t.Errorf("paiseToRupees(%v) = %v, want %v", tc.raw, got, tc.want)
		}
	}
}

func TestWebhookEntity(t *testing.T) {
	payload := map[string]any{
		"payment": map[string]any{
			"entity": map[string]any{"id": "pay_123", "order_id": "order_456"},
		},
		"malformed": map[string]any{"not_entity": 1},
		"wrongtype": "a string",
	}

	entity, err := webhookEntity(payload, "payment")
	if err != nil {
		t.Fatalf("payment entity: %v", err)
	}
	if entity["id"] != "pay_123" {
		t.Errorf("got id %v, want pay_123", entity["id"])
	}

	if _, err := webhookEntity(payload, "refund"); err == nil {
		t.Error("expected an error for a missing entity")
	}
	if _, err := webhookEntity(payload, "malformed"); err == nil {
		t.Error("expected an error for a wrapper with no entity key")
	}
	if _, err := webhookEntity(payload, "wrongtype"); err == nil {
		t.Error("expected an error for a non-object wrapper")
	}
}

func TestIsUniqueViolation(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"duplicate key", errString("ERROR: duplicate key value violates unique constraint"), true},
		{"unique constraint", errString("UNIQUE constraint failed: webhook_events.event_id"), true},
		{"sqlstate", errString("SQLSTATE 23505"), true},
		{"unrelated", errString("connection refused"), false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := isUniqueViolation(tc.err); got != tc.want {
				t.Fatalf("isUniqueViolation(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}

func TestNewOrderTokenIsUnguessable(t *testing.T) {
	seen := make(map[string]bool, 100)
	for range 100 {
		token, err := newOrderToken()
		if err != nil {
			t.Fatalf("newOrderToken: %v", err)
		}
		// 32 bytes hex-encoded. GetOrder rejects anything shorter than 32
		// characters, so the length matters to that guard.
		if len(token) != 64 {
			t.Fatalf("token length %d, want 64", len(token))
		}
		if seen[token] {
			t.Fatal("newOrderToken returned a duplicate")
		}
		seen[token] = true
	}
}

func sign(secret, message string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(message))
	return hex.EncodeToString(mac.Sum(nil))
}

type errString string

func (e errString) Error() string { return string(e) }
