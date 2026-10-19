package handlers

import (
	"fmt"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/services"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"gorm.io/gorm"
)

// GST handling
//
// Catalogue prices are GST-inclusive — that is what Indian consumers
// expect to see, and changing it would make every displayed price wrong.
// Tax is therefore *extracted* from the line total rather than added to
// it: for an inclusive price P at rate r, the taxable value is
// P / (1 + r/100) and the tax is the remainder.
//
// Live plants are nil-rated under GST, but pots, soil, tools and
// fertiliser are not, so the rate is per-product (products.gst_rate) with
// DefaultGSTRate as the fallback for rows that predate the column.

// DefaultGSTRate applies when a product carries no explicit rate. Nursery
// stock is predominantly nil-rated, so zero is the safe default: it never
// silently overcharges a customer.
const DefaultGSTRate = 0.0

// invoiceSeriesPrefix namespaces invoice numbers by financial year, which
// is how GST returns are organised.
const invoiceSeriesPrefix = "GRW"

// taxBreakdown is the GST split for an order.
type taxBreakdown struct {
	TaxableValue float64 `json:"taxableValue"`
	TaxAmount    float64 `json:"taxAmount"`
	// ByRate maps a GST percentage to the tax collected at it. Returns
	// need this split, since each rate is reported separately.
	ByRate map[float64]float64 `json:"byRate"`
}

// computeOrderTax extracts GST from an order's GST-inclusive line totals.
func (h *Handler) computeOrderTax(db *gorm.DB, items []models.OrderItem) (taxBreakdown, error) {
	out := taxBreakdown{ByRate: map[float64]float64{}}
	if len(items) == 0 {
		return out, nil
	}

	productIDs := make([]uint, 0, len(items))
	for _, item := range items {
		productIDs = append(productIDs, item.ProductID)
	}

	var products []models.Product
	if err := db.Select("id, gst_rate").Where("id IN ?", productIDs).Find(&products).Error; err != nil {
		return out, err
	}
	rateByProduct := make(map[uint]float64, len(products))
	for _, p := range products {
		rateByProduct[p.ID] = p.GSTRate
	}

	for _, item := range items {
		rate, ok := rateByProduct[item.ProductID]
		if !ok {
			rate = DefaultGSTRate
		}
		lineTotal := item.Price * float64(item.Quantity)
		taxable := lineTotal
		var tax float64
		if rate > 0 {
			taxable = lineTotal / (1 + rate/100)
			tax = lineTotal - taxable
		}
		out.TaxableValue += taxable
		out.TaxAmount += tax
		if tax > 0 {
			out.ByRate[rate] += tax
		}
	}

	out.TaxableValue = round2(out.TaxableValue)
	out.TaxAmount = round2(out.TaxAmount)
	return out, nil
}

// assignInvoiceNumber allocates a stable, gap-free-per-year invoice number
// on an order's first paid transition. Called inside markOrderPaid's
// transaction, so the sequence cannot skip on a rolled-back payment.
//
// Numbers look like GRW/2026-27/000123. The financial year is derived from
// the invoice date (April-March, per Indian convention).
func (h *Handler) assignInvoiceNumber(tx *gorm.DB, order *models.Order) error {
	if order.InvoiceNumber != "" {
		return nil
	}

	now := time.Now()
	fy := financialYear(now)

	// Count existing invoices in this series to get the next ordinal. The
	// row lock on orders from the enclosing transaction serialises
	// concurrent allocations.
	var used int64
	if err := tx.Model(&models.Order{}).
		Where("invoice_number LIKE ?", fmt.Sprintf("%s/%s/%%", invoiceSeriesPrefix, fy)).
		Count(&used).Error; err != nil {
		return err
	}

	number := fmt.Sprintf("%s/%s/%06d", invoiceSeriesPrefix, fy, used+1)

	// Compute the tax split at the same time, so an invoice always has one.
	items := order.Items
	if len(items) == 0 {
		if err := tx.Where("order_id = ?", order.ID).Find(&items).Error; err != nil {
			return err
		}
	}
	tax, err := h.computeOrderTax(tx, items)
	if err != nil {
		return err
	}

	updates := map[string]any{
		"invoice_number": number,
		"invoice_date":   &now,
		"taxable_value":  tax.TaxableValue,
		"tax_amount":     tax.TaxAmount,
	}
	if err := tx.Model(&models.Order{}).Where("id = ?", order.ID).UpdateColumns(updates).Error; err != nil {
		return err
	}

	order.InvoiceNumber = number
	order.InvoiceDate = &now
	order.TaxableValue = tax.TaxableValue
	order.TaxAmount = tax.TaxAmount
	return nil
}

