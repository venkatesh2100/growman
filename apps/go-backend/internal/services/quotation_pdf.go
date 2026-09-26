package services

import (
	"bytes"
	_ "embed"
	"fmt"

	"github.com/go-pdf/fpdf"
)

//go:embed assets/nursery-logo.png
var nurseryLogoPNG []byte

// Logo pixel size, used to keep its aspect ratio on the page.
const nurseryLogoW, nurseryLogoH = 580.0, 68.0

const (
	pdfMargin  = 12.0
	pdfPageW   = 210.0
	pdfPageH   = 297.0
	pdfContent = pdfPageW - 2*pdfMargin
	pdfLeftW   = pdfContent * 0.58
	pdfRightW  = pdfContent - pdfLeftW
	pdfPad     = 2.0
	pdfLineH   = 4.6
	pdfRowH    = 7.0
)

// Item table column widths (mm); they add up to pdfContent.
var pdfCols = []struct {
	title string
	width float64
	align string
}{
	{"#", 10, "C"},
	{"Item Code", 27, "C"},
	{"Item name", 57, "L"},
	{"Size", 20, "C"},
	{"Qty.", 16, "R"},
	{"Unit Rate", 28, "R"},
	{"Amount", 28, "R"},
}

type quotationPDF struct {
	*fpdf.Fpdf
	tr func(string) string
}

func (p *quotationPDF) font(style string, size float64) {
	p.SetFont("Helvetica", style, size)
}

// text writes a single line inside the box starting at (x, y) of width w.
func (p *quotationPDF) text(x, y, w, h float64, s, align string) {
	p.SetXY(x+pdfPad, y)
	p.CellFormat(w-2*pdfPad, h, p.tr(s), "", 0, align, false, 0, "")
}

// lines wraps s to the inner width of a w-wide box.
func (p *quotationPDF) lines(s string, w float64) []string {
	if s == "" {
		return []string{""}
	}
	out := []string{}
	for _, b := range p.SplitLines([]byte(p.tr(s)), w-2*pdfPad) {
		out = append(out, string(b))
	}
	return out
}

func (p *quotationPDF) ensureSpace(h float64) bool {
	if p.GetY()+h <= pdfPageH-pdfMargin {
		return false
	}
	p.AddPage()
	p.SetY(pdfMargin)
	return true
}

