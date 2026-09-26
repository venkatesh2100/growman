package services

import (
	"fmt"
	"html"
	"log"
	"math"
	"net/url"
	"strings"
	"time"
)

const (
	quotationIssuer      = "Sri Shirdi Sai Nursery"
	quotationBrand       = "Growman"
	quotationIssuerPlace = "Hyderabad, Telangana"
	quotationIssuerPhone = "+91 95535 70568, +91 99089 35044"
	quotationLogoURL     = siteURL + "/quotation/nursery-logo.png"
)

// QuotationTerms are printed under every quotation, in the nursery's
// standard wording.
var QuotationTerms = []string{
	"Payment 100% Before Dispatch.",
	"Transport & loading/unloading charges as quoted above.",
	"Goods once sold cannot be taken back.",
}

// QuotationDescription is the "Description" block beside the totals.
var QuotationDescription = []string{
	"100% Payment Before Dispatch",
}

type QuotationLine struct {
	No       int     `json:"no"`
	ItemCode string  `json:"itemCode"`
	Name     string  `json:"name"`
	Size     string  `json:"size"`
	Quantity int     `json:"quantity"`
	Unit     string  `json:"unit"`
	Rate     float64 `json:"rate"`
	Amount   float64 `json:"amount"`
	// Requested marks a plant the buyer typed in that is not in the catalog.
	Requested bool `json:"requested"`
}

// QuotationCharge is an extra line under "Total Cost of Goods" (freight,
// loading, labour). Amount is nil while the store still has to price it.
type QuotationCharge struct {
	Label     string   `json:"label"`
	Requested bool     `json:"requested"`
	Amount    *float64 `json:"amount"`
}

type QuotationRequester struct {
	Name       string `json:"name"`
	Company    string `json:"company"`
	Phone      string `json:"phone"`
	Email      string `json:"email"`
	GSTIN      string `json:"gstin"`
	Address    string `json:"address"`
	City       string `json:"city"`
	State      string `json:"state"`
	Pincode    string `json:"pincode"`
	RequiredBy string `json:"requiredBy"`
	Notes      string `json:"notes"`
}

type Quotation struct {
	EstimateNo    string             `json:"estimateNo"`
	Date          string             `json:"date"`
	PlaceOfSupply string             `json:"placeOfSupply"`
	Requester     QuotationRequester `json:"requester"`
	Lines         []QuotationLine    `json:"lines"`
	TotalUnits    int                `json:"totalUnits"`
	GoodsTotal    float64            `json:"goodsTotal"`
	Charges       []QuotationCharge  `json:"charges"`
	Total         float64            `json:"total"`
	AmountInWords string             `json:"amountInWords"`
	Description   []string           `json:"description"`
	Terms         []string           `json:"terms"`
	Issuer        string             `json:"issuer"`
	IssuerAddress string             `json:"issuerAddress"`
	IssuerPhone   string             `json:"issuerPhone"`
}

// QuotationDetail is one label/value row in the store-only enquiry details.
type QuotationDetail struct {
	Label string
	Value string
}

// QuotationDetailSection groups enquiry details (account, network, device…).
type QuotationDetailSection struct {
	Title   string
	Details []QuotationDetail
}

// QuotationMeta is request context shown only to the store, never to the buyer.
type QuotationMeta struct {
	UserID    string
	IP        string
	UserAgent string
	Submitted time.Time
	Sections  []QuotationDetailSection
}

// AddSection appends a section, dropping empty rows and empty sections.
func (m *QuotationMeta) AddSection(title string, details ...QuotationDetail) {
	kept := details[:0]
	for _, d := range details {
		if d.Value = strings.TrimSpace(d.Value); d.Value != "" {
			kept = append(kept, d)
		}
	}
	if len(kept) > 0 {
		m.Sections = append(m.Sections, QuotationDetailSection{Title: title, Details: kept})
	}
}

// QuotationPDFFilename is the attachment name for a quotation.
func QuotationPDFFilename(q Quotation) string {
	return "Quotation-" + q.EstimateNo + ".pdf"
}

