package services

import (
	"bytes"
	"fmt"
	"sort"
	"time"

	"github.com/go-pdf/fpdf"
)

// Invoice is a GST tax invoice for a retail order.
//
// Amounts are GST-inclusive, matching how prices are shown on the
// storefront: TaxableValue + TaxAmount equals the goods subtotal, and
// Total is what the customer actually paid including delivery.
type Invoice struct {
	Number        string
	Date          time.Time
	OrderID       uint
	CustomerName  string
	CustomerEmail string
	CustomerPhone string
	AddressLines  []string
	Lines         []InvoiceLine
	Subtotal      float64
	DeliveryFee   float64
	Discount      float64
	TaxableValue  float64
	TaxAmount     float64
	// TaxByRate maps a GST percentage to the tax collected at it, so each
	// rate can be shown on its own line as GST returns require.
	TaxByRate  map[float64]float64
	Total      float64
	Refunded   float64
	PaymentRef string
}

// InvoiceLine is one line item on an invoice.
type InvoiceLine struct {
	Description string
	Quantity    int
	UnitPrice   float64
	LineTotal   float64
}

// Invoice table column widths (mm); they add up to pdfContent.
var invoiceCols = []struct {
	title string
	width float64
	align string
}{
	{"#", 10, "C"},
	{"Description", 92, "L"},
	{"Qty", 16, "R"},
	{"Rate", 30, "R"},
	{"Amount", 38, "R"},
}

