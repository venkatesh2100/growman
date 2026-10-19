package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/metrics"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/middlewares"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/services"
)

func (h *Handler) merchantEmail() string {
	return strings.TrimSpace(h.Cfg.MerchantNotifyEmail)
}

func (h *Handler) emailService() *services.EmailService {
	return services.NewEmailService(h.Cfg.SMTPHost, h.Cfg.SMTPPort, h.Cfg.SMTPEmail, h.Cfg.SMTPPassword)
}

var discordUnsetOnce sync.Once

// notifyMerchantAsync sends an internal alert without blocking the request.
// A configured Discord webhook replaces the merchant email.
func (h *Handler) notifyMerchantAsync(subject, body string) {
	h.dispatchMerchant(services.DiscordMessage{
		Title:       subject,
		Description: body,
		Color:       services.ColorFor(subject),
	})
}

// dispatchMerchant posts an ops alert to Discord, or emails the merchant
// inbox when no webhook is configured. Customer mail (OTP, invoices,
// order updates) does not go through here.
func (h *Handler) dispatchMerchant(msg services.DiscordMessage) {
	h.dispatchMerchantTo(h.merchantEmail(), msg, "")
}

func (h *Handler) dispatchMerchantTo(emailTo string, msg services.DiscordMessage, footer string) {
	webhook := strings.TrimSpace(h.Cfg.DiscordWebhookURL)
	if webhook != "" {
		go func(footer string) {
			if footer == "" {
				ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
				footer = h.activityFooter(ctx)
				cancel()
			}
			msg.Footer = footer
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			defer cancel()
			if err := services.PostDiscord(ctx, webhook, msg); err != nil {
				log.Printf("[DISCORD] %s: %v", clipText(msg.Title, 80), err)
			}
		}(footer)
		return
	}

	body := msg.Plain()
	if emailTo == "" || body == "" || h.Cfg.SMTPEmail == "" || h.Cfg.SMTPPassword == "" {
		return
	}
	subject := msg.Title
	go func() {
		if err := h.emailService().SendMerchantAlert(emailTo, subject, body); err != nil {
			log.Printf("[MERCHANT] email failed: %v", err)
		}
	}()
}

// activityFooter is the day's shopper counts, in India time, attached to
// every ops alert.
func (h *Handler) activityFooter(ctx context.Context) string {
	if h == nil || h.DB == nil {
		return ""
	}
	now := time.Now().In(istZone)
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, istZone)
	var row struct {
		Signups   int64
		Checkouts int64
		Dropped   int64
		Paid      int64
		Failed    int64
		Revenue   float64
	}
	err := h.DB.WithContext(ctx).Raw(`
		SELECT
		  (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND created_at >= ?) AS signups,
		  (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL AND created_at >= ?) AS checkouts,
		  (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL AND status = 'abandoned' AND updated_at >= ?) AS dropped,
		  (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL AND payment_status = 'paid' AND created_at >= ?) AS paid,
		  (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL AND payment_status = 'failed' AND updated_at >= ?) AS failed,
		  (SELECT COALESCE(SUM(amount), 0) FROM orders WHERE deleted_at IS NULL AND payment_status = 'paid' AND created_at >= ?) AS revenue
	`, start, start, start, start, start, start).Scan(&row).Error
	if err != nil {
		log.Printf("[DISCORD] activity snapshot: %v", err)
		return "Today (IST) · activity unavailable"
	}
	return fmt.Sprintf("Today (IST) · %d signups · %d checkouts · %d dropped · %d paid · %d payment failed · ₹%.0f revenue",
		row.Signups, row.Checkouts, row.Dropped, row.Paid, row.Failed, row.Revenue)
}

// deliverAbandonedCartEmail sends one abandoned-checkout nudge. The sweep
// calls it sequentially so a batch does not open a dozen SMTP connections
// at once. An empty cart or address is a no-op.
func (h *Handler) deliverAbandonedCartEmail(order models.Order) error {
	if order.CustomerEmail == "" || len(order.Items) == 0 {
		return nil
	}
	items := make([]string, 0, len(order.Items))
	for _, item := range order.Items {
		items = append(items, item.Name)
	}
	return h.emailService().SendAbandonedCartEmail(
		order.CustomerEmail, order.CustomerName, items, "",
	)
}

