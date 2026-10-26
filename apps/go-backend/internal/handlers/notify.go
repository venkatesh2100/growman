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
		// Return immediately. Geolocation and the webhook run after the
		// response, so this work does not stretch the Cloud Run request.
		go h.postDiscord(webhook, msg, footer)
		return
	}
	// Visitor profiles are posted to Discord only. Without a webhook there
	// is nothing to send and no geolocation lookup to pay for.
	if msg.VisitorsOnly {
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

// postDiscord fills the location block and posts the embed. It runs off the
// request. A visitor alert is dropped here when the IP is a datacenter or
// the lookup cannot produce coordinates. The shop-stats query is skipped
// for visitors and reused from memory for other alerts.
func (h *Handler) postDiscord(webhook string, msg services.DiscordMessage, footer string) {
	ip := strings.TrimSpace(msg.Network.IP)
	if msg.VisitorsOnly && ip == "" {
		return
	}
	if ip != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
		place, err := services.LookupPlace(ctx, ip)
		cancel()
		if msg.VisitorsOnly && !services.AllowVisitorAlert(place, err) {
			return
		}
		detail := []services.DiscordField{services.Field("Exact IP", ip, true)}
		if err == nil {
			detail = append(detail, services.LocationFields(place)...)
			if strings.TrimSpace(msg.URL) == "" && place.HasCoord {
				msg.URL = place.MapsLink()
			}
		}
		detail = append(detail, msg.Detail...)
		msg.Detail = detail
	}
	if footer == "" {
		ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
		footer = h.activityFooter(ctx, !msg.VisitorsOnly)
		cancel()
	}
	msg.Footer = footer
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	if err := services.PostDiscord(ctx, webhook, msg); err != nil {
		log.Printf("[DISCORD] %s: %v", clipText(msg.Title, 80), err)
	}
}

var (
	activityMu   sync.Mutex
	activityText string
	activityAt   time.Time
)

