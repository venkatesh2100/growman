package handlers

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/metrics"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// OrderItemRequest is one line item in a checkout/order-creation request.
// Price is what the client *believes* the line costs; it is echoed back in
// error messages but never trusted — see buildOrderItems.
type OrderItemRequest struct {
	ProductID     uint    `json:"productId"`
	ProductSizeID *uint   `json:"productSizeId,omitempty"`
	Quantity      int     `json:"quantity"`
	Price         float64 `json:"price"`
}

// RazorpayOrderResponse is Razorpay's order-creation API response.
type RazorpayOrderResponse struct {
	ID       string `json:"id"`
	Entity   string `json:"entity"`
	Amount   int    `json:"amount"`
	Currency string `json:"currency"`
	Status   string `json:"status"`
}

// buildOrderItems validates that every requested product — and product
// size, if given — exists (and that a size actually belongs to its claimed
// product), then returns the resulting OrderItem rows with name, image and
// **price** snapshotted from the database so the order stays meaningful
// even if the product is later edited or deleted.
//
// Line prices come from the products/product_sizes tables, never from the
// request: OrderItemRequest.Price is advisory client state, and trusting it
// would let a caller write arbitrary prices into order history even when
// the order total itself is independently repriced.
//
// On any invalid input it writes the HTTP error response itself and returns
// ok=false, matching the httpjson.Decode convention used throughout this
// package — callers should return immediately when ok is false.
func (h *Handler) buildOrderItems(w http.ResponseWriter, items []OrderItemRequest) (orderItems []models.OrderItem, ok bool) {
	if len(items) == 0 {
		httpjson.Error(w, http.StatusBadRequest, "cart is empty")
		return nil, false
	}

	productIDs := make([]uint, len(items))
	for i, item := range items {
		productIDs[i] = item.ProductID
	}

	var products []models.Product
	if err := h.DB.Select("id, name, image_key, price, gst_rate, hsn_code").Where("id IN ?", productIDs).Find(&products).Error; err != nil {
		log.Printf("[DB] fetch products for order: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to validate products")
		return nil, false
	}
	productByID := make(map[uint]models.Product, len(products))
	for _, p := range products {
		productByID[p.ID] = p
	}
	for _, item := range items {
		if _, exists := productByID[item.ProductID]; !exists {
			httpjson.Error(w, http.StatusBadRequest, fmt.Sprintf("product with ID %d not found", item.ProductID))
			return nil, false
		}
	}

	// sizeByID is only populated (and only consulted) for items that
	// actually requested a size; a size also overrides the product price.
	sizeByID := make(map[uint]models.ProductSize)
	var sizeIDs []uint
	for _, item := range items {
		if item.ProductSizeID != nil {
			sizeIDs = append(sizeIDs, *item.ProductSizeID)
		}
	}
	if len(sizeIDs) > 0 {
		var sizes []models.ProductSize
		if err := h.DB.Select("id, product_id, label, price").Where("id IN ? AND product_id IN ?", sizeIDs, productIDs).Find(&sizes).Error; err != nil {
			log.Printf("[DB] fetch product sizes for order: %v", err)
			httpjson.Error(w, http.StatusInternalServerError, "failed to validate product sizes")
			return nil, false
		}
		for _, s := range sizes {
			sizeByID[s.ID] = s
		}
		for _, item := range items {
			if item.ProductSizeID == nil {
				continue
			}
			size, found := sizeByID[*item.ProductSizeID]
			if !found || size.ProductID != item.ProductID {
				httpjson.Error(w, http.StatusBadRequest, fmt.Sprintf("product size with ID %d not found for product %d", *item.ProductSizeID, item.ProductID))
				return nil, false
			}
		}
	}

	orderItems = make([]models.OrderItem, len(items))
	for i, item := range items {
		product := productByID[item.ProductID]

		name := product.Name
		price := product.Price
		if item.ProductSizeID != nil {
			size := sizeByID[*item.ProductSizeID]
			price = size.Price
			if size.Label != "" {
				name = product.Name + " (" + size.Label + ")"
			}
		}

		orderItems[i] = models.OrderItem{
			ProductID:   item.ProductID,
			ProductSize: item.ProductSizeID,
			Quantity:    item.Quantity,
			Price:       price,
			Name:        name,
			ImageKey:    product.ImageKey,
		}
		h.ResolveOrderItemImageURL(&orderItems[i])
	}
	return orderItems, true
}

