package handlers

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/plantnet"
	"golang.org/x/sync/singleflight"
)

// plantMem keeps Pl@ntNet responses in-process for longer than the shared
// catalog cache, whose in-process tier expires after two minutes. Without
// Redis that two-minute window would send the same photo back to Pl@ntNet
// and spend another identify credit.
const plantMemMax = 256

type plantEntry struct {
	raw []byte
	exp time.Time
}

type plantMemStore struct {
	mu           sync.Mutex
	items        map[string]plantEntry
	remaining    int
	remainingOK  bool
	remainingDay string
	flight       singleflight.Group
}

var plantMem = &plantMemStore{items: map[string]plantEntry{}}

func (s *plantMemStore) get(key string, now time.Time) ([]byte, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.items[key]
	if !ok || now.After(item.exp) {
		if ok {
			delete(s.items, key)
		}
		return nil, false
	}
	return append([]byte(nil), item.raw...), true
}

func (s *plantMemStore) set(key string, raw []byte, ttl time.Duration, now time.Time) {
	if len(raw) == 0 || ttl <= 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.items) >= plantMemMax {
		for k, v := range s.items {
			if now.After(v.exp) {
				delete(s.items, k)
			}
		}
	}
	if len(s.items) >= plantMemMax {
		for k := range s.items {
			delete(s.items, k)
			break
		}
	}
	s.items[key] = plantEntry{raw: append([]byte(nil), raw...), exp: now.Add(ttl)}
}

func (s *plantMemStore) noteRemaining(n int, now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.remaining = n
	s.remainingOK = true
	s.remainingDay = now.UTC().Format("2006-01-02")
}

func (s *plantMemStore) knownRemaining(now time.Time) (int, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.remainingOK || s.remainingDay != now.UTC().Format("2006-01-02") {
		return 0, false
	}
	return s.remaining, true
}

func (h *Handler) plantLoad(ctx context.Context, key string, now time.Time) ([]byte, bool) {
	if raw, ok := plantMem.get(key, now); ok {
		return raw, true
	}
	if h == nil || h.Cache == nil {
		return nil, false
	}
	raw, ok := h.Cache.GetRaw(ctx, key)
	if !ok {
		return nil, false
	}
	plantMem.set(key, raw, 10*time.Minute, now)
	return raw, true
}

func (h *Handler) plantSet(ctx context.Context, key string, raw []byte, ttl time.Duration, now time.Time) {
	plantMem.set(key, raw, ttl, now)
	if h != nil && h.Cache != nil {
		_ = h.Cache.SetRaw(ctx, key, raw, ttl)
	}
}

func (h *Handler) noteIdentifyRemaining(ctx context.Context, n int, now time.Time) {
	plantMem.noteRemaining(n, now)
	if h != nil && h.Cache != nil {
		_ = h.Cache.Set(ctx, "plantnet:identify-remaining", n, plantnet.UntilUTCMidnight(now))
	}
}

func (h *Handler) identifyRemaining(ctx context.Context, now time.Time) (int, bool) {
	if n, ok := plantMem.knownRemaining(now); ok {
		return n, true
	}
	if h == nil || h.Cache == nil {
		return 0, false
	}
	var n int
	ok, err := h.Cache.Get(ctx, "plantnet:identify-remaining", &n)
	if err != nil || !ok {
		return 0, false
	}
	plantMem.noteRemaining(n, now)
	return n, true
}

func (h *Handler) plantClient() *plantnet.Client {
	c := plantnet.New(h.Cfg.PlantNetAPIKey)
	if base := strings.TrimSpace(h.Cfg.PlantNetBaseURL); base != "" {
		c.BaseURL = base
	}
	return c
}
