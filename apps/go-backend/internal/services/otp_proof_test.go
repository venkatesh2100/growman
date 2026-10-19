package services

import (
	"context"
	"sync"
	"testing"
)

// The proof token is what stops a guest from placing an order against an
// email address they never verified, so each property below is load
// bearing: bound to one email, single use, and unguessable.
func TestVerificationProof(t *testing.T) {
	ctx := context.Background()
	// No Redis client: the service falls back to its in-memory store,
	// which is enough to exercise the semantics.
	s := NewOTPService(nil)

	token, err := s.IssueVerificationProof(ctx, "Asha@Example.com")
	if err != nil {
		t.Fatalf("IssueVerificationProof: %v", err)
	}
	if len(token) != 64 {
		t.Fatalf("token length %d, want 64", len(token))
	}

	// Email matching is case- and whitespace-insensitive, since the
	// address the customer types at checkout may not match character for
	// character what they typed when requesting the OTP.
	ok, err := s.ConsumeVerificationProof(ctx, "  asha@example.com  ", token)
	if err != nil {
		t.Fatalf("ConsumeVerificationProof: %v", err)
	}
	if !ok {
		t.Fatal("a freshly issued proof was rejected")
	}

	// Single use: the same proof must not place a second order.
	ok, _ = s.ConsumeVerificationProof(ctx, "asha@example.com", token)
	if ok {
		t.Fatal("a proof was accepted twice; it must be consumed on use")
	}
}

func TestVerificationProofRejections(t *testing.T) {
	ctx := context.Background()
	s := NewOTPService(nil)

	token, err := s.IssueVerificationProof(ctx, "asha@example.com")
	if err != nil {
		t.Fatalf("IssueVerificationProof: %v", err)
	}

	tests := []struct {
		name  string
		email string
		token string
	}{
		{"empty token", "asha@example.com", ""},
		{"wrong token", "asha@example.com", "0000000000000000000000000000000000000000000000000000000000000000"},
		{"truncated token", "asha@example.com", token[:32]},
		// The important one: a proof issued for one address must not
		// authorise an order for another.
		{"different email", "attacker@example.com", token},
		{"no proof issued for this email", "nobody@example.com", token},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ok, err := s.ConsumeVerificationProof(ctx, tc.email, tc.token)
			if err != nil {
				t.Fatalf("ConsumeVerificationProof: %v", err)
			}
			if ok {
				t.Fatalf("accepted a proof it should have rejected (email=%q)", tc.email)
			}
		})
	}

	// None of the failed attempts may have burned the real proof.
	ok, err := s.ConsumeVerificationProof(ctx, "asha@example.com", token)
	if err != nil {
		t.Fatalf("ConsumeVerificationProof: %v", err)
	}
	if !ok {
		t.Fatal("a failed attempt consumed the valid proof")
	}
}

// A proof that is single-use only when requests arrive one at a time is not
// single-use. Two create-order requests firing together is the realistic
// case — a double-clicked pay button — so exactly one must win.
func TestVerificationProofConsumedOnceUnderConcurrency(t *testing.T) {
	ctx := context.Background()
	s := NewOTPService(nil)

	token, err := s.IssueVerificationProof(ctx, "asha@example.com")
	if err != nil {
		t.Fatalf("IssueVerificationProof: %v", err)
	}

	const racers = 16
	start := make(chan struct{})
	results := make(chan bool, racers)
	var wg sync.WaitGroup
	for range racers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			ok, _ := s.ConsumeVerificationProof(ctx, "asha@example.com", token)
			results <- ok
		}()
	}
	close(start)
	wg.Wait()
	close(results)

	accepted := 0
	for ok := range results {
		if ok {
			accepted++
		}
	}
	if accepted != 1 {
		t.Fatalf("%d of %d concurrent consumers accepted the proof, want exactly 1", accepted, racers)
	}
}

func TestVerificationProofsAreDistinct(t *testing.T) {
	ctx := context.Background()
	s := NewOTPService(nil)

	seen := make(map[string]bool, 50)
	for i := range 50 {
		token, err := s.IssueVerificationProof(ctx, "user@example.com")
		if err != nil {
			t.Fatalf("issue %d: %v", i, err)
		}
		if seen[token] {
			t.Fatal("IssueVerificationProof returned a duplicate token")
		}
		seen[token] = true
	}
}
