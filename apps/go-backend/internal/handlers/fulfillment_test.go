package handlers

import (
	"testing"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/fulfillment"
)

func f(v float64) *float64 { return &v }

func TestDestinationRequestToFulfillment(t *testing.T) {
	cases := []struct {
		name       string
		req        DestinationRequest
		wantCoords bool
	}{
		{"both coordinates", DestinationRequest{Latitude: f(17.4), Longitude: f(78.4)}, true},
		{"latitude only", DestinationRequest{Latitude: f(17.4)}, false},
		{"longitude only", DestinationRequest{Longitude: f(78.4)}, false},
		{"neither", DestinationRequest{Pincode: "500081"}, false},
		// A null island reading means the device reported nothing useful.
		{"zero pair", DestinationRequest{Latitude: f(0), Longitude: f(0)}, false},
		{"latitude out of range", DestinationRequest{Latitude: f(117), Longitude: f(78.4)}, false},
		{"longitude out of range", DestinationRequest{Latitude: f(17.4), Longitude: f(-400)}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.req.toFulfillment()
			hasCoords := got.Lat != nil && got.Lng != nil
			if hasCoords != tc.wantCoords {
				t.Errorf("coordinates used = %v, want %v", hasCoords, tc.wantCoords)
			}
			if got.Pincode != tc.req.Pincode {
				t.Errorf("pincode = %q, want %q", got.Pincode, tc.req.Pincode)
			}
		})
	}
}

func TestBulkQuoteIsNotPayableAtCheckout(t *testing.T) {
	// Checkout must never produce a Razorpay order for a bulk quote: it has
	// no agreed price until sales sends one.
	for channel, payable := range map[string]bool{
		"store_pickup": true,
		"courier":      true,
		"own_vehicle":  true,
		"bulk_quote":   false,
		"":             false,
		"teleport":     false,
	} {
		if got := payableChannels[fulfillment.Channel(channel)]; got != payable {
			t.Errorf("payableChannels[%q] = %v, want %v", channel, got, payable)
		}
	}
}
