package msg91

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	AuthKey    string
	TemplateID string
	WidgetID   string
	TokenAuth  string
	HTTP       *http.Client
}

type otpResponse struct {
	Type              string          `json:"type"`
	Message           string          `json:"message"`
	AccessToken       string          `json:"access-token"`
	InvisibleVerified bool            `json:"invisibleVerified"`
	Code              json.RawMessage `json:"code"`
}

func (o otpResponse) codeString() string {
	if len(o.Code) == 0 {
		return ""
	}
	var asStr string
	if err := json.Unmarshal(o.Code, &asStr); err == nil {
		return asStr
	}
	var asInt int
	if err := json.Unmarshal(o.Code, &asInt); err == nil {
		return fmt.Sprintf("%d", asInt)
	}
	return strings.Trim(string(o.Code), `"`)
}

func formatMsg91Error(out *otpResponse, raw []byte) string {
	msg := strings.TrimSpace(out.Message)
	code := out.codeString()
	switch strings.ToLower(msg) {
	case "ipblocked":
		return "MSG91 blocked this server IP. In MSG91 dashboard → Authkey / IP security, allow your public IP (or disable IP restriction for this key), then retry."
	}
	if msg == "" {
		return string(raw)
	}
	if code != "" {
		return fmt.Sprintf("%s (code %s)", msg, code)
	}
	return msg
}

func NewClient(authKey, templateID string) *Client {
	return &Client{
		AuthKey:    authKey,
		TemplateID: templateID,
		HTTP:       &http.Client{Timeout: 15 * time.Second},
	}
}

func NewWidgetClient(authKey, widgetID, tokenAuth string) *Client {
	return &Client{
		AuthKey:   authKey,
		WidgetID:  widgetID,
		TokenAuth: tokenAuth,
		HTTP:      &http.Client{Timeout: 15 * time.Second},
	}
}

func (c *Client) configured() bool {
	return c != nil && c.AuthKey != "" && c.TemplateID != ""
}

func (c *Client) authConfigured() bool {
	return c != nil && c.AuthKey != ""
}

func (c *Client) widgetConfigured() bool {
	return c != nil && c.WidgetID != "" && c.TokenAuth != ""
}

func (c *Client) postJSON(ctx context.Context, endpoint string, payload any) (*otpResponse, []byte, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	var out otpResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, raw, fmt.Errorf("msg91 decode: %w (body=%s)", err, string(raw))
	}
	return &out, raw, nil
}

// WidgetSendOTP calls MSG91 OTP Widget send API (default MSG91 SMS — no custom DLT template).
// Returns reqId for verify, or accessToken when already/invisibly verified.
func (c *Client) WidgetSendOTP(ctx context.Context, phone string) (reqID string, accessToken string, err error) {
	if !c.widgetConfigured() {
		return "", "", fmt.Errorf("msg91 widget not configured")
	}
	out, raw, err := c.postJSON(ctx, "https://control.msg91.com/api/v5/widget/sendOtpMobile", map[string]string{
		"widgetId":   c.WidgetID,
		"tokenAuth":  c.TokenAuth,
		"identifier": phone,
	})
	if err != nil {
		return "", "", err
	}
	if out.AccessToken != "" || out.InvisibleVerified {
		tok := out.AccessToken
		if tok == "" {
			tok = out.Message
		}
		return "", tok, nil
	}
	if out.Type != "success" {
		return "", "", fmt.Errorf("msg91 widget send failed: %s", formatMsg91Error(out, raw))
	}
	if strings.TrimSpace(out.Message) == "" {
		return "", "", fmt.Errorf("msg91 widget send missing reqId (body=%s)", string(raw))
	}
	return out.Message, "", nil
}

// WidgetVerifyOTP verifies an OTP against a widget send reqId and returns the access-token.
func (c *Client) WidgetVerifyOTP(ctx context.Context, reqID, otp string) (accessToken string, err error) {
	if !c.widgetConfigured() {
		return "", fmt.Errorf("msg91 widget not configured")
	}
	out, raw, err := c.postJSON(ctx, "https://control.msg91.com/api/v5/widget/verifyOtp", map[string]string{
		"widgetId":  c.WidgetID,
		"tokenAuth": c.TokenAuth,
		"reqId":     reqID,
		"otp":       otp,
	})
	if err != nil {
		return "", err
	}
	if out.Type != "success" && out.AccessToken == "" {
		return "", fmt.Errorf("msg91 widget verify failed: %s", formatMsg91Error(out, raw))
	}
	tok := out.AccessToken
	if tok == "" {
		tok = out.Message
	}
	if tok == "" {
		return "", fmt.Errorf("msg91 widget verify missing access-token (body=%s)", string(raw))
	}
	return tok, nil
}