// activityFooter is the day's shopper counts, in India time. The snapshot is
// reused for ten minutes so a burst of alerts does not run the same six
// counts against Postgres on every send. query false returns the cached
// line or nothing, which is what visitor alerts use.
func (h *Handler) activityFooter(ctx context.Context, query bool) string {
	activityMu.Lock()
	if activityText != "" && time.Since(activityAt) < 10*time.Minute {
		text := activityText
		activityMu.Unlock()
		return text
	}
	activityMu.Unlock()
	if !query || h == nil || h.DB == nil {
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
		text := "Today (IST) · activity unavailable"
		activityMu.Lock()
		activityText = text
		activityAt = time.Now()
		activityMu.Unlock()
		return text
	}
	text := fmt.Sprintf("Today (IST) · %d signups · %d checkouts · %d dropped · %d paid · %d payment failed · ₹%.0f revenue",
		row.Signups, row.Checkouts, row.Dropped, row.Paid, row.Failed, row.Revenue)
	activityMu.Lock()
	activityText = text
	activityAt = time.Now()
	activityMu.Unlock()
	return text
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

func (h *Handler) notifyMerchantNewUser(user models.User, source string, net services.NetHint) {
	place := formatPlace(user.AddressLine, user.City, user.State, user.Pincode, user.Country)
	h.dispatchMerchant(services.DiscordMessage{
		Title:   fmt.Sprintf("New user #%d · %s", user.ID, orDash(user.Name)),
		URL:     services.MapsURL(user.Latitude, user.Longitude, place),
		Color:   services.ColorBlue,
		Network: net,
		Fields: []services.DiscordField{
			services.Field("Name", user.Name, true),
			services.Field("Phone", user.PhoneOrEmpty(), true),
			services.Field("Email", user.EmailOrEmpty(), true),
			services.Field("Source", source, true),
			services.Field("Provider", user.Provider, true),
			services.Field("Role", user.Role, true),
			services.Field("Address", place, false),
			services.Field("Map", services.MapsURL(user.Latitude, user.Longitude, place), false),
			services.Field("Device", services.DeviceText(net), false),
			services.Field("Signed up", user.CreatedAt.In(istZone).Format("02 Jan 2006 15:04 IST"), true),
		},
		Detail: networkExtra(net),
	})
}

func (h *Handler) notifyMerchantPaidOrder(order models.Order) {
	place := formatPlace(order.AddressLine, order.City, order.State, order.Pincode, "")
	msg := orderAlert("Order paid", services.ColorGreen, order, place)
	msg.Network = services.NetHint{IP: order.ClientIP, UserAgent: order.UserAgent}
	h.dispatchMerchant(msg)
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
	footer := h.activityFooter(ctx, true)
	for _, pick := range picks {
		order, ok := byID[pick.ID]
		if !ok {
			continue
		}
		place := formatPlace(order.AddressLine, order.City, order.State, order.Pincode, "")
		msg := orderAlert("Checkout dropped", services.ColorOrange, order, place)
		msg.Network = services.NetHint{IP: order.ClientIP, UserAgent: order.UserAgent}
		h.dispatchMerchantTo("", msg, footer)
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
	Screen      string   `json:"screen"`
	Viewport    string   `json:"viewport"`
	Timezone    string   `json:"timezone"`
	Languages   string   `json:"languages"`
	Platform    string   `json:"platform"`
	Cores       int      `json:"cores"`
	Touch       int      `json:"touch"`
}

// ReportLongBrowse notifies the merchant when a person has been on the shop
// for at least ten minutes. Bots and datacenter calls are ignored before any
// Redis, database, or geolocation work. The handler always answers 204 and
// never stores the network profile.
func (h *Handler) ReportLongBrowse(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var req browseAlertRequest
	r.Body = http.MaxBytesReader(w, r.Body, 8<<10)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if req.DurationMin < 10 || req.DurationMin > 24*60 {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	net := services.Capture(r)
	net.Screen = clipText(req.Screen, 40)
	net.Viewport = clipText(req.Viewport, 40)
	net.Timezone = clipText(req.Timezone, 60)
	net.Languages = clipText(req.Languages, 120)
	if platform := clipText(req.Platform, 60); platform != "" {
		net.Platform = platform
	}
	if req.Cores > 0 && req.Cores < 128 {
		net.Cores = req.Cores
	}
	if req.Touch > 0 && req.Touch < 32 {
		net.Touch = req.Touch
	}
	if services.AutomatedVisitor(net) || net.IP == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if strings.TrimSpace(h.Cfg.DiscordWebhookURL) == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	// One alert per network per day, decided in memory so a repeat hit does
	// not touch Redis or start a goroutine.
	if !services.ClaimVisitor(net.IP) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if h.Redis != nil {
		ok, err := h.Redis.SetNX(r.Context(), "merchant:browse:"+net.IP, "1", 24*time.Hour).Result()
		if err == nil && !ok {
			w.WriteHeader(http.StatusNoContent)
			return
		}
	}

	var user models.User
	if h.DB != nil {
		if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
			if claims, err := appauth.ParseToken(h.Cfg.JWTSecret, strings.TrimPrefix(auth, "Bearer ")); err == nil && claims != nil {
				_ = h.DB.WithContext(r.Context()).First(&user, claims.UserID).Error
			}
		}
	}

	name := user.Name
	page := clipText(req.Path, 300)
	referrer := clipText(req.Referrer, 300)
	if referrer == "" {
		referrer = clipText(net.Referer, 300)
	}
	h.dispatchMerchant(services.DiscordMessage{
		Title:        fmt.Sprintf("Browsing %d min · %s", req.DurationMin, orDash(name)),
		Color:        services.ColorPurple,
		VisitorsOnly: true,
		Network:      net,
		Fields: []services.DiscordField{
			services.Field("Name", name, true),
			services.Field("Phone", user.PhoneOrEmpty(), true),
			services.Field("Email", user.EmailOrEmpty(), true),
			services.Field("Duration", fmt.Sprintf("~%d minutes", req.DurationMin), true),
			services.Field("Page", page, false),
		},
		Detail: browseDetail(user, net, referrer, req.Paths, page, req.SessionID),
	})
	w.WriteHeader(http.StatusNoContent)
}

func browseDetail(user models.User, net services.NetHint, referrer string, paths []string, page, sessionID string) []services.DiscordField {
	var detail []services.DiscordField
	if user.ID != 0 {
		account := fmt.Sprintf("#%d · %s · %s", user.ID, orDash(user.Role), orDash(user.Provider))
		if !user.CreatedAt.IsZero() {
			account += " · since " + user.CreatedAt.In(istZone).Format("02 Jan 2006")
		}
		detail = append(detail, services.Field("Account", account, false))
		if place := formatPlace(user.AddressLine, user.City, user.State, user.Pincode, user.Country); place != "" {
			detail = append(detail, services.Field("Saved address", place, false))
		}
		if link := services.MapsURL(user.Latitude, user.Longitude, ""); link != "" {
			detail = append(detail, services.Field("Saved map", link, false))
		}
	}
	if text := services.DeviceText(net); text != "" {
		detail = append(detail, services.Field("Device", text, false))
	}
	if referrer != "" {
		detail = append(detail, services.Field("Came from", referrer, false))
	}
	if walked := browsePaths(paths, page); walked != "" {
		detail = append(detail, services.Field("Pages", walked, false))
	}
	if sessionID != "" {
		detail = append(detail, services.Field("Session", clipText(sessionID, 80), true))
	}
	detail = append(detail, networkExtra(net)...)
	return detail
}

func browsePaths(paths []string, page string) string {
	var lines []string
	for _, path := range paths {
		path = clipText(path, 160)
		if path == "" {
			continue
		}
		lines = append(lines, path)
		if len(lines) == 12 {
			break
		}
	}
	if len(lines) == 0 {
		return page
	}
	return strings.Join(lines, "\n")
}

func networkExtra(net services.NetHint) []services.DiscordField {
	var detail []services.DiscordField
	if ua := strings.TrimSpace(net.UserAgent); ua != "" {
		detail = append(detail, services.Field("User-Agent", clipText(ua, 400), false))
	}
	fwd := strings.TrimSpace(net.ForwardedFor)
	if fwd != "" && fwd != net.IP {
		detail = append(detail, services.Field("Forwarded", clipText(fwd, 200), false))
	}
	return detail
}