// createRazorpayOrder creates an order in Razorpay via HTTP Basic Auth
// (key ID : key secret). Amount is in paise (Razorpay's smallest unit).
func (h *Handler) createRazorpayOrder(amountPaise int, currency string) (*RazorpayOrderResponse, error) {
	if h.Cfg.RazorpayKeyID == "" || h.Cfg.RazorpayKeySecret == "" {
		return nil, fmt.Errorf("razorpay credentials not configured")
	}

	payload, err := json.Marshal(map[string]any{"amount": amountPaise, "currency": currency})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest(http.MethodPost, "https://api.razorpay.com/v1/orders", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	auth := base64.StdEncoding.EncodeToString([]byte(h.Cfg.RazorpayKeyID + ":" + h.Cfg.RazorpayKeySecret))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Basic "+auth)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		log.Printf("[RAZORPAY] error response: %s", body)
		return nil, fmt.Errorf("razorpay API error: %s", body)
	}

	var orderResp RazorpayOrderResponse
	if err := json.Unmarshal(body, &orderResp); err != nil {
		return nil, err
	}
	return &orderResp, nil
}

// VerifyPaymentRequest is the checkout-side payment verification payload.
type VerifyPaymentRequest struct {
	RazorpayOrderID   string `json:"razorpay_order_id"`
	RazorpayPaymentID string `json:"razorpay_payment_id"`
	RazorpaySignature string `json:"razorpay_signature"`
	// OrderID is our own order's primary key. Preferred over
	// RazorpayOrderID for the lookup, because the browser callback's
	// values are attacker-controlled: we sign against the
	// razorpay_order_id we stored at creation time, not the one posted.
	OrderID uint `json:"orderId"`
}

// VerifyPayment confirms a Razorpay checkout payment and marks the order
// paid. This is the client-driven counterpart to RazorpayWebhook
// (webhooks.go); both funnel through markOrderPaid/notifyOrderPaid so an
// order is only ever confirmed and notified once, however it gets there.
func (h *Handler) VerifyPayment(w http.ResponseWriter, r *http.Request) {
	var req VerifyPaymentRequest
	if !httpjson.Decode(w, r, &req) {
		return
	}
	if req.RazorpayPaymentID == "" {
		httpjson.Error(w, http.StatusBadRequest, "razorpay_payment_id is required")
		return
	}
	if req.OrderID == 0 && req.RazorpayOrderID == "" {
		httpjson.Error(w, http.StatusBadRequest, "orderId or razorpay_order_id is required")
		return
	}

	// Load the order first so the signature is checked against the
	// razorpay_order_id *we* persisted, never the one the browser posted.
	var order models.Order
	lookup := h.DB.WithContext(r.Context()).Preload("Items")
	if req.OrderID != 0 {
		lookup = lookup.Where("id = ?", req.OrderID)
	} else {
		lookup = lookup.Where("razorpay_order_id = ?", req.RazorpayOrderID)
	}
	if err := lookup.First(&order).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			httpjson.Error(w, http.StatusNotFound, "order not found")
			return
		}
		log.Printf("[PAYMENT] find order: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to find order")
		return
	}

	// A payment we cannot cryptographically attribute to this order is
	// rejected outright — not logged and fulfilled. Razorpay's guidance is
	// explicit that a failed signature means do not fulfil, do not retry.
	if !h.skipSignatureChecks() {
		if req.RazorpaySignature == "" {
			httpjson.Error(w, http.StatusBadRequest, "razorpay_signature is required")
			return
		}
		if !h.verifyRazorpaySignature(order.RazorpayOrderID, req.RazorpayPaymentID, req.RazorpaySignature) {
			log.Printf("[PAYMENT] signature verification FAILED for order %d (razorpay_order_id=%s)", order.ID, order.RazorpayOrderID)
			metrics.RecordPaymentSignatureFailure("verify")
			httpjson.Error(w, http.StatusBadRequest, "payment verification failed")
			return
		}
	}

	firstTimePaid, err := h.markOrderPaid(r.Context(), &order, req.RazorpayPaymentID)
	if err != nil {
		log.Printf("[PAYMENT] mark paid: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to update order")
		return
	}
	h.notifyOrderPaid(order, firstTimePaid)

	httpjson.JSON(w, http.StatusOK, map[string]any{
		"success":     true,
		"message":     "Payment verified successfully",
		"orderId":     order.ID,
		"publicToken": order.PublicToken,
	})
}

// skipSignatureChecks reports whether signature enforcement is disabled.
// Only an explicitly non-production AppEnv can do this — notably *not* a
// missing key secret, since a misconfigured production deployment must
// fail closed rather than silently stop verifying payments. config.Load
// refuses to start in production without the secret for the same reason.
func (h *Handler) skipSignatureChecks() bool {
	switch strings.ToLower(strings.TrimSpace(h.Cfg.AppEnv)) {
	case "development", "dev", "test":
		return true
	}
	return false
}

