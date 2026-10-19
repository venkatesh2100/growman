// Package plantnet is a small client for the Pl@ntNet v2 API.
//
// The free plan grants 500 identifications per UTC day. Species
// identification, disease identification, and variety identification all
// spend that same credit. Catalog reads (projects, languages, species,
// diseases, varieties, quota) sit on other budgets, and projects plus
// languages are unlimited. Callers should spend an identify credit only
// when the answer is not already cached.
package plantnet

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const defaultBaseURL = "https://my-api.plantnet.org"

// Client calls my-api.plantnet.org. A nil HTTP client uses a 25s timeout.
type Client struct {
	APIKey  string
	BaseURL string
	HTTP    *http.Client
}

// New returns a client for the given API key.
func New(apiKey string) *Client {
	return &Client{
		APIKey:  strings.TrimSpace(apiKey),
		BaseURL: defaultBaseURL,
		HTTP:    &http.Client{Timeout: 25 * time.Second},
	}
}

// Photo is one JPEG or PNG of a single plant.
type Photo struct {
	Filename    string
	ContentType string
	Bytes       []byte
}

// IdentifyRequest is one identification. Project is the flora slug
// ("all", or a k-* project). It is ignored by the disease and variety
// routes, which have no project.
type IdentifyRequest struct {
	Project              string
	Organs               []string
	Lang                 string
	NBResults            int
	IncludeRelatedImages bool
	NoReject             bool
	Detailed             bool
}

// APIError is a non-2xx response from Pl@ntNet. Body is truncated and
// never includes the request URL, so the API key cannot leak through it.
type APIError struct {
	Status int
	Body   string
}

func (e *APIError) Error() string {
	if e.Body == "" {
		return fmt.Sprintf("plantnet status %d", e.Status)
	}
	return fmt.Sprintf("plantnet status %d: %s", e.Status, e.Body)
}

// IdentifySpecies spends one identify credit on POST /v2/identify/{project}.
func (c *Client) IdentifySpecies(ctx context.Context, req IdentifyRequest, photos []Photo) ([]byte, error) {
	project := req.Project
	if project == "" {
		project = "all"
	}
	return c.identify(ctx, "/v2/identify/"+url.PathEscape(project), "images", req, photos)
}

// IdentifyDiseases spends one identify credit on POST /v2/diseases/identify.
// The documented multipart field for this route is "image", not "images".
func (c *Client) IdentifyDiseases(ctx context.Context, req IdentifyRequest, photos []Photo) ([]byte, error) {
	return c.identify(ctx, "/v2/diseases/identify", "image", req, photos)
}

// IdentifyVarieties spends one identify credit on POST /v2/varieties/identify.
func (c *Client) IdentifyVarieties(ctx context.Context, req IdentifyRequest, photos []Photo) ([]byte, error) {
	return c.identify(ctx, "/v2/varieties/identify", "images", req, photos)
}

// Get fetches a JSON route. q is copied; the API key is added here.
func (c *Client) Get(ctx context.Context, path string, q url.Values) ([]byte, error) {
	if c == nil || c.APIKey == "" {
		return nil, fmt.Errorf("plantnet api key is empty")
	}
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()

	u, err := c.url(path, q)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Accept", "application/json")
	return c.do(httpReq)
}

func (c *Client) identify(ctx context.Context, path, fileField string, req IdentifyRequest, photos []Photo) ([]byte, error) {
	if c == nil || c.APIKey == "" {
		return nil, fmt.Errorf("plantnet api key is empty")
	}
	if len(photos) == 0 {
		return nil, fmt.Errorf("no photos")
	}
	ctx, cancel := context.WithTimeout(ctx, 22*time.Second)
	defer cancel()

	body := &bytes.Buffer{}
	mpw := multipart.NewWriter(body)
	for i, photo := range photos {
		organ := "auto"
		if i < len(req.Organs) && req.Organs[i] != "" {
			organ = req.Organs[i]
		}
		if err := mpw.WriteField("organs", organ); err != nil {
			return nil, err
		}
		name := photo.Filename
		if name == "" {
			name = "plant.jpg"
		}
		part, err := createImagePart(mpw, fileField, name, photo.ContentType)
		if err != nil {
			return nil, err
		}
		if _, err := part.Write(photo.Bytes); err != nil {
			return nil, err
		}
	}
	if err := mpw.Close(); err != nil {
		return nil, err
	}

	q := url.Values{}
	if req.Lang != "" {
		q.Set("lang", req.Lang)
	}
	if req.NBResults > 0 {
		q.Set("nb-results", strconv.Itoa(req.NBResults))
	}
	if req.IncludeRelatedImages {
		q.Set("include-related-images", "true")
	}
	if req.NoReject {
		q.Set("no-reject", "true")
	}
	if req.Detailed {
		q.Set("detailed", "true")
	}

	u, err := c.url(path, q)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, u, body)
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", mpw.FormDataContentType())
	httpReq.Header.Set("Accept", "application/json")
	return c.do(httpReq)
}

// createImagePart sends the photo with an image content type. CreateFormFile
// labels every part application/octet-stream, and Pl@ntNet rejects that.
func createImagePart(w *multipart.Writer, field, filename, contentType string) (io.Writer, error) {
	if contentType == "" {
		contentType = "image/jpeg"
	}
	filename = strings.NewReplacer(`\`, "", `"`, "").Replace(filename)
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, field, filename))
	h.Set("Content-Type", contentType)
	return w.CreatePart(h)
}

func (c *Client) url(path string, q url.Values) (string, error) {
	base := strings.TrimRight(c.BaseURL, "/")
	if base == "" {
		base = defaultBaseURL
	}
	u, err := url.Parse(base + path)
	if err != nil {
		return "", err
	}
	params := url.Values{}
	for k, vs := range q {
		for _, v := range vs {
			params.Add(k, v)
		}
	}
	params.Set("api-key", c.APIKey)
	u.RawQuery = params.Encode()
	return u.String(), nil
}

func (c *Client) do(req *http.Request) ([]byte, error) {
	httpClient := c.HTTP
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	// Identification payloads with related images can be large; cap the
	// read so a misbehaving upstream cannot pin memory.
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &APIError{Status: resp.StatusCode, Body: clip(raw, 180)}
	}
	return raw, nil
}

func clip(b []byte, n int) string {
	s := strings.TrimSpace(string(b))
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) > n {
		s = s[:n]
	}
	return s
}