// notifyMerchantDispute alerts ops to a payment dispute. Razorpay imposes
// a response deadline, so this is urgent rather than informational.
func (h *Handler) notifyMerchantDispute(paymentID, reason string, amount float64) {
	h.notifyMerchantAsync(
		fmt.Sprintf("URGENT: payment dispute on %s", paymentID),
		fmt.Sprintf(`A payment dispute was opened.

Payment ID: %s
Reason: %s
Amount: ₹%.2f

Razorpay requires a response before their stated deadline, otherwise the
dispute is decided against us by default. Respond from the Razorpay
dashboard and update the support request raised alongside this alert.`,
			paymentID, reason, amount))
	metrics.RecordPaymentOutcome("disputed")
}

// sendOrderCancelledEmail confirms a cancellation to the customer. Called
// on a goroutine; failures are logged, never surfaced.
func (h *Handler) sendOrderCancelledEmail(order models.Order, reason string) {
	if order.CustomerEmail == "" {
		return
	}
	refunded := order.PaymentStatus == "paid"
	if err := h.emailService().SendOrderCancelledEmail(
		order.CustomerEmail, order.CustomerName, order.ID, order.Amount, refunded,
	); err != nil {
		log.Printf("[EMAIL] order cancelled: %v", err)
	}
	h.notifyMerchantAsync(
		fmt.Sprintf("Order #%d cancelled", order.ID),
		fmt.Sprintf("Order #%d (₹%.2f) was cancelled.\n\nCustomer: %s <%s>\nReason: %s\nPayment status: %s",
			order.ID, order.Amount, order.CustomerName, order.CustomerEmail, reason, order.PaymentStatus))
}

// sendOrderShippedEmail delivers tracking details once a shipment exists.
func (h *Handler) sendOrderShippedEmail(order models.Order) {
	if order.CustomerEmail == "" || order.AWBNumber == "" {
		return
	}
	courier := order.CourierService
	if courier == "" {
		courier = order.CourierProvider
	}
	if err := h.emailService().SendOrderShippedEmail(
		order.CustomerEmail, order.CustomerName, order.ID, courier, order.AWBNumber, order.TrackingURL,
	); err != nil {
		log.Printf("[EMAIL] order shipped: %v", err)
	}
}

func (h *Handler) notifyMerchantNewUser(user models.User, source, ip, userAgent string) {
	place := formatPlace(user.AddressLine, user.City, user.State, user.Pincode, user.Country)
	h.dispatchMerchant(services.DiscordMessage{
		Title: fmt.Sprintf("New user #%d · %s", user.ID, orDash(user.Name)),
		URL:   services.MapsURL(user.Latitude, user.Longitude, place),
		Color: services.ColorBlue,
		Fields: []services.DiscordField{
			services.Field("Name", user.Name, true),
			services.Field("Phone", user.PhoneOrEmpty(), true),
			services.Field("Email", user.EmailOrEmpty(), true),
			services.Field("Source", source, true),
			services.Field("Provider", user.Provider, true),
			services.Field("Role", user.Role, true),
			services.Field("Address", place, false),
			services.Field("Map", services.MapsURL(user.Latitude, user.Longitude, place), false),
			services.Field("IP", ip, true),
			services.Field("Device", clipText(userAgent, 300), false),
			services.Field("Signed up", user.CreatedAt.In(istZone).Format("02 Jan 2006 15:04 IST"), true),
		},
	})
}

func (h *Handler) notifyMerchantPaidOrder(order models.Order) {
	place := formatPlace(order.AddressLine, order.City, order.State, order.Pincode, "")
	h.dispatchMerchant(orderAlert("Order paid", services.ColorGreen, order, place))
}

