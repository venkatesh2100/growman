// Package truecaller implements the Android OAuth-with-PKCE code exchange
// used to verify a user's phone number via the Truecaller app.
package truecaller

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	tokenURL    = "https://oauth-account-noneu.truecaller.com/v1/token"
	userInfoURL = "https://oauth-account-noneu.truecaller.com/v1/userinfo"
)

type Client struct {
	ClientID string
	HTTP     *http.Client
}

type Profile struct {
	Sub         string `json:"sub"`
	GivenName   string `json:"given_name"`
	FamilyName  string `json:"family_name"`
	PhoneNumber string `json:"phone_number"`
	Email       string `json:"email"`
	Picture     string `json:"picture"`
}

func New(clientID string) *Client {
	return &Client{
		ClientID: strings.TrimSpace(clientID),
		HTTP:     &http.Client{Timeout: 15 * time.Second},
	}
}

func (c *Client) Configured() bool {
	return c != nil && c.ClientID != ""
}

// ExchangeCode swaps an Android OAuth authorization code + PKCE verifier for an access token.
func (c *Client) ExchangeCode(ctx context.Context, code, codeVerifier string) (accessToken string, err error) {
	if !c.Configured() {
		return "", fmt.Errorf("truecaller client id not configured")
	}
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("client_id", c.ClientID)
	form.Set("code", code)
	form.Set("code_verifier", codeVerifier)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
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

	var out struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
		ErrorDesc   string `json:"error_description"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return "", fmt.Errorf("truecaller token decode: %w (body=%s)", err, string(body))
	}
	if resp.StatusCode >= 300 || out.AccessToken == "" {
		msg := out.ErrorDesc
		if msg == "" {
			msg = out.Error
		}
		if msg == "" {
			msg = string(body)
		}
		return "", fmt.Errorf("truecaller token exchange failed (%d): %s", resp.StatusCode, msg)
	}
	return out.AccessToken, nil
}

// UserInfo fetches the verified Truecaller profile for an access token.
func (c *Client) UserInfo(ctx context.Context, accessToken string) (*Profile, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, userInfoURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("truecaller userinfo failed (%d): %s", resp.StatusCode, string(body))
	}

	var p Profile
	if err := json.Unmarshal(body, &p); err != nil {
		return nil, fmt.Errorf("truecaller userinfo decode: %w (body=%s)", err, string(body))
	}
	if strings.TrimSpace(p.PhoneNumber) == "" {
		return nil, fmt.Errorf("truecaller userinfo missing phone_number")
	}
	return &p, nil
}

func (p *Profile) FullName() string {
	if p == nil {
		return ""
	}
	parts := make([]string, 0, 2)
	if g := strings.TrimSpace(p.GivenName); g != "" {
		parts = append(parts, g)
	}
	if f := strings.TrimSpace(p.FamilyName); f != "" {
		parts = append(parts, f)
	}
	return strings.TrimSpace(strings.Join(parts, " "))
}