// markOrderPaid transitions an order to paid, records a Payment row,
// commits the stock reservation, and creates/links a "soft account" so a
// guest checkout still ends up with an account. Returns whether this call
// made the *first* paid transition — VerifyPayment and the webhook handler
// both call this, and only the first to arrive should trigger notifications.
//
// The paid transition is a conditional UPDATE rather than a read-then-save,
// so two concurrent callers cannot both observe "not yet paid" and both
// send a confirmation. Everything runs in one transaction: an order is
// never left marked paid without its payment row or its stock committed.
func (h *Handler) markOrderPaid(ctx context.Context, order *models.Order, paymentID string) (firstTimePaid bool, err error) {
	// Set when the order is paid but its stock could no longer be reserved;
	// handled after the transaction commits.
	var oversold error

	err = h.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Claim the transition. RowsAffected tells us whether this call is
		// the one that moved the order, which is what makes notification
		// dispatch exactly-once under concurrent webhook + verify calls.
		res := tx.Model(&models.Order{}).
			Where("id = ? AND payment_status <> ?", order.ID, "paid").
			Updates(map[string]any{
				"razorpay_payment_id": paymentID,
				"payment_status":      "paid",
				"status":              "paid", // legacy field, kept in sync
			})
		if res.Error != nil {
			return fmt.Errorf("update order: %w", res.Error)
		}
		firstTimePaid = res.RowsAffected == 1

		order.RazorpayPaymentID = paymentID
		order.PaymentStatus = "paid"
		order.Status = "paid"

		// Upsert rather than insert: a replayed payment must not trip the
		// unique index on razorpay_payment_id.
		payment := models.Payment{
			OrderID:           order.ID,
			RazorpayOrderID:   order.RazorpayOrderID,
			RazorpayPaymentID: paymentID,
			Amount:            order.Amount,
			Currency:          order.Currency,
			Status:            "captured",
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "razorpay_payment_id"}},
			DoUpdates: clause.AssignmentColumns([]string{"status", "amount", "currency", "updated_at"}),
		}).Create(&payment).Error; err != nil {
			return fmt.Errorf("record payment: %w", err)
		}

		// Only the first transition commits stock, so a replay cannot
		// double-decrement.
		if firstTimePaid {
			// A nested transaction (savepoint) so a failed re-reservation
			// rolls back its own partial deductions without discarding the
			// paid status established above.
			commitErr := tx.Transaction(func(inner *gorm.DB) error {
				return h.commitOrderInventory(inner, order)
			})
			if commitErr != nil {
				var soldOut errOutOfStock
				if !errors.As(commitErr, &soldOut) {
					return fmt.Errorf("commit inventory: %w", commitErr)
				}
				// The money has been taken. Refusing here would leave a real
				// payment with no order record, which is strictly worse than
				// an order we have to source stock for or refund by hand. So
				// the order stands and a human is told.
				oversold = soldOut
			}
			if err := h.assignInvoiceNumber(tx, order); err != nil {
				return fmt.Errorf("assign invoice: %w", err)
			}
		}
		return nil
	})
	if err != nil {
		return false, err
	}

	if oversold != nil {
		log.Printf("[PAYMENT] order %d paid but stock unavailable: %v", order.ID, oversold)
		metrics.RecordInventoryConflict()
		h.raiseOversellSupportRequest(*order, oversold)
	}

	// Account linking is deliberately outside the transaction: it is a
	// convenience, and a failure here must not roll back a real payment.
	if order.UserID == nil && order.CustomerEmail != "" {
		if user, err := h.CreateSoftAccount(order.CustomerEmail, order.CustomerPhone, order.CustomerName, order.ClientIP, order.UserAgent); err != nil {
			log.Printf("[PAYMENT] create soft account: %v", err) // non-fatal
		} else if user != nil {
			order.UserID = &user.ID
			if err := h.DB.WithContext(ctx).Model(order).Update("user_id", user.ID).Error; err != nil {
				log.Printf("[PAYMENT] link order to user: %v", err) // non-fatal
			}
		}
	}

	return firstTimePaid, nil
}

// notifyOrderPaid emails the customer's order confirmation and alerts the
// merchant, but only for an order's first transition to paid — guards
// against double-sending when both the webhook and the client-side verify
// call land for the same payment.
func (h *Handler) notifyOrderPaid(order models.Order, firstTimePaid bool) {
	if !firstTimePaid {
		return
	}
	if order.CustomerEmail != "" {
		go func() {
			items := make([]map[string]any, len(order.Items))
			for i, item := range order.Items {
				items[i] = map[string]any{
					"name":     item.Name,
					"quantity": float64(item.Quantity),
					"price":    item.Price * float64(item.Quantity),
				}
			}
			if err := h.emailService().SendOrderConfirmationEmail(order.CustomerEmail, order.CustomerName, order.ID, order.Amount, items); err != nil {
				log.Printf("[EMAIL] order confirmation: %v", err)
			}
			h.emailOrderInvoice(order)
		}()
	}
	h.notifyMerchantPaidOrder(order)
	h.notifyOrderEvent(context.Background(), order, "Payment received", "Your payment is confirmed.", "paid")
	if order.InvoiceNumber != "" {
		h.notifyOrderEvent(context.Background(), order, "Invoice ready", "Your invoice "+order.InvoiceNumber+" is ready to download.", "invoice")
	}
	if order.FulfillmentChannel == "store_pickup" {
		h.notifyOrderEvent(context.Background(), order, "Store pickup", "We will tell you when this order is ready to collect.", "pickup-pending")
	}
	h.grantFirstOrderReferral(order)
}