// notifyAbandonedCheckouts tells ops which unpaid checkouts just expired.
// One person is posted at most once per sweep, and a backlog older than
// the nudge window is skipped so a restart does not flood the channel.
func (h *Handler) notifyAbandonedCheckouts(ctx context.Context, claimed []abandonedCandidate) {
	picks := selectAbandonedAlerts(claimed, time.Now(), maxAbandonedEmailsPerSweep)
	if len(picks) == 0 {
		return
	}
	if strings.TrimSpace(h.Cfg.DiscordWebhookURL) == "" {
		discordUnsetOnce.Do(func() {
			log.Printf("[DISCORD] DISCORD_WEBHOOK_URL is empty; checkout drop-offs are not posted")
		})
		return
	}

	ids := make([]uint, len(picks))
	for i, pick := range picks {
		ids[i] = pick.ID
	}
	var orders []models.Order
	if err := h.DB.WithContext(ctx).Preload("Items").Where("id IN ?", ids).Find(&orders).Error; err != nil {
		log.Printf("[DISCORD] load dropped checkouts: %v", err)
		return
	}
	byID := make(map[uint]models.Order, len(orders))
	for _, order := range orders {
		byID[order.ID] = order
	}
	footer := h.activityFooter(ctx)
	for _, pick := range picks {
		order, ok := byID[pick.ID]
		if !ok {
			continue
		}
		place := formatPlace(order.AddressLine, order.City, order.State, order.Pincode, "")
		h.dispatchMerchantTo("", orderAlert("Checkout dropped", services.ColorOrange, order, place), footer)
	}
}

func orderAlert(kind string, color int, order models.Order, place string) services.DiscordMessage {
	userID := "guest"
	if order.UserID != nil {
		userID = fmt.Sprintf("%d", *order.UserID)
	}
	mapURL := services.MapsURL(order.Latitude, order.Longitude, place)
	started := order.CreatedAt.In(istZone).Format("02 Jan 15:04 IST")
	when := "Placed " + started
	if kind == "Checkout dropped" {
		age := time.Since(order.CreatedAt).Round(time.Minute)
		if age < time.Minute {
			age = time.Minute
		}
		when = fmt.Sprintf("Started %s · left after %s", started, age)
	}
	money := fmt.Sprintf("₹%.0f %s · %s · %s",
		order.Amount, order.Currency, orDash(order.PaymentStatus), orDash(order.FulfillmentChannel))
	delivery := formatDelivery(order)
	return services.DiscordMessage{
		Title: fmt.Sprintf("%s · #%d · %s", kind, order.ID, orDash(order.CustomerName)),
		URL:   mapURL,
		Color: color,
		Fields: []services.DiscordField{
			services.Field("Name", order.CustomerName, true),
			services.Field("Phone", order.CustomerPhone, true),
			services.Field("Email", order.CustomerEmail, true),
			services.Field("User", userID, true),
			services.Field("Address", place, false),
			services.Field("Map", mapURL, false),
			services.Field("IP", order.ClientIP, true),
			services.Field("Amount", money, false),
			services.Field("Items", orderItemsText(order.Items), false),
			services.Field("Delivery", delivery, false),
			services.Field("When", when, false),
			services.Field("Device", clipText(order.UserAgent, 300), false),
			services.Field("Razorpay", strings.TrimSpace(order.RazorpayOrderID+" "+order.RazorpayPaymentID), false),
		},
	}
}

func orderItemsText(items []models.OrderItem) string {
	if len(items) == 0 {
		return ""
	}
	var b strings.Builder
	for i, item := range items {
		if i > 0 {
			b.WriteByte('\n')
		}
		fmt.Fprintf(&b, "%d. %s × %d · ₹%.0f", i+1, item.Name, item.Quantity, item.Price)
	}
	return b.String()
}