// financialYear renders the Indian FY label for t (April-March).
func financialYear(t time.Time) string {
	year := t.Year()
	if t.Month() < time.April {
		year--
	}
	return fmt.Sprintf("%d-%02d", year, (year+1)%100)
}

// GetOrderInvoice returns the tax invoice PDF for an order. Access matches
// GetOrder: the authenticated owner, an admin, or a valid public token.
func (h *Handler) GetOrderInvoice(w http.ResponseWriter, r *http.Request) {
	idParam := chi.URLParam(r, "id")
	token := strings.TrimSpace(r.URL.Query().Get("token"))

	query := h.DB.WithContext(r.Context()).Preload("Items")
	if token != "" {
		if len(token) < 32 {
			httpjson.Error(w, http.StatusBadRequest, "invalid order token")
			return
		}
		query = query.Where("public_token = ?", token)
	} else {
		claims, ok := appauth.FromContext(r.Context())
		if !ok {
			httpjson.Error(w, http.StatusUnauthorized, "sign in to download this invoice")
			return
		}
		query = query.Where("id = ?", idParam)
		if !appauth.IsAdminRole(claims.Role) {
			query = query.Where("user_id = ?", claims.UserID)
		}
	}

	var order models.Order
	if err := query.First(&order).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "order not found")
		return
	}
	if order.PaymentStatus != "paid" && order.RefundedAmount == 0 {
		httpjson.Error(w, http.StatusConflict, "an invoice is only available once the order is paid")
		return
	}

	// Back-fill for orders paid before invoicing existed.
	if order.InvoiceNumber == "" {
		if err := h.DB.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
			return h.assignInvoiceNumber(tx, &order)
		}); err != nil {
			log.Printf("[INVOICE] backfill for order %d: %v", order.ID, err)
			httpjson.Error(w, http.StatusInternalServerError, "failed to prepare invoice")
			return
		}
	}

	pdf, err := h.buildInvoicePDF(order)
	if err != nil {
		log.Printf("[INVOICE] render order %d: %v", order.ID, err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to generate invoice")
		return
	}

	filename := strings.ReplaceAll(order.InvoiceNumber, "/", "-")
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename="invoice-%s.pdf"`, filename))
	w.Header().Set("Cache-Control", "private, max-age=0, no-store")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(pdf); err != nil {
		log.Printf("[INVOICE] write response: %v", err)
	}
}

// buildInvoicePDF renders a GST tax invoice, reusing the quotation PDF
// generator that already handles this document class.
func (h *Handler) buildInvoicePDF(order models.Order) ([]byte, error) {
	tax, err := h.computeOrderTax(h.DB, order.Items)
	if err != nil {
		return nil, err
	}

	lines := make([]services.InvoiceLine, 0, len(order.Items))
	for _, item := range order.Items {
		lines = append(lines, services.InvoiceLine{
			Description: item.Name,
			Quantity:    item.Quantity,
			UnitPrice:   item.Price,
			LineTotal:   round2(item.Price * float64(item.Quantity)),
		})
	}

	doc := services.Invoice{
		Number:        order.InvoiceNumber,
		Date:          derefTime(order.InvoiceDate),
		OrderID:       order.ID,
		CustomerName:  order.CustomerName,
		CustomerEmail: order.CustomerEmail,
		CustomerPhone: order.CustomerPhone,
		AddressLines:  addressLines(order),
		Lines:         lines,
		Subtotal:      round2(order.Subtotal),
		DeliveryFee:   round2(order.DeliveryFee),
		Discount:      round2(order.DiscountTotal),
		TaxableValue:  tax.TaxableValue,
		TaxAmount:     tax.TaxAmount,
		TaxByRate:     tax.ByRate,
		Total:         round2(order.Amount),
		Refunded:      round2(order.RefundedAmount),
		PaymentRef:    order.RazorpayPaymentID,
	}
	return services.RenderInvoicePDF(doc)
}

// EmailOrderInvoice sends an order's invoice to the customer. Admin-only;
// used for reissues and for orders predating automatic invoicing.
func (h *Handler) EmailOrderInvoice(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	if !appauth.IsAdminRole(claims.Role) {
		httpjson.Error(w, http.StatusForbidden, "admin access required")
		return
	}
	orderID, err := strconv.ParseUint(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid order ID")
		return
	}

	var order models.Order
	if err := h.DB.WithContext(r.Context()).Preload("Items").First(&order, orderID).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "order not found")
		return
	}
	if order.CustomerEmail == "" {
		httpjson.Error(w, http.StatusConflict, "order has no customer email")
		return
	}
	if order.InvoiceNumber == "" {
		if err := h.DB.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
			return h.assignInvoiceNumber(tx, &order)
		}); err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "failed to prepare invoice")
			return
		}
	}

	pdf, err := h.buildInvoicePDF(order)
	if err != nil {
		log.Printf("[INVOICE] render: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to generate invoice")
		return
	}
	if err := h.emailService().SendInvoiceEmail(order.CustomerEmail, order.CustomerName, order.ID, order.InvoiceNumber, pdf); err != nil {
		log.Printf("[INVOICE] email: %v", err)
		httpjson.Error(w, http.StatusBadGateway, "failed to send invoice email")
		return
	}

	httpjson.JSON(w, http.StatusOK, map[string]any{"success": true, "invoiceNumber": order.InvoiceNumber})
}

// ExportGSTReport returns the month's invoices as rows an accountant can
// reconcile against a GSTR filing.
func (h *Handler) ExportGSTReport(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	if !appauth.IsAdminRole(claims.Role) {
		httpjson.Error(w, http.StatusForbidden, "admin access required")
		return
	}

	month := strings.TrimSpace(r.URL.Query().Get("month")) // YYYY-MM
	if month == "" {
		month = time.Now().Format("2006-01")
	}
	start, err := time.Parse("2006-01", month)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "month must be formatted YYYY-MM")
		return
	}
	end := start.AddDate(0, 1, 0)

	type row struct {
		InvoiceNumber string    `json:"invoiceNumber"`
		InvoiceDate   time.Time `json:"invoiceDate"`
		OrderID       uint      `json:"orderId"`
		CustomerName  string    `json:"customerName"`
		State         string    `json:"state"`
		Pincode       string    `json:"pincode"`
		TaxableValue  float64   `json:"taxableValue"`
		TaxAmount     float64   `json:"taxAmount"`
		Total         float64   `json:"total"`
		Refunded      float64   `json:"refundedAmount"`
		PaymentStatus string    `json:"paymentStatus"`
	}
	var rows []row
	if err := h.DB.WithContext(r.Context()).Model(&models.Order{}).
		Select(`invoice_number, invoice_date, id AS order_id, customer_name, state, pincode,
		        taxable_value, tax_amount, amount AS total, refunded_amount, payment_status`).
		Where("invoice_number <> '' AND invoice_date >= ? AND invoice_date < ?", start, end).
		Order("invoice_number ASC").
		Scan(&rows).Error; err != nil {
		log.Printf("[INVOICE] GST export: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to build report")
		return
	}

	var totals struct {
		TaxableValue, TaxAmount, Total, Refunded float64
	}
	for _, rw := range rows {
		totals.TaxableValue += rw.TaxableValue
		totals.TaxAmount += rw.TaxAmount
		totals.Total += rw.Total
		totals.Refunded += rw.Refunded
	}

	httpjson.JSON(w, http.StatusOK, map[string]any{
		"month":    month,
		"invoices": rows,
		"count":    len(rows),
		"totals": map[string]float64{
			"taxableValue":   round2(totals.TaxableValue),
			"taxAmount":      round2(totals.TaxAmount),
			"total":          round2(totals.Total),
			"refundedAmount": round2(totals.Refunded),
		},
	})
}

func addressLines(order models.Order) []string {
	var lines []string
	if order.AddressLine != "" {
		lines = append(lines, order.AddressLine)
	}
	cityState := strings.TrimSpace(strings.Join(nonEmpty(order.City, order.State), ", "))
	if cityState != "" {
		lines = append(lines, cityState)
	}
	if order.Pincode != "" {
		lines = append(lines, order.Pincode)
	}
	if len(lines) == 0 && order.ShippingAddress != "" {
		lines = append(lines, order.ShippingAddress)
	}
	return lines
}

func nonEmpty(values ...string) []string {
	out := make([]string, 0, len(values))
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			out = append(out, strings.TrimSpace(v))
		}
	}
	return out
}

func derefTime(t *time.Time) time.Time {
	if t == nil {
		return time.Now()
	}
	return *t
}

// round2 rounds to paise, keeping money arithmetic from accumulating
// float drift across lines.
//
// math.Round, not int64(v*100+0.5): the latter truncates toward zero and
// so rounds negatives the wrong way, which would understate credit notes
// and refund adjustments.
func round2(v float64) float64 {
	return math.Round(v*100) / 100
}
