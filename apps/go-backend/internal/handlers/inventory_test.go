package handlers

import (
	"testing"
	"time"
)

func TestSelectAbandonedNudges(t *testing.T) {
	now := time.Date(2026, 10, 18, 12, 10, 0, 0, time.UTC)
	recent := now.Add(-35 * time.Minute)
	older := now.Add(-3 * time.Hour)

	orders := []abandonedCandidate{
		{ID: 1, CustomerEmail: "a@example.com", CreatedAt: older},
		{ID: 2, CustomerEmail: "A@example.com", CreatedAt: recent},
		{ID: 3, CustomerEmail: "a@example.com", CreatedAt: recent.Add(time.Minute)},
		{ID: 4, CustomerEmail: "b@example.com", CreatedAt: recent},
		{ID: 5, CustomerEmail: "not-an-email", CreatedAt: recent},
		{ID: 6, CustomerEmail: "", CreatedAt: recent},
	}

	got := selectAbandonedNudges(orders, now, 8)
	if len(got) != 2 {
		t.Fatalf("got %d nudges, want 2: %+v", len(got), got)
	}
	// Newest cart for a repeated address wins.
	if got[0].ID != 3 || got[0].CustomerEmail != "a@example.com" {
		t.Fatalf("first nudge = %+v, want order 3 for a@example.com", got[0])
	}
	if got[1].ID != 4 || got[1].CustomerEmail != "b@example.com" {
		t.Fatalf("second nudge = %+v, want order 4 for b@example.com", got[1])
	}

	capped := selectAbandonedNudges(orders, now, 1)
	if len(capped) != 1 || capped[0].ID != 3 {
		t.Fatalf("cap = %+v, want only the newest order", capped)
	}
}

func TestSelectAbandonedAlertsIncludesCheckoutWithoutEmail(t *testing.T) {
	now := time.Date(2026, 10, 18, 12, 10, 0, 0, time.UTC)
	recent := now.Add(-35 * time.Minute)
	older := now.Add(-3 * time.Hour)

	orders := []abandonedCandidate{
		{ID: 1, CustomerEmail: "a@example.com", CreatedAt: older},
		{ID: 2, CustomerEmail: "A@example.com", CreatedAt: recent},
		{ID: 3, CustomerEmail: "", CreatedAt: recent.Add(2 * time.Minute)},
		{ID: 4, CustomerEmail: "not-an-email", CreatedAt: recent.Add(3 * time.Minute)},
	}

	got := selectAbandonedAlerts(orders, now, 8)
	if len(got) != 3 {
		t.Fatalf("got %d alerts, want 3 (stale order skipped): %+v", len(got), got)
	}
	if got[0].ID != 4 || got[1].ID != 3 || got[2].ID != 2 || got[2].CustomerEmail != "a@example.com" {
		t.Fatalf("order = %+v, want newest first and the email-less checkouts included", got)
	}
}