// WidgetRetryOTP resends OTP for an existing reqId.
// Channels: 11=SMS, 4=VOICE, 12=WHATSAPP, 3=EMAIL
// MSG91 widget config stores channel values as strings ("11","12","4"); send the same
// type — numeric JSON can be ignored and fall back to globalDefaultChannel (SMS).
func (c *Client) WidgetRetryOTP(ctx context.Context, reqID string, channel int) (newReqID string, err error) {
	if !c.widgetConfigured() {
		return "", fmt.Errorf("msg91 widget not configured")
	}
	switch channel {
	case 11, 12, 4, 3:
		// ok
	case 0:
		channel = 11
	default:
		return "", fmt.Errorf("unsupported retry channel %d (use 11=SMS, 12=WhatsApp, 4=Voice)", channel)
	}
	channelStr := fmt.Sprintf("%d", channel)
	log.Printf("[MSG91] retryOtp reqId=%s retryChannel=%s", reqID, channelStr)
	out, raw, err := c.postJSON(ctx, "https://control.msg91.com/api/v5/widget/retryOtp", map[string]any{
		"widgetId":     c.WidgetID,
		"tokenAuth":    c.TokenAuth,
		"reqId":        reqID,
		"retryChannel": channelStr,
	})
	if err != nil {
		return "", err
	}
	if out.Type != "success" {
		return "", fmt.Errorf("msg91 widget retry failed: %s", formatMsg91Error(out, raw))
	}
	if strings.TrimSpace(out.Message) == "" {
		return reqID, nil
	}
	return out.Message, nil
}

// VerifyAccessToken validates a JWT returned by the MSG91 OTP Widget after client-side verify.
func (c *Client) VerifyAccessToken(ctx context.Context, accessToken string) (identifier string, err error) {
	if !c.authConfigured() {
		return "", fmt.Errorf("msg91 authkey not configured")
	}
	form := url.Values{}
	form.Set("authkey", c.AuthKey)
	form.Set("access-token", accessToken)

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"https://control.msg91.com/api/v5/widget/verifyAccessToken",
		strings.NewReader(form.Encode()),
	)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var raw map[string]any
	if err := json.Unmarshal(body, &raw); err != nil {
		return "", fmt.Errorf("msg91 widget verify decode: %w (body=%s)", err, string(body))
	}

	typ, _ := raw["type"].(string)
	if typ != "" && typ != "success" {
		msg, _ := raw["message"].(string)
		if msg == "" {
			msg = string(body)
		}
		return "", fmt.Errorf("access token verify failed: %s", msg)
	}

	id := extractIdentifier(raw)
	if id == "" {
		return "", fmt.Errorf("msg91 widget verify missing identifier (body=%s)", string(body))
	}
	return id, nil
}

func extractIdentifier(raw map[string]any) string {
	if msg, ok := raw["message"].(string); ok {
		if looksLikeIdentifier(msg) {
			return msg
		}
	}
	if msgObj, ok := raw["message"].(map[string]any); ok {
		for _, key := range []string{"mobile", "phone", "identifier", "email"} {
			if v, ok := msgObj[key].(string); ok && v != "" {
				return v
			}
		}
	}
	if data, ok := raw["data"].(map[string]any); ok {
		for _, key := range []string{"mobile", "phone", "identifier", "email"} {
			if v, ok := data[key].(string); ok && v != "" {
				return v
			}
		}
	}
	for _, key := range []string{"mobile", "phone", "identifier", "email"} {
		if v, ok := raw[key].(string); ok && v != "" {
			return v
		}
	}
	return ""
}

func looksLikeIdentifier(s string) bool {
	s = strings.TrimSpace(s)
	if strings.Contains(s, "@") {
		return true
	}
	digits := 0
	for _, r := range s {
		if r >= '0' && r <= '9' {
			digits++
		}
	}
	return digits >= 10
}

func (c *Client) SendOTP(ctx context.Context, phone string) error {
	if !c.configured() {
		return fmt.Errorf("msg91 not configured")
	}
	u, err := url.Parse("https://control.msg91.com/api/v5/otp")
	if err != nil {
		return err
	}
	q := u.Query()
	q.Set("template_id", c.TemplateID)
	q.Set("mobile", phone)
	q.Set("otp_length", "6")
	q.Set("otp_expiry", "10")
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("authkey", c.AuthKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var out otpResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return fmt.Errorf("msg91 send decode: %w (body=%s)", err, string(body))
	}
	if out.Type != "success" {
		return fmt.Errorf("msg91 send failed: %s", out.Message)
	}
	return nil
}

func (c *Client) VerifyOTP(ctx context.Context, phone, otp string) error {
	if !c.configured() {
		return fmt.Errorf("msg91 not configured")
	}
	u, err := url.Parse("https://control.msg91.com/api/v5/otp/verify")
	if err != nil {
		return err
	}
	q := u.Query()
	q.Set("mobile", phone)
	q.Set("otp", otp)
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("authkey", c.AuthKey)
	req.Header.Set("Accept", "application/json")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var out otpResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return fmt.Errorf("msg91 verify decode: %w (body=%s)", err, string(body))
	}
	if out.Type != "success" {
		return fmt.Errorf("otp verify failed: %s", out.Message)
	}
	return nil
}
