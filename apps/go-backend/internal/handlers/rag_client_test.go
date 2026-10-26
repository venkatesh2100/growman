package handlers

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/config"
)

func TestAskRAGReadsAnswer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/answer" {
			t.Errorf("path %s", r.URL.Path)
		}
		if r.Header.Get("X-Growman-RAG-Secret") != "s3cret" {
			t.Errorf("secret %q", r.Header.Get("X-Growman-RAG-Secret"))
		}
		body, _ := io.ReadAll(r.Body)
		if len(body) == 0 {
			t.Fatal("empty body")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"response":"Water when the top soil is dry.","productSlugs":["snake-plant"],"route":"plant_care","usedLlm":false}`)
	}))
	defer server.Close()

	h := &Handler{Cfg: config.Config{RAGServiceURL: server.URL, RAGSharedSecret: "s3cret"}}
	ans, err := h.askRAG(context.Background(), "how often should I water a snake plant", nil)
	if err != nil {
		t.Fatal(err)
	}
	if ans.Response == "" || ans.ProductSlugs[0] != "snake-plant" || ans.UsedLLM {
		t.Fatalf("unexpected answer %+v", ans)
	}
}

func TestAskRAGCarePostsSpecies(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/care" {
			t.Errorf("path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"light":"bright indirect","water":"when the top soil is dry"}`)
	}))
	defer server.Close()

	h := &Handler{Cfg: config.Config{RAGServiceURL: server.URL, RAGSharedSecret: "s3cret"}}
	raw, err := h.askRAGCare(context.Background(), ragCareRequest{Species: "Dracaena trifasciata"})
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) == 0 || raw[0] != '{' {
		t.Fatalf("body %s", raw)
	}
}
