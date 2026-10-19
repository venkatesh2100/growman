package plantnet

import (
	"context"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIdentifyRoutesAndMultipart(t *testing.T) {
	var gotPath, gotQuery, fileField string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.RawQuery
		if r.URL.Query().Get("api-key") == "" {
			t.Errorf("api key missing")
		}
		_, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil {
			t.Errorf("content type: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		mr := multipart.NewReader(r.Body, params["boundary"])
		for {
			part, err := mr.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Errorf("part: %v", err)
				break
			}
			if part.FileName() != "" {
				fileField = part.FormName()
				if ct := part.Header.Get("Content-Type"); ct != "image/jpeg" {
					t.Errorf("file content type = %q", ct)
				}
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"remainingIdentificationRequests":10,"bestMatch":"x","results":[]}`))
	}))
	defer srv.Close()

	c := New("secret-key")
	c.BaseURL = srv.URL
	c.HTTP = srv.Client()
	photos := []Photo{{Filename: "leaf.jpg", ContentType: "image/jpeg", Bytes: []byte("jpeg")}}
	req := IdentifyRequest{Project: "all", Lang: "en", NBResults: 5, Organs: []string{"leaf"}}

	if _, err := c.IdentifySpecies(context.Background(), req, photos); err != nil {
		t.Fatal(err)
	}
	if gotPath != "/v2/identify/all" || fileField != "images" {
		t.Fatalf("species path=%s field=%s", gotPath, fileField)
	}
	if !strings.Contains(gotQuery, "lang=en") || !strings.Contains(gotQuery, "nb-results=5") {
		t.Fatalf("query = %s", gotQuery)
	}
	if strings.Contains(gotQuery, "type=legacy") {
		t.Fatal("legacy flora must not be requested")
	}

	if _, err := c.IdentifyDiseases(context.Background(), req, photos); err != nil {
		t.Fatal(err)
	}
	if gotPath != "/v2/diseases/identify" || fileField != "image" {
		t.Fatalf("diseases path=%s field=%s", gotPath, fileField)
	}

	if _, err := c.IdentifyVarieties(context.Background(), req, photos); err != nil {
		t.Fatal(err)
	}
	if gotPath != "/v2/varieties/identify" || fileField != "images" {
		t.Fatalf("varieties path=%s field=%s", gotPath, fileField)
	}
}

func TestAPIErrorHidesBodyLength(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"message":"quota"}`))
	}))
	defer srv.Close()
	c := New("k")
	c.BaseURL = srv.URL
	c.HTTP = srv.Client()
	_, err := c.Get(context.Background(), "/v2/quota", nil)
	apiErr, ok := err.(*APIError)
	if !ok || apiErr.Status != http.StatusTooManyRequests {
		t.Fatalf("err = %v", err)
	}
}