// RenderInvoicePDF renders a tax invoice as an A4 PDF, reusing the layout
// primitives the quotation document is built from so the two look like
// they came from the same business.
func RenderInvoicePDF(inv Invoice) ([]byte, error) {
	f := fpdf.New("P", "mm", "A4", "")
	f.SetMargins(pdfMargin, pdfMargin, pdfMargin)
	f.SetAutoPageBreak(false, pdfMargin)
	f.SetTitle("Tax Invoice "+inv.Number, true)
	f.SetAuthor(quotationIssuer, true)
	f.SetCreator(quotationBrand, true)
	f.SetDrawColor(0, 0, 0)
	f.SetTextColor(0, 0, 0)
	f.SetLineWidth(0.25)

	p := &quotationPDF{Fpdf: f, tr: f.UnicodeTranslatorFromDescriptor("")}
	f.RegisterImageOptionsReader("logo", fpdf.ImageOptions{ImageType: "PNG"}, bytes.NewReader(nurseryLogoPNG))

	x0 := pdfMargin
	p.AddPage()

	p.font("B", 18)
	p.SetXY(x0, pdfMargin)
	p.CellFormat(pdfContent, 9, "Tax Invoice", "", 1, "C", false, 0, "")

	// Header: logo and issuer contact on the left, invoice identity right.
	y := p.GetY() + 2
	logoW := pdfLeftW - 2*pdfPad
	logoH := logoW * nurseryLogoH / nurseryLogoW
	headH := pdfPad + logoH + 2 + pdfLineH + 1

	p.Rect(x0, y, pdfLeftW, headH, "D")
	p.ImageOptions("logo", x0+pdfPad, y+pdfPad, logoW, logoH, false, fpdf.ImageOptions{ImageType: "PNG"}, 0, "")
	ty := y + pdfPad + logoH + 1
	p.Line(x0, ty, x0+pdfLeftW, ty)
	contact := fmt.Sprintf("%s  |  Ph: %s  |  %s", quotationIssuerPlace, quotationIssuerPhone, supportEmail)
	size := 8.5
	p.font("", size)
	for size > 6 && p.GetStringWidth(contact) > pdfLeftW-2*pdfPad {
		size -= 0.25
		p.font("", size)
	}
	p.text(x0, ty+0.5, pdfLeftW, pdfLineH, contact, "C")

	// Invoice identity block.
	rx := x0 + pdfLeftW
	p.Rect(rx, y, pdfRightW, headH, "D")
	rows := [][2]string{
		{"Invoice No.", inv.Number},
		{"Date", inv.Date.Format("02 Jan 2006")},
		{"Order ID", fmt.Sprintf("#%d", inv.OrderID)},
	}
	rowH := headH / float64(len(rows))
	for i, row := range rows {
		ry := y + float64(i)*rowH
		if i > 0 {
			p.Line(rx, ry, rx+pdfRightW, ry)
		}
		p.font("B", 8.5)
		p.text(rx, ry+1, pdfRightW*0.45, pdfLineH, row[0], "L")
		p.font("", 8.5)
		p.text(rx+pdfRightW*0.45, ry+1, pdfRightW*0.55, pdfLineH, row[1], "R")
	}
	p.SetY(y + headH + 3)

	// Billed-to block.
	y = p.GetY()
	billLines := []string{inv.CustomerName}
	billLines = append(billLines, inv.AddressLines...)
	if inv.CustomerPhone != "" {
		billLines = append(billLines, "Ph: "+inv.CustomerPhone)
	}
	if inv.CustomerEmail != "" {
		billLines = append(billLines, inv.CustomerEmail)
	}
	billH := pdfPad*2 + pdfLineH*float64(len(billLines)+1)
	p.Rect(x0, y, pdfContent, billH, "D")
	p.font("B", 9)
	p.text(x0, y+pdfPad, pdfContent, pdfLineH, "Billed to", "L")
	p.font("", 9)
	for i, line := range billLines {
		p.text(x0, y+pdfPad+pdfLineH*float64(i+1), pdfContent, pdfLineH, line, "L")
	}
	p.SetY(y + billH + 3)

	// Line items table.
	y = p.GetY()
	p.font("B", 9)
	cx := x0
	for _, col := range invoiceCols {
		p.Rect(cx, y, col.width, pdfRowH, "D")
		p.text(cx, y+1.2, col.width, pdfLineH, col.title, "C")
		cx += col.width
	}
	y += pdfRowH
	p.SetY(y)

	p.font("", 9)
	for i, line := range inv.Lines {
		wrapped := p.lines(line.Description, invoiceCols[1].width)
		rowHeight := max(pdfRowH, pdfLineH*float64(len(wrapped))+2*pdfPad)

		if p.GetY()+rowHeight > pdfPageH-pdfMargin-40 {
			p.AddPage()
			p.SetY(pdfMargin)
		}
		y = p.GetY()

		values := []string{
			fmt.Sprintf("%d", i+1),
			"", // description drawn separately so it can wrap
			fmt.Sprintf("%d", line.Quantity),
			formatMoney(line.UnitPrice),
			formatMoney(line.LineTotal),
		}
		cx = x0
		for ci, col := range invoiceCols {
			p.Rect(cx, y, col.width, rowHeight, "D")
			if ci == 1 {
				for li, wl := range wrapped {
					p.text(cx, y+pdfPad+pdfLineH*float64(li), col.width, pdfLineH, wl, "L")
				}
			} else {
				p.text(cx, y+pdfPad, col.width, pdfLineH, values[ci], col.align)
			}
			cx += col.width
		}
		p.SetY(y + rowHeight)
	}

	// Totals block, right-aligned under the table.
	p.SetY(p.GetY() + 2)
	totalsX := x0 + pdfContent*0.52
	totalsW := pdfContent - (totalsX - x0)

	type totalRow struct {
		label string
		value string
		bold  bool
	}
	trs := []totalRow{
		{"Taxable value", formatMoney(inv.TaxableValue), false},
	}
	// Each GST rate on its own line, lowest first, as returns require.
	rates := make([]float64, 0, len(inv.TaxByRate))
	for rate := range inv.TaxByRate {
		rates = append(rates, rate)
	}
	sort.Float64s(rates)
	for _, rate := range rates {
		trs = append(trs, totalRow{
			label: fmt.Sprintf("GST @ %g%%", rate),
			value: formatMoney(inv.TaxByRate[rate]),
		})
	}
	if inv.TaxAmount == 0 {
		trs = append(trs, totalRow{label: "GST", value: "Nil"})
	}
	if inv.Discount > 0 {
		trs = append(trs, totalRow{label: "Discount", value: "-" + formatMoney(inv.Discount)})
	}
	if inv.DeliveryFee > 0 {
		trs = append(trs, totalRow{label: "Delivery", value: formatMoney(inv.DeliveryFee)})
	}
	trs = append(trs, totalRow{label: "Total paid", value: formatMoney(inv.Total), bold: true})
	if inv.Refunded > 0 {
		trs = append(trs, totalRow{label: "Refunded", value: "-" + formatMoney(inv.Refunded)})
	}

	y = p.GetY()
	for _, row := range trs {
		p.Rect(totalsX, y, totalsW, pdfRowH, "D")
		if row.bold {
			p.font("B", 9.5)
		} else {
			p.font("", 9)
		}
		p.text(totalsX, y+1.2, totalsW*0.55, pdfLineH, row.label, "L")
		p.text(totalsX+totalsW*0.55, y+1.2, totalsW*0.45, pdfLineH, row.value, "R")
		y += pdfRowH
	}
	p.SetY(y + 4)

	// Footer notes. The inclusive-pricing statement matters: without it a
	// reader cannot tell whether tax was added on top.
	p.font("", 8)
	notes := []string{
		"Prices are inclusive of GST. Tax shown above is the portion extracted from the inclusive price.",
		"Live plants are nil-rated under GST; pots, soil, tools and fertiliser are taxed at their applicable rates.",
	}
	if inv.PaymentRef != "" {
		notes = append(notes, "Payment reference: "+inv.PaymentRef)
	}
	notes = append(notes, "This is a computer-generated invoice and does not require a signature.")
	for _, note := range notes {
		for _, wl := range p.lines(note, pdfContent) {
			p.text(x0, p.GetY(), pdfContent, pdfLineH, wl, "L")
			p.SetY(p.GetY() + pdfLineH*0.9)
		}
	}

	var buf bytes.Buffer
	if err := f.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// formatMoney renders an amount for the PDF. The rupee glyph is avoided
// because the built-in PDF fonts have no codepoint for it; "Rs." renders
// reliably on every reader.
func formatMoney(v float64) string {
	return fmt.Sprintf("Rs. %.2f", v)
}
