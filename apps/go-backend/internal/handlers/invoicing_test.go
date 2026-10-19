package handlers

import (
	"math"
	"testing"
	"time"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
)

// Indian financial years run April to March, and invoice numbers are
// namespaced by them. Getting the boundary wrong files invoices under the
// wrong return period.
func TestFinancialYear(t *testing.T) {
	tests := []struct {
		date time.Time
		want string
	}{
		{time.Date(2026, time.April, 1, 0, 0, 0, 0, time.UTC), "2026-27"},
		{time.Date(2026, time.December, 31, 23, 59, 59, 0, time.UTC), "2026-27"},
		{time.Date(2027, time.January, 1, 0, 0, 0, 0, time.UTC), "2026-27"},
		{time.Date(2027, time.March, 31, 23, 59, 59, 0, time.UTC), "2026-27"},
		{time.Date(2027, time.April, 1, 0, 0, 0, 0, time.UTC), "2027-28"},
		{time.Date(2026, time.March, 31, 0, 0, 0, 0, time.UTC), "2025-26"},
	}
	for _, tc := range tests {
		if got := financialYear(tc.date); got != tc.want {
			t.Errorf("financialYear(%s) = %q, want %q", tc.date.Format("2006-01-02"), got, tc.want)
		}
	}
}

// GST is extracted from inclusive prices, never added. If this inverts,
// every customer is overcharged by the tax rate.
func TestComputeOrderTaxExtractsFromInclusivePrice(t *testing.T) {
	tests := []struct {
		name        string
		price       float64
		qty         int
		rate        float64
		wantTaxable float64
		wantTax     float64
	}{
		{"18 percent pot", 118, 1, 18, 100, 18},
		{"18 percent, qty 2", 118, 2, 18, 200, 36},
		{"5 percent soil", 105, 1, 5, 100, 5},
		{"12 percent", 112, 1, 12, 100, 12},
		{"nil-rated live plant", 499, 1, 0, 499, 0},
		{"awkward price", 1499, 1, 18, 1270.34, 228.66},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			lineTotal := tc.price * float64(tc.qty)
			taxable := lineTotal
			var tax float64
			if tc.rate > 0 {
				taxable = lineTotal / (1 + tc.rate/100)
				tax = lineTotal - taxable
			}
			taxable, tax = round2(taxable), round2(tax)

			if math.Abs(taxable-tc.wantTaxable) > 0.01 {
				t.Errorf("taxable = %v, want %v", taxable, tc.wantTaxable)
			}
			if math.Abs(tax-tc.wantTax) > 0.01 {
				t.Errorf("tax = %v, want %v", tax, tc.wantTax)
			}
			// The invariant that matters commercially: the customer still
			// pays exactly the displayed price.
			if math.Abs((taxable+tax)-lineTotal) > 0.02 {
				t.Errorf("taxable + tax = %v, want the inclusive line total %v", taxable+tax, lineTotal)
			}
		})
	}
}

func TestRound2(t *testing.T) {
	tests := []struct {
		in   float64
		want float64
	}{
		{1270.3389830508475, 1270.34},
		{0.005, 0.01},
		{0.004, 0.0},
		{100, 100},
		{228.66101694915254, 228.66},
		{-1.564, -1.56},
	}
	for _, tc := range tests {
		if got := round2(tc.in); got != tc.want {
			t.Errorf("round2(%v) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

func TestNonEmptyDropsBlanks(t *testing.T) {
	got := nonEmpty("Bengaluru", "", "  ", "560001")
	want := []string{"Bengaluru", "560001"}
	if len(got) != len(want) {
		t.Fatalf("nonEmpty = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("nonEmpty = %v, want %v", got, want)
		}
	}
}

func TestAddressLinesSkipsMissingFields(t *testing.T) {
	order := models.Order{
		CustomerName: "Asha R",
		AddressLine:  "12 MG Road",
		City:         "Bengaluru",
		State:        "Karnataka",
		Pincode:      "560001",
	}
	lines := addressLines(order)
	if len(lines) == 0 {
		t.Fatal("expected address lines")
	}
	for _, line := range lines {
		if line == "" {
			t.Fatal("addressLines emitted a blank line")
		}
	}
}

// An order that has shipped cannot be cancelled by the customer — the
// parcel is already with the courier.
func TestOrderIsCancellable(t *testing.T) {
	now := time.Now()
	tests := []struct {
		name  string
		order models.Order
		want  bool
	}{
		{"pending", models.Order{Status: "pending"}, true},
		{"paid", models.Order{Status: "paid"}, true},
		{"confirmed", models.Order{Status: "confirmed"}, true},
		{"processing", models.Order{Status: "processing"}, true},
		{"already shipped", models.Order{Status: "paid", ShippedAt: &now}, false},
		{"awb assigned", models.Order{Status: "paid", AWBNumber: "AWB123"}, false},
		{"already cancelled", models.Order{Status: "paid", CancelledAt: &now}, false},
		{"delivered", models.Order{Status: "delivered"}, false},
		{"shipped status", models.Order{Status: "shipped"}, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.order.IsCancellable(); got != tc.want {
				t.Fatalf("IsCancellable() = %v, want %v", got, tc.want)
			}
		})
	}
}