// QuotationItemCode is the stable code printed for a product size. The web
// bulk page derives the same code client-side, so both must stay in sync.
func QuotationItemCode(productID, sizeID uint) string {
	return fmt.Sprintf("GM%04d%04d", productID, sizeID)
}

// Finalize fills the derived totals, charges total and amount in words.
func (q *Quotation) Finalize() {
	q.GoodsTotal = 0
	q.TotalUnits = 0
	for i := range q.Lines {
		q.Lines[i].No = i + 1
		q.Lines[i].Amount = roundMoney(q.Lines[i].Rate * float64(q.Lines[i].Quantity))
		q.GoodsTotal += q.Lines[i].Amount
		q.TotalUnits += q.Lines[i].Quantity
	}
	q.GoodsTotal = roundMoney(q.GoodsTotal)
	q.Total = q.GoodsTotal
	for _, c := range q.Charges {
		if c.Amount != nil {
			q.Total += *c.Amount
		}
	}
	q.Total = roundMoney(q.Total)
	q.AmountInWords = RupeesInWords(q.Total)
	q.Description = QuotationDescription
	q.Terms = QuotationTerms
	q.Issuer = quotationIssuer
	q.IssuerAddress = quotationIssuerPlace
	q.IssuerPhone = quotationIssuerPhone
}

// PendingCharges reports whether any requested service still needs pricing.
func (q *Quotation) PendingCharges() bool {
	for _, c := range q.Charges {
		if c.Requested && c.Amount == nil {
			return true
		}
	}
	return false
}

func roundMoney(v float64) float64 {
	return math.Round(v*100) / 100
}

func groupThousands(n int64) string {
	neg := n < 0
	if neg {
		n = -n
	}
	s := fmt.Sprintf("%d", n)
	var b strings.Builder
	for i, r := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(r)
	}
	if neg {
		return "-" + b.String()
	}
	return b.String()
}

// FormatQuantity renders a quantity the way the quotation prints it ("1,306").
func FormatQuantity(n int) string {
	return groupThousands(int64(n))
}

// FormatRupees renders an amount as "Rs. 8,890", adding paise only when present.
func FormatRupees(v float64) string {
	v = roundMoney(v)
	whole := int64(v)
	paise := int64(math.Round((v - float64(whole)) * 100))
	if paise == 0 {
		return "Rs. " + groupThousands(whole)
	}
	return fmt.Sprintf("Rs. %s.%02d", groupThousands(whole), paise)
}