// emailOrderInvoice sends the GST invoice as a PDF attachment, separately
// from the confirmation email so a failure to render it cannot cost the
// customer their receipt. The invoice is a tax document the customer is
// entitled to, so it is sent automatically rather than only on request.
func (h *Handler) emailOrderInvoice(order models.Order) {
	if order.InvoiceNumber == "" {
		// No invoice number means this was not a first paid transition, or
		// allocation failed; either way there is nothing to send yet.
		return
	}
	pdf, err := h.buildInvoicePDF(order)
	if err != nil {
		log.Printf("[INVOICE] render for order %d: %v", order.ID, err)
		return
	}
	if err := h.emailService().SendInvoiceEmail(
		order.CustomerEmail, order.CustomerName, order.ID, order.InvoiceNumber, pdf,
	); err != nil {
		log.Printf("[EMAIL] invoice for order %d: %v", order.ID, err)
	}
}

// verifyRazorpaySignature verifies the Razorpay checkout payment signature,
// which is keyed by the API key secret over "order_id|payment_id".
func (h *Handler) verifyRazorpaySignature(orderID, paymentID, signature string) bool {
	return verifyRazorpayHMAC(h.Cfg.RazorpayKeySecret, orderID+"|"+paymentID, signature)
}

// verifyRazorpayHMAC checks an HMAC-SHA256 signature over message using the
// given secret. Shared primitive behind the checkout payment-verify
// signature and the webhook body signature — same algorithm, but
// deliberately different secrets and message content, so the secret is a
// parameter rather than read from config here.
//
// Razorpay sends the checkout signature hex-encoded and documents webhook
// signatures the same way; some SDKs emit base64. Both encodings are
// accepted, each compared in constant time.
func verifyRazorpayHMAC(secret, message, signature string) bool {
	if secret == "" || signature == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(message))
	sum := mac.Sum(nil)

	expectedHex := hex.EncodeToString(sum)
	if hmac.Equal([]byte(strings.ToLower(signature)), []byte(expectedHex)) {
		return true
	}
	expectedB64 := base64.StdEncoding.EncodeToString(sum)
	return hmac.Equal([]byte(signature), []byte(expectedB64))
}

// GetOrder retrieves a single order (Items preloaded; product details are
// already snapshotted onto each OrderItem, so no further joins are needed).
//
// Access is by one of two means, never by bare ID: an authenticated owner
// (or admin), or an opaque ?token= issued at order creation for the
// post-payment success page. Order IDs are sequential integers, so serving
// them by ID alone made the whole customer table enumerable.
func (h *Handler) GetOrder(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(r.URL.Query().Get("token"))
	idParam := strings.TrimSpace(r.URL.Query().Get("id"))

	query := h.DB.WithContext(r.Context()).Preload("Items")

	switch {
	case token != "":
		// Guest access. The token is unguessable, so it authorises on its
		// own — but it is scoped to exactly one order.
		if len(token) < 32 {
			httpjson.Error(w, http.StatusBadRequest, "invalid order token")
			return
		}
		query = query.Where("public_token = ?", token)

	case idParam != "":
		claims, ok := auth.FromContext(r.Context())
		if !ok {
			httpjson.Error(w, http.StatusUnauthorized, "sign in to view this order")
			return
		}
		query = query.Where("id = ?", idParam)
		// Admins may read any order; everyone else only their own.
		if !auth.IsAdminRole(claims.Role) {
			query = query.Where("user_id = ?", claims.UserID)
		}

	default:
		httpjson.Error(w, http.StatusBadRequest, "order token or ID is required")
		return
	}

	var order models.Order
	if err := query.First(&order).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			// Same response for "absent" and "not yours" so this cannot be
			// used to probe which order IDs exist.
			httpjson.Error(w, http.StatusNotFound, "order not found")
			return
		}
		log.Printf("[ORDER] fetch: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch order")
		return
	}
	for i := range order.Items {
		h.ResolveOrderItemImageURL(&order.Items[i])
	}

	httpjson.JSON(w, http.StatusOK, order)
}

// newOrderToken mints the opaque public handle for guest order lookup.
func newOrderToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}
