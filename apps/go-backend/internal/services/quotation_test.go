package services

import (
	"bytes"
	"os"
	"strings"
	"testing"
	"time"
)

func TestRupeesInWords(t *testing.T) {
	cases := map[float64]string{
		0:         "Zero Rupees only",
		1:         "One Rupees only",
		70:        "Seventy Rupees only",
		370:       "Three Hundred and Seventy Rupees only",
		1306:      "One Thousand Three Hundred and Six Rupees only",
		546020:    "Five Lakh Forty Six Thousand and Twenty Rupees only",
		800370:    "Eight Lakh Three Hundred and Seventy Rupees only",
		10000000:  "One Crore Rupees only",
		123456789: "Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred and Eighty Nine Rupees only",
		99.5:      "Ninety Nine Rupees and Fifty Paise only",
	}
	for in, want := range cases {
		if got := RupeesInWords(in); got != want {
			t.Errorf("RupeesInWords(%v) = %q, want %q", in, got, want)
		}
	}
}

func TestFormatRupees(t *testing.T) {
	cases := map[float64]string{
		0:      "Rs. 0",
		70:     "Rs. 70",
		8890:   "Rs. 8,890",
		546020: "Rs. 546,020",
		70.5:   "Rs. 70.50",
	}
	for in, want := range cases {
		if got := FormatRupees(in); got != want {
			t.Errorf("FormatRupees(%v) = %q, want %q", in, got, want)
		}
	}
}

func TestQuotationItemCode(t *testing.T) {
	if got := QuotationItemCode(12, 345); got != "GM00120345" {
		t.Fatalf("got %q", got)
	}
}

func TestQuotationFinalizeAndRender(t *testing.T) {
	freight := 1000.0
	q := Quotation{
		EstimateNo: "GMQ-2609-0001",
		Date:       "23-09-2026",
		Requester:  QuotationRequester{Name: "Ravi <script>", Phone: "9876543210", Address: "Plot 12, Road No. 3, Banjara Hills, Hyderabad 500034"},
		Lines: []QuotationLine{
			{ItemCode: "GM00010001", Name: "Eranthemum Purple", Size: "13 X 13", Quantity: 127, Unit: "Nos", Rate: 70},
			{ItemCode: "GM00020002", Name: "Boston Fern", Size: "7 X 8", Quantity: 538, Unit: "Nos", Rate: 100},
			{Name: "Rudraksha", Size: "6 ft", Quantity: 5, Unit: "Nos", Requested: true},
		},
		Charges: []QuotationCharge{
			{Label: "Freight Charges", Requested: true, Amount: &freight},
			{Label: "Plantation Labour Charges", Requested: true},
		},
	}
	q.Finalize()

	if q.GoodsTotal != 62690 || q.Total != 63690 || q.TotalUnits != 670 {
		t.Fatalf("totals = %v / %v / %v", q.GoodsTotal, q.Total, q.TotalUnits)
	}
	if q.Lines[1].No != 2 || q.Lines[1].Amount != 53800 {
		t.Fatalf("line = %+v", q.Lines[1])
	}
	if !q.PendingCharges() {
		t.Fatal("expected pending charges")
	}

	meta := QuotationMeta{Submitted: time.Date(2026, 9, 23, 10, 0, 0, 0, time.UTC)}
	htmlBody := QuotationHTML(q, meta)
	for _, want := range []string{"Rs. 8,890", "Rs. 53,800", "Rs. 62,690", "To be quoted", "Sixty Three Thousand Six Hundred and Ninety Rupees only", "Terms and conditions", "Hyderabad, Telangana", "nursery-logo.png", "Unit Rate", "(requested)", "For Sri Shirdi Sai Nursery"} {
		if !strings.Contains(htmlBody, want) {
			t.Errorf("html missing %q", want)
		}
	}
	if strings.Contains(htmlBody, "<script>") {
		t.Error("requester name was not escaped")
	}
	text := QuotationText(q, meta)
	for _, want := range []string{
		"2 | GM00020002 | Boston Fern | 7 X 8 | 538 | Rs. 100 | Rs. 53,800",
		"3 | - | Rudraksha (requested) | 6 ft | 5 | On request | -",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("text missing %q:\n%s", want, text)
		}
	}
	pdf, err := QuotationPDF(q)
	if err != nil {
		t.Fatalf("pdf: %v", err)
	}
	if !bytes.HasPrefix(pdf, []byte("%PDF-")) || len(pdf) < 5000 {
		t.Fatalf("pdf looks invalid (%d bytes)", len(pdf))
	}
	if out := os.Getenv("QUOTATION_PDF_OUT"); out != "" {
		_ = os.WriteFile(out, pdf, 0o644)
	}
	if strings.Contains(htmlBody+text, "Kapulapalem") {
		t.Error("quotation must only carry the Hyderabad address")
	}
}
