package cache

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestL1GetSetRoundTrip(t *testing.T) {
	c := NewHelper(nil)
	ctx := context.Background()
	type payload struct {
		Name string `json:"name"`
	}
	if err := c.Set(ctx, "k1", payload{Name: "oak"}, time.Minute); err != nil {
		t.Fatal(err)
	}
	var got payload
	hit, err := c.Get(ctx, "k1", &got)
	if err != nil {
		t.Fatal(err)
	}
	if !hit {
		t.Fatal("expected L1 hit")
	}
	if got.Name != "oak" {
		t.Fatalf("got %+v", got)
	}
}

func TestGetOrLoadRawCoalesces(t *testing.T) {
	c := NewHelper(nil)
	ctx := context.Background()
	loads := 0
	raw, err := c.GetOrLoadRaw(ctx, "stampede", time.Minute, func() ([]byte, error) {
		loads++
		return []byte(`{"ok":true}`), nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{"ok":true}` {
		t.Fatalf("raw = %s", raw)
	}
	_, err = c.GetOrLoadRaw(ctx, "stampede", time.Minute, func() ([]byte, error) {
		loads++
		return []byte(`{"ok":false}`), nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if loads != 1 {
		t.Fatalf("load called %d times, want 1", loads)
	}
}

func TestDeletePatternLocal(t *testing.T) {
	c := NewHelper(nil)
	ctx := context.Background()
	_ = c.SetRaw(ctx, "products:list:1", []byte("a"), time.Minute)
	_ = c.SetRaw(ctx, "products:list:2", []byte("b"), time.Minute)
	_ = c.SetRaw(ctx, "brands:all", []byte("c"), time.Minute)
	if err := c.DeletePattern(ctx, "products:list:*"); err != nil {
		t.Fatal(err)
	}
	if _, ok := c.GetRaw(ctx, "products:list:1"); ok {
		t.Fatal("list key should be gone")
	}
	if _, ok := c.GetRaw(ctx, "brands:all"); !ok {
		t.Fatal("unrelated key should remain")
	}
}

func TestServePublicNotModified(t *testing.T) {
	raw := []byte(`{"n":1}`)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	ServePublic(rr, req, raw)
	etag := rr.Header().Get("ETag")
	if etag == "" {
		t.Fatal("missing etag")
	}

	req2 := httptest.NewRequest(http.MethodGet, "/", nil)
	req2.Header.Set("If-None-Match", etag)
	rr2 := httptest.NewRecorder()
	ServePublic(rr2, req2, raw)
	if rr2.Code != http.StatusNotModified {
		t.Fatalf("status = %d", rr2.Code)
	}
}

func TestHashKeyStable(t *testing.T) {
	if HashKey("Oak") != HashKey(" oak ") {
		t.Fatal("hash should be case/space insensitive")
	}
	var v map[string]int
	if err := json.Unmarshal([]byte(`{"a":1}`), &v); err != nil {
		t.Fatal(err)
	}
}