func formatDelivery(order models.Order) string {
	var parts []string
	if order.FulfillmentZone != "" {
		parts = append(parts, "zone "+order.FulfillmentZone)
	}
	if order.DistanceKm != nil {
		parts = append(parts, fmt.Sprintf("%.1f km", *order.DistanceKm))
	}
	if order.DeliveryFee > 0 {
		parts = append(parts, fmt.Sprintf("fee ₹%.0f", order.DeliveryFee))
	} else if order.DeliveryFeeWaived {
		parts = append(parts, "delivery fee waived")
	}
	if order.CouponCode != "" {
		parts = append(parts, fmt.Sprintf("coupon %s −₹%.0f", order.CouponCode, order.DiscountTotal))
	}
	if order.DeliverySlot != "" {
		parts = append(parts, order.DeliverySlot+" slot")
	}
	if order.Latitude != nil && order.Longitude != nil {
		parts = append(parts, fmt.Sprintf("%.5f, %.5f", *order.Latitude, *order.Longitude))
	}
	return strings.Join(parts, " · ")
}

func formatPlace(line, city, state, pincode, country string) string {
	var parts []string
	if text := strings.TrimSpace(line); text != "" {
		parts = append(parts, text)
	}
	cityLine := strings.Trim(strings.Join([]string{strings.TrimSpace(city), strings.TrimSpace(state)}, ", "), ", ")
	if pin := strings.TrimSpace(pincode); pin != "" {
		if cityLine != "" {
			cityLine += " " + pin
		} else {
			cityLine = pin
		}
	}
	if cityLine != "" {
		parts = append(parts, cityLine)
	}
	if text := strings.TrimSpace(country); text != "" {
		parts = append(parts, text)
	}
	return strings.Join(parts, "\n")
}

type browseAlertRequest struct {
	SessionID   string   `json:"sessionId"`
	DurationMin int      `json:"durationMin"`
	Path        string   `json:"path"`
	Paths       []string `json:"paths"`
	Referrer    string   `json:"referrer"`
	Name        string   `json:"name"`
	Email       string   `json:"email"`
	Phone       string   `json:"phone"`
}

// ReportLongBrowse notifies the merchant when a visitor browses 10+ minutes.
// Responds 204 and never surfaces UI feedback.
func (h *Handler) ReportLongBrowse(w http.ResponseWriter, r *http.Request) {
	var req browseAlertRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if req.DurationMin < 10 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if req.SessionID == "" {
		req.SessionID = middlewares.ClientIP(r)
	}

	if h.Redis != nil {
		key := "merchant:browse:" + req.SessionID
		ok, err := h.Redis.SetNX(r.Context(), key, "1", 24*time.Hour).Result()
		if err == nil && !ok {
			w.WriteHeader(http.StatusNoContent)
			return
		}
	}

	name, email, phone := req.Name, req.Email, req.Phone
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		if claims, err := appauth.ParseToken(h.Cfg.JWTSecret, strings.TrimPrefix(auth, "Bearer ")); err == nil && claims != nil {
			var user models.User
			if err := h.DB.WithContext(r.Context()).First(&user, claims.UserID).Error; err == nil {
				if name == "" {
					name = user.Name
				}
				if email == "" {
					email = user.EmailOrEmpty()
				}
				if phone == "" {
					phone = user.PhoneOrEmpty()
				}
			}
		}
	}

	paths := strings.Join(req.Paths, "\n")
	if paths == "" {
		paths = req.Path
	}
	h.dispatchMerchant(services.DiscordMessage{
		Title: fmt.Sprintf("Browsing %d min · %s", req.DurationMin, orDash(name)),
		Color: services.ColorPurple,
		Fields: []services.DiscordField{
			services.Field("Name", name, true),
			services.Field("Phone", phone, true),
			services.Field("Email", email, true),
			services.Field("Duration", fmt.Sprintf("~%d minutes", req.DurationMin), true),
			services.Field("IP", middlewares.ClientIP(r), true),
			services.Field("Session", req.SessionID, true),
			services.Field("Page", req.Path, false),
			services.Field("Referrer", req.Referrer, false),
			services.Field("Paths", paths, false),
			services.Field("Device", clipText(r.UserAgent(), 300), false),
		},
	})
	w.WriteHeader(http.StatusNoContent)
}