var (
	wordOnes = []string{"", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
		"Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"}
	wordTens = []string{"", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"}
)

func wordsBelow100(n int64) string {
	if n < 20 {
		return wordOnes[n]
	}
	if n%10 == 0 {
		return wordTens[n/10]
	}
	return wordTens[n/10] + " " + wordOnes[n%10]
}

// numberInWords spells n in the Indian system (Crore, Lakh, Thousand).
func numberInWords(n int64) string {
	if n == 0 {
		return "Zero"
	}
	var parts []string
	if crore := n / 10000000; crore > 0 {
		parts = append(parts, numberInWords(crore)+" Crore")
		n %= 10000000
	}
	if lakh := n / 100000; lakh > 0 {
		parts = append(parts, wordsBelow100(lakh)+" Lakh")
		n %= 100000
	}
	if thousand := n / 1000; thousand > 0 {
		parts = append(parts, wordsBelow100(thousand)+" Thousand")
		n %= 1000
	}
	if hundred := n / 100; hundred > 0 {
		parts = append(parts, wordOnes[hundred]+" Hundred")
		n %= 100
	}
	if n > 0 {
		if len(parts) > 0 {
			parts = append(parts, "and")
		}
		parts = append(parts, wordsBelow100(n))
	}
	return strings.Join(parts, " ")
}

// RupeesInWords renders an amount as "Eight Lakh Three Hundred and Seventy Rupees only".
func RupeesInWords(v float64) string {
	v = roundMoney(v)
	whole := int64(v)
	paise := int64(math.Round((v - float64(whole)) * 100))
	out := numberInWords(whole) + " Rupees"
	if paise > 0 {
		out += " and " + wordsBelow100(paise) + " Paise"
	}
	return out + " only"
}

func quotationRate(v float64) string {
	if v <= 0 {
		return "On request"
	}
	return FormatRupees(v)
}

func quotationAmount(l QuotationLine) string {
	if l.Rate <= 0 {
		return "-"
	}
	return FormatRupees(l.Amount)
}

func chargeValue(c QuotationCharge) string {
	switch {
	case c.Amount != nil:
		return FormatRupees(*c.Amount)
	case c.Requested:
		return "To be quoted"
	default:
		return "Not required"
	}
}

func orDash(s string) string {
	if strings.TrimSpace(s) == "" {
		return "-"
	}
	return s
}

// QuotationText renders the plain-text alternative of the quotation email.
func QuotationText(q Quotation, meta QuotationMeta) string {
	r := q.Requester
	var b strings.Builder
	fmt.Fprintf(&b, "NEW QUOTATION ENQUIRY — %s\n\n", q.EstimateNo)
	fmt.Fprintf(&b, "Name: %s\nPhone: %s\nAddress: %s\n", r.Name, r.Phone, orDash(r.Address))
	if r.Email != "" {
		fmt.Fprintf(&b, "Email: %s\n", r.Email)
	}
	if r.Notes != "" {
		fmt.Fprintf(&b, "Notes: %s\n", r.Notes)
	}

	fmt.Fprintf(&b, "\nQuotation\n%s, %s · %s\n", q.Issuer, q.IssuerAddress, q.IssuerPhone)
	fmt.Fprintf(&b, "Estimate No. %s\nDate %s\nPlace of supply %s\n\n", q.EstimateNo, q.Date, orDash(q.PlaceOfSupply))
	fmt.Fprintf(&b, "To:\n%s\nPh: %s\n", r.Name, r.Phone)
	if r.Address != "" {
		fmt.Fprintf(&b, "%s\n", r.Address)
	}
	b.WriteString("\nSubmitting quotation for supplying plants.\nDear Sir,\n\n")
	b.WriteString("# | Item Code | Item name | Size | Qty. | Unit Rate | Amount\n")
	for _, l := range q.Lines {
		name := l.Name
		if l.Requested {
			name += " (requested)"
		}
		fmt.Fprintf(&b, "%d | %s | %s | %s | %s | %s | %s\n",
			l.No, orDash(l.ItemCode), name, orDash(l.Size), FormatQuantity(l.Quantity), quotationRate(l.Rate), quotationAmount(l))
	}
	fmt.Fprintf(&b, "\nEstimate Amount in Words\n%s\n\nDescription\n", q.AmountInWords)
	for i, d := range q.Description {
		fmt.Fprintf(&b, "%d. %s\n", i+1, d)
	}
	fmt.Fprintf(&b, "\nTotal Cost of Goods %s\n", FormatRupees(q.GoodsTotal))
	for _, c := range q.Charges {
		fmt.Fprintf(&b, "%s %s\n", c.Label, chargeValue(c))
	}
	fmt.Fprintf(&b, "Total %s\n", FormatRupees(q.Total))
	b.WriteString("\nTerms and conditions\nThanks for doing business with us!\n")
	for i, t := range q.Terms {
		fmt.Fprintf(&b, "%d. %s\n", i+1, t)
	}
	fmt.Fprintf(&b, "\nFor %s\nAuthorized Signatory\n(Managing Partner)\n\n", q.Issuer)
	fmt.Fprintf(&b, "Submitted: %s\nUser ID: %s\nIP: %s\nUser-Agent: %s\n",
		meta.Submitted.Format(time.RFC1123), orDash(meta.UserID), orDash(meta.IP), orDash(meta.UserAgent))
	for _, s := range meta.Sections {
		fmt.Fprintf(&b, "\n%s\n", strings.ToUpper(s.Title))
		for _, d := range s.Details {
			fmt.Fprintf(&b, "%s: %s\n", d.Label, d.Value)
		}
	}
	return b.String()
}

// Styles mirror the nursery's printed quotation: black 1px rules, Arial,
// bold header row on white.
const (
	qFont   = "font-family:Arial,Helvetica,sans-serif;color:#000000;"
	qBox    = "border:1px solid #000000;border-collapse:collapse;"
	qTh     = "border:1px solid #000000;padding:6px 6px;font-size:12px;font-weight:bold;text-align:center;"
	qTd     = "border:1px solid #000000;padding:5px 6px;font-size:12px;"
	qSmall  = "font-size:12px;line-height:1.5;"
	qLabelS = "padding:3px 0;font-size:12px;color:#555555;width:90px;vertical-align:top;"
	qValueS = "padding:3px 0;font-size:13px;color:#000000;"
)

func esc(s string) string { return html.EscapeString(orDash(s)) }

// QuotationHTML renders the quotation email: a short enquiry summary for the
// store, followed by the quotation in the nursery's printed format.
func QuotationHTML(q Quotation, meta QuotationMeta) string {
	r := q.Requester
	var b strings.Builder

	b.WriteString(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quotation</title></head>`)
	b.WriteString(`<body style="margin:0;padding:0;background:#f3f4f6;` + qFont + `">`)
	fmt.Fprintf(&b, `<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">Quotation enquiry %s from %s</span>`,
		html.EscapeString(q.EstimateNo), html.EscapeString(r.Name))
	b.WriteString(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:20px 10px;"><tr><td align="center">`)
	b.WriteString(`<table role="presentation" width="720" cellpadding="0" cellspacing="0" style="max-width:720px;width:100%;">`)

	// Enquiry summary for the store.
	b.WriteString(`<tr><td style="background:#ffffff;border:1px solid #d1d5db;padding:14px 16px;">`)
	fmt.Fprintf(&b, `<p style="margin:0 0 8px;font-size:15px;font-weight:bold;">New quotation enquiry · %s</p>`, html.EscapeString(q.EstimateNo))
	b.WriteString(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0">`)
	row := func(label, value string) {
		fmt.Fprintf(&b, `<tr><td style="%s">%s</td><td style="%s">%s</td></tr>`, qLabelS, label, qValueS, value)
	}
	row("Name", esc(r.Name))
	row("Phone", fmt.Sprintf(`<a href="tel:%s" style="color:#000000;">%s</a>`, html.EscapeString(r.Phone), html.EscapeString(r.Phone)))
	row("Address", esc(r.Address))
	if r.Email != "" {
		row("Email", html.EscapeString(r.Email))
	}
	if r.Notes != "" {
		row("Notes", strings.ReplaceAll(html.EscapeString(r.Notes), "\n", "<br>"))
	}
	row("Summary", fmt.Sprintf("%d items · %s units · %s", len(q.Lines), FormatQuantity(q.TotalUnits), FormatRupees(q.Total)))
	row("Submitted", html.EscapeString(fmt.Sprintf("%s · IP %s", meta.Submitted.Format("02-01-2006 15:04"), orDash(meta.IP))))
	b.WriteString(`</table>`)
	fmt.Fprintf(&b, `<p style="margin:10px 0 0;font-size:12px;"><a href="tel:+91%s" style="color:#000000;">Call</a> &nbsp;|&nbsp; <a href="https://wa.me/91%s" style="color:#000000;">WhatsApp</a>`,
		html.EscapeString(r.Phone), html.EscapeString(r.Phone))
	if r.Address != "" {
		fmt.Fprintf(&b, ` &nbsp;|&nbsp; <a href="https://www.google.com/maps/search/?api=1&amp;query=%s" style="color:#000000;">Open address in Maps</a>`,
			html.EscapeString(url.QueryEscape(r.Address)))
	}
	b.WriteString(` &nbsp;|&nbsp; PDF attached</p>`)
	b.WriteString(`</td></tr><tr><td style="height:14px;"></td></tr>`)

	if len(meta.Sections) > 0 {
		b.WriteString(`<tr><td style="background:#ffffff;border:1px solid #d1d5db;padding:14px 16px;">`)
		b.WriteString(`<p style="margin:0 0 6px;font-size:15px;font-weight:bold;">Enquiry details</p>`)
		for _, s := range meta.Sections {
			fmt.Fprintf(&b, `<p style="margin:10px 0 2px;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;color:#555555;">%s</p>`, html.EscapeString(s.Title))
			b.WriteString(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">`)
			for _, d := range s.Details {
				fmt.Fprintf(&b, `<tr><td style="border-bottom:1px solid #eeeeee;padding:4px 8px 4px 0;font-size:12px;color:#555555;width:140px;vertical-align:top;">%s</td><td style="border-bottom:1px solid #eeeeee;padding:4px 0;font-size:12px;color:#000000;word-break:break-word;">%s</td></tr>`,
					html.EscapeString(d.Label), html.EscapeString(d.Value))
			}
			b.WriteString(`</table>`)
		}
		b.WriteString(`</td></tr><tr><td style="height:14px;"></td></tr>`)
	}

	// Quotation document.
	b.WriteString(`<tr><td style="background:#ffffff;padding:24px 20px;">`)
	b.WriteString(`<p style="margin:0 0 10px;text-align:center;font-size:22px;font-weight:bold;">Quotation</p>`)

	fmt.Fprintf(&b, `<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="%s"><tr>`, qBox)
	fmt.Fprintf(&b, `<td style="border:1px solid #000000;padding:6px 8px;vertical-align:middle;width:58%%;"><img src="%s" alt="%s" width="560" style="display:block;width:100%%;height:auto;border:0;"><p style="margin:4px 0 0;padding-top:4px;border-top:1px solid #000000;font-size:10.5px;line-height:1.3;text-align:center;white-space:nowrap;">%s &nbsp;|&nbsp; Ph: %s &nbsp;|&nbsp; %s</p></td>`,
		quotationLogoURL, quotationIssuer, quotationIssuerPlace, quotationIssuerPhone, supportEmail)
	b.WriteString(`<td style="border:1px solid #000000;padding:0;vertical-align:top;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">`)
	meta3 := [][2]string{{"Estimate No.", q.EstimateNo}, {"Date", q.Date}, {"Place of supply", orDash(q.PlaceOfSupply)}}
	for _, m := range meta3 {
		fmt.Fprintf(&b, `<tr><td style="%s">%s</td><td style="%sfont-weight:bold;">%s</td></tr>`, qTd, m[0], qTd, html.EscapeString(m[1]))
	}
	b.WriteString(`</table></td></tr></table>`)

	fmt.Fprintf(&b, `<p style="margin:14px 0 2px;font-size:12px;line-height:1.5;"><strong>To:</strong><br>%s<br>Ph: %s%s</p>`,
		html.EscapeString(r.Name), html.EscapeString(r.Phone),
		func() string {
			if r.Address == "" {
				return ""
			}
			return "<br>" + html.EscapeString(r.Address)
		}())
	b.WriteString(`<p style="margin:8px 0 4px;font-size:12px;font-weight:bold;">Submitting quotation for supplying plants.</p>`)
	b.WriteString(`<p style="margin:0 0 10px;font-size:12px;">Dear Sir,</p>`)

	fmt.Fprintf(&b, `<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="%s">`, qBox)
	fmt.Fprintf(&b, `<tr><th style="%s">#</th><th style="%s">Item Code</th><th style="%s">Item name</th><th style="%s">Size</th><th style="%s">Qty.</th><th style="%s">Unit Rate</th><th style="%s">Amount</th></tr>`,
		qTh, qTh, qTh, qTh, qTh, qTh, qTh)
	for _, l := range q.Lines {
		name := html.EscapeString(l.Name)
		if l.Requested {
			name += ` <span style="font-size:10px;color:#555555;">(requested)</span>`
		}
		fmt.Fprintf(&b, `<tr><td style="%stext-align:center;">%d</td><td style="%stext-align:center;">%s</td><td style="%s">%s</td><td style="%stext-align:center;">%s</td><td style="%stext-align:right;">%s</td><td style="%stext-align:right;white-space:nowrap;">%s</td><td style="%stext-align:right;white-space:nowrap;">%s</td></tr>`,
			qTd, l.No, qTd, esc(l.ItemCode), qTd, name, qTd, esc(l.Size),
			qTd, FormatQuantity(l.Quantity), qTd, quotationRate(l.Rate), qTd, quotationAmount(l))
	}
	b.WriteString(`</table>`)

	fmt.Fprintf(&b, `<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="%smargin-top:12px;"><tr>`, qBox)
	fmt.Fprintf(&b, `<td style="border:1px solid #000000;padding:8px;vertical-align:top;%s"><p style="margin:0;">Estimate Amount in Words</p><p style="margin:2px 0 10px;font-weight:bold;">%s</p><p style="margin:0;">Description</p>`,
		qSmall, html.EscapeString(q.AmountInWords))
	for i, d := range q.Description {
		fmt.Fprintf(&b, `<p style="margin:0;">%d. %s</p>`, i+1, html.EscapeString(d))
	}
	b.WriteString(`</td><td style="border:1px solid #000000;padding:0;vertical-align:top;width:42%;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">`)
	total := func(label, value string, bold bool) {
		w := ""
		if bold {
			w = "font-weight:bold;"
		}
		fmt.Fprintf(&b, `<tr><td style="%s%s">%s</td><td style="%stext-align:right;white-space:nowrap;%s">%s</td></tr>`, qTd, w, label, qTd, w, value)
	}
	total("Total Cost of Goods", FormatRupees(q.GoodsTotal), false)
	for _, c := range q.Charges {
		total(html.EscapeString(c.Label), chargeValue(c), false)
	}
	total("Total", FormatRupees(q.Total), true)
	b.WriteString(`</table></td></tr></table>`)

	fmt.Fprintf(&b, `<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="%smargin-top:12px;"><tr>`, qBox)
	fmt.Fprintf(&b, `<td style="border:1px solid #000000;padding:8px;vertical-align:top;%s"><p style="margin:0 0 4px;font-weight:bold;">Terms and conditions</p><p style="margin:0;">Thanks for doing business with us!</p>`, qSmall)
	for i, t := range q.Terms {
		fmt.Fprintf(&b, `<p style="margin:0;">%d. %s</p>`, i+1, html.EscapeString(t))
	}
	fmt.Fprintf(&b, `</td><td style="border:1px solid #000000;padding:8px;vertical-align:top;width:42%%;%s"><p style="margin:0;text-align:center;font-weight:bold;">For %s</p><p style="margin:34px 0 0;text-align:center;font-weight:bold;">Authorized Signatory</p><p style="margin:0;text-align:center;">(Managing Partner)</p></td>`,
		qSmall, quotationIssuer)
	b.WriteString(`</tr></table>`)
	b.WriteString(`</td></tr>`)

	fmt.Fprintf(&b, `<tr><td style="padding:10px 4px;font-size:11px;color:#6b7280;">%s · %s. Call %s back on %s.</td></tr>`,
		quotationBrand, quotationIssuerPlace, html.EscapeString(r.Name), html.EscapeString(r.Phone))
	b.WriteString(`</table></td></tr></table></body></html>`)
	return b.String()
}

// SendQuotationEnquiry emails a quotation enquiry to the store inbox with
// Reply-To set to the requester so staff can answer from their mail client.
func (s *EmailService) SendQuotationEnquiry(to string, q Quotation, meta QuotationMeta) error {
	subject := fmt.Sprintf("Quotation enquiry %s — %s (%d items, %s)", q.EstimateNo, q.Requester.Name, len(q.Lines), FormatRupees(q.Total))
	var attachments []Attachment
	if pdf, err := QuotationPDF(q); err != nil {
		log.Printf("[QUOTATION] pdf render failed for %s: %v", q.EstimateNo, err)
	} else {
		attachments = append(attachments, Attachment{Filename: QuotationPDFFilename(q), ContentType: "application/pdf", Data: pdf})
	}
	return s.sendWithReplyTo(to, q.Requester.Email, subject, QuotationText(q, meta), QuotationHTML(q, meta), attachments...)
}
