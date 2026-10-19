package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/config"
)

func TestIdentifyPlantSpendsOneDiseaseCreditAndCachesThePhoto(t *testing.T) {
	var speciesCalls, diseaseCalls, varietyCalls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/v2/identify/"):
			speciesCalls.Add(1)
			_, _ = w.Write([]byte(`{
				"bestMatch":"Epipremnum aureum (Linden & André) G.S.Bunting",
				"remainingIdentificationRequests":120,
				"results":[{
					"score":0.91,
					"species":{
						"scientificNameWithoutAuthor":"Epipremnum aureum",
						"scientificName":"Epipremnum aureum (Linden & André) G.S.Bunting",
						"commonNames":["money plant"],
						"family":{"scientificName":"Araceae"},
						"genus":{"scientificName":"Epipremnum"}
					}
				}]
			}`))
		case r.Method == http.MethodPost && r.URL.Path == "/v2/diseases/identify":
			diseaseCalls.Add(1)
			_, _ = w.Write([]byte(`{"remainingIdentificationRequests":119,"results":[{"name":"APHISP","score":0.8,"description":"Aphis sp."}]}`))
		case r.Method == http.MethodPost && r.URL.Path == "/v2/varieties/identify":
			varietyCalls.Add(1)
			http.Error(w, "variety should not be called", http.StatusInternalServerError)
		case r.URL.Path == "/v2/varieties":
			_, _ = w.Write([]byte(`[{"name":"Gros locard","species":{"scientificNameWithoutAuthor":"Malus domestica"}}]`))
		case r.URL.Path == "/v2/diseases":
			_, _ = w.Write([]byte(`[{"name":"APHISP","label":"Aphis"}]`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	h := &Handler{Cfg: config.Config{
		PlantNetAPIKey:  "test-key",
		PlantNetBaseURL: srv.URL,
		PlantNetProject: "all",
		PlantNetReserve: 40,
	}}

	photo := []byte("jpeg-bytes-unique-care-scan")
	first := postScan(t, h, "money-plant.jpg", photo)
	if first.Code != http.StatusOK {
		t.Fatalf("status %d body %s", first.Code, first.Body.String())
	}
	var doc map[string]any
	if err := json.Unmarshal(first.Body.Bytes(), &doc); err != nil {
		t.Fatal(err)
	}
	if doc["bestMatch"] == "" {
		t.Fatalf("bestMatch missing: %s", first.Body.String())
	}
	health, _ := doc["health"].(map[string]any)
	if health["ran"] != true {
		t.Fatalf("health = %#v", health)
	}
	varieties, _ := doc["varieties"].(map[string]any)
	if varieties["skipped"] != "not_in_catalog" {
		t.Fatalf("varieties = %#v", varieties)
	}
	quota, _ := doc["quota"].(map[string]any)
	if quota["creditsUsed"] != float64(2) || quota["cached"] == true {
		t.Fatalf("quota = %#v", quota)
	}
	if speciesCalls.Load() != 1 || diseaseCalls.Load() != 1 || varietyCalls.Load() != 0 {
		t.Fatalf("calls species=%d disease=%d variety=%d", speciesCalls.Load(), diseaseCalls.Load(), varietyCalls.Load())
	}

	second := postScan(t, h, "money-plant.jpg", photo)
	if second.Code != http.StatusOK {
		t.Fatalf("cached status %d %s", second.Code, second.Body.String())
	}
	var again map[string]any
	if err := json.Unmarshal(second.Body.Bytes(), &again); err != nil {
		t.Fatal(err)
	}
	q2, _ := again["quota"].(map[string]any)
	if q2["cached"] != true || q2["creditsUsed"] != float64(0) {
		t.Fatalf("replay quota = %#v", q2)
	}
	if speciesCalls.Load() != 1 || diseaseCalls.Load() != 1 {
		t.Fatalf("replay spent credits species=%d disease=%d", speciesCalls.Load(), diseaseCalls.Load())
	}
}

func TestIdentifyPlantHoldsTheReserve(t *testing.T) {
	var diseaseCalls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v2/diseases/identify" {
			diseaseCalls.Add(1)
		}
		_, _ = w.Write([]byte(`{
			"bestMatch":"Ajuga genevensis L.",
			"remainingIdentificationRequests":40,
			"results":[{"score":0.5,"species":{"scientificNameWithoutAuthor":"Ajuga genevensis","scientificName":"Ajuga genevensis L."}}]
		}`))
	}))
	defer srv.Close()

	h := &Handler{Cfg: config.Config{
		PlantNetAPIKey:  "test-key",
		PlantNetBaseURL: srv.URL,
		PlantNetProject: "all",
		PlantNetReserve: 40,
	}}
	// 40 left is the reserve, so this scan must stay on the species credit.
	h.noteIdentifyRemaining(context.Background(), 40, time.Now())
	res := postScan(t, h, "leaf.jpg", []byte("reserve-photo-bytes"))
	if res.Code != http.StatusOK {
		t.Fatalf("status %d %s", res.Code, res.Body.String())
	}
	if diseaseCalls.Load() != 0 {
		t.Fatalf("disease calls = %d", diseaseCalls.Load())
	}
	var doc map[string]any
	if err := json.Unmarshal(res.Body.Bytes(), &doc); err != nil {
		t.Fatal(err)
	}
	health, _ := doc["health"].(map[string]any)
	if health["skipped"] != "quota_reserve" {
		t.Fatalf("health = %#v", health)
	}
	quota, _ := doc["quota"].(map[string]any)
	if quota["creditsUsed"] != float64(1) {
		t.Fatalf("quota = %#v", quota)
	}
}

func jpegWithTrailer(trailer []byte) []byte {
	n := 8 + len(trailer)%24
	img := image.NewRGBA(image.Rect(0, 0, n, n))
	var r, g byte
	for i, b := range trailer {
		if i%2 == 0 {
			r ^= b
		} else {
			g ^= b
		}
	}
	img.Set(0, 0, color.RGBA{R: r, G: g, B: 20, A: 255})
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 75}); err != nil {
		panic(err)
	}
	return buf.Bytes()
}

func postScan(t *testing.T, h *Handler, name string, content []byte) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("image", name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(jpegWithTrailer(content)); err != nil {
		t.Fatal(err)
	}
	if err := w.WriteField("focus", "care"); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/images/identify-plant", bytes.NewReader(buf.Bytes()))
	req.Header.Set("Content-Type", w.FormDataContentType())
	rec := httptest.NewRecorder()
	h.IdentifyPlant(rec, req)
	return rec
}