// QuotationPDF renders the quotation in the nursery's printed format as an
// A4 PDF, matching QuotationHTML and the web quotation view.
func QuotationPDF(q Quotation) ([]byte, error) {
	f := fpdf.New("P", "mm", "A4", "")
	f.SetMargins(pdfMargin, pdfMargin, pdfMargin)
	f.SetAutoPageBreak(false, pdfMargin)
	f.SetTitle("Quotation "+q.EstimateNo, true)
	f.SetAuthor(quotationIssuer, true)
	f.SetCreator(quotationBrand, true)
	f.SetDrawColor(0, 0, 0)
	f.SetTextColor(0, 0, 0)
	f.SetLineWidth(0.25)
	p := &quotationPDF{Fpdf: f, tr: f.UnicodeTranslatorFromDescriptor("")}
	f.RegisterImageOptionsReader("logo", fpdf.ImageOptions{ImageType: "PNG"}, bytes.NewReader(nurseryLogoPNG))

	r := q.Requester
	x0 := pdfMargin
	p.AddPage()

	p.font("B", 18)
	p.SetXY(x0, pdfMargin)
	p.CellFormat(pdfContent, 9, "Quotation", "", 1, "C", false, 0, "")

	// Header: logo + issuer contact on the left, estimate details on the right.
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

	rx := x0 + pdfLeftW
	labelW := pdfRightW * 0.45
	meta := [][2]string{{"Estimate No.", q.EstimateNo}, {"Date", q.Date}, {"Place of supply", orDash(q.PlaceOfSupply)}}
	rowH := headH / float64(len(meta))
	for i, m := range meta {
		ry := y + float64(i)*rowH
		p.Rect(rx, ry, labelW, rowH, "D")
		p.Rect(rx+labelW, ry, pdfRightW-labelW, rowH, "D")
		p.font("", 9)
		p.text(rx, ry, labelW, rowH, m[0], "L")
		p.font("B", 9)
		vl := p.lines(m[1], pdfRightW-labelW)
		value := vl[0]
		if len(vl) > 1 {
			value += "..."
		}
		p.SetXY(rx+labelW+pdfPad, ry)
		p.CellFormat(pdfRightW-labelW-2*pdfPad, rowH, value, "", 0, "L", false, 0, "")
	}

	// To: block, one detail per line.
	p.SetY(y + headH + 4)
	p.font("B", 9.5)
	p.text(x0-pdfPad, p.GetY(), pdfContent, pdfLineH, "To:", "L")
	p.font("", 9.5)
	toLines := p.lines(r.Name, pdfContent)
	if r.Company != "" {
		toLines = append(toLines, p.lines(r.Company, pdfContent)...)
	}
	toLines = append(toLines, p.tr("Ph: "+r.Phone))
	if r.Address != "" {
		toLines = append(toLines, p.lines(r.Address, pdfContent*0.7)...)
	}
	if r.GSTIN != "" {
		toLines = append(toLines, p.tr("GSTIN: "+r.GSTIN))
	}
	ly := p.GetY() + pdfLineH
	for _, l := range toLines {
		p.SetXY(x0, ly)
		p.CellFormat(pdfContent, pdfLineH, l, "", 0, "L", false, 0, "")
		ly += pdfLineH
	}

	p.font("B", 9.5)
	p.SetXY(x0, ly+2)
	p.CellFormat(pdfContent, pdfLineH, "Submitting quotation for supplying plants.", "", 1, "L", false, 0, "")
	p.font("", 9.5)
	p.SetX(x0)
	p.CellFormat(pdfContent, pdfLineH, "Dear Sir,", "", 1, "L", false, 0, "")
	p.SetY(p.GetY() + 2)

	// Item table.
	header := func() {
		hx, hy := x0, p.GetY()
		p.font("B", 9)
		for _, c := range pdfCols {
			p.Rect(hx, hy, c.width, pdfRowH, "D")
			p.text(hx, hy, c.width, pdfRowH, c.title, "C")
			hx += c.width
		}
		p.SetY(hy + pdfRowH)
	}
	header()
	for _, l := range q.Lines {
		name := l.Name
		if l.Requested {
			name += " (requested)"
		}
		values := []string{
			fmt.Sprint(l.No), orDash(l.ItemCode), name, orDash(l.Size),
			FormatQuantity(l.Quantity), quotationRate(l.Rate), quotationAmount(l),
		}
		p.font("", 9)
		wrapped := make([][]string, len(values))
		n := 1
		for i, v := range values {
			wrapped[i] = p.lines(v, pdfCols[i].width)
			n = max(n, len(wrapped[i]))
		}
		h := max(pdfRowH, float64(n)*pdfLineH+2)
		if p.ensureSpace(h) {
			header()
			p.font("", 9)
		}
		cx, cy := x0, p.GetY()
		for i, c := range pdfCols {
			p.Rect(cx, cy, c.width, h, "D")
			top := cy + (h-float64(len(wrapped[i]))*pdfLineH)/2
			for j, line := range wrapped[i] {
				p.SetXY(cx+pdfPad, top+float64(j)*pdfLineH)
				p.CellFormat(c.width-2*pdfPad, pdfLineH, line, "", 0, c.align, false, 0, "")
			}
			cx += c.width
		}
		p.SetY(cy + h)
	}

	// Amount in words + description beside the totals.
	p.font("B", 9.5)
	words := p.lines(q.AmountInWords, pdfLeftW)
	p.font("", 9.5)
	leftH := pdfPad + float64(2+len(words)+len(q.Description))*pdfLineH + 2 + pdfPad
	totals := [][2]string{{"Total Cost of Goods", FormatRupees(q.GoodsTotal)}}
	for _, c := range q.Charges {
		totals = append(totals, [2]string{c.Label, chargeValue(c)})
	}
	totals = append(totals, [2]string{"Total", FormatRupees(q.Total)})
	rightH := float64(len(totals)) * pdfRowH
	boxH := max(leftH, rightH)
	termsH := pdfPad + float64(2+len(q.Terms))*pdfLineH + pdfPad
	signH := max(termsH, 30)

	p.SetY(p.GetY() + 4)
	p.ensureSpace(boxH + 4 + signH)
	y = p.GetY()
	p.Rect(x0, y, pdfLeftW, boxH, "D")
	ty = y + pdfPad
	p.font("", 9.5)
	p.text(x0, ty, pdfLeftW, pdfLineH, "Estimate Amount in Words", "L")
	ty += pdfLineH
	p.font("B", 9.5)
	for _, w := range words {
		p.SetXY(x0+pdfPad, ty)
		p.CellFormat(pdfLeftW-2*pdfPad, pdfLineH, w, "", 0, "L", false, 0, "")
		ty += pdfLineH
	}
	ty += 2
	p.font("", 9.5)
	p.text(x0, ty, pdfLeftW, pdfLineH, "Description", "L")
	for i, d := range q.Description {
		ty += pdfLineH
		p.text(x0, ty, pdfLeftW, pdfLineH, fmt.Sprintf("%d. %s", i+1, d), "L")
	}

	rowH = boxH / float64(len(totals))
	labelW = pdfRightW * 0.6
	for i, t := range totals {
		ry := y + float64(i)*rowH
		style := ""
		if i == len(totals)-1 {
			style = "B"
		}
		p.font(style, 9)
		p.Rect(rx, ry, labelW, rowH, "D")
		p.Rect(rx+labelW, ry, pdfRightW-labelW, rowH, "D")
		p.text(rx, ry, labelW, rowH, t[0], "L")
		p.text(rx+labelW, ry, pdfRightW-labelW, rowH, t[1], "R")
	}

	// Terms beside the signature block.
	y += boxH + 4
	p.Rect(x0, y, pdfLeftW, signH, "D")
	p.Rect(rx, y, pdfRightW, signH, "D")
	ty = y + pdfPad
	p.font("B", 9.5)
	p.text(x0, ty, pdfLeftW, pdfLineH, "Terms and conditions", "L")
	p.font("", 9.5)
	ty += pdfLineH
	p.text(x0, ty, pdfLeftW, pdfLineH, "Thanks for doing business with us!", "L")
	for i, t := range q.Terms {
		ty += pdfLineH
		p.text(x0, ty, pdfLeftW, pdfLineH, fmt.Sprintf("%d. %s", i+1, t), "L")
	}
	p.font("B", 9.5)
	p.text(rx, y+pdfPad, pdfRightW, pdfLineH, "For "+quotationIssuer, "C")
	p.text(rx, y+signH-pdfPad-2*pdfLineH, pdfRightW, pdfLineH, "Authorized Signatory", "C")
	p.font("", 9.5)
	p.text(rx, y+signH-pdfPad-pdfLineH, pdfRightW, pdfLineH, "(Managing Partner)", "C")

	var buf bytes.Buffer
	if err := f.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
