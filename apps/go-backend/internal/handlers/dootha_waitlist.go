package handlers

import (
	"fmt"
	"log"
	"net/http"
	"net/mail"
	"strings"
	"time"

	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/middlewares"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/phoneutil"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/services"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
)

type joinDoothaWaitlistRequest struct {
	Name    string `json:"name"`
	Phone   string `json:"phone"`
	Email   string `json:"email"`
	Address string `json:"address"`
	Source  string `json:"source"`
	// Website is a honeypot: real browsers leave the hidden field empty.
	Website string `json:"website"`
}

// JoinDoothaWaitlist records an interest sign-up for the Dootha Care device
// and emails the details to the waiting-list inbox.
//
// Public and unauthenticated — the sign-up popup is shown to first-time
// visitors — so it is rate limited by the router and carries a honeypot. A
// signed-in visitor's user ID is attached when a token is present.
func (h *Handler) JoinDoothaWaitlist(w http.ResponseWriter, r *http.Request) {
	var req joinDoothaWaitlistRequest
	if !httpjson.Decode(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Website) != "" {
		httpjson.Error(w, http.StatusBadRequest, "invalid request")
		return
	}

	name := oneLine(req.Name, 100)
	phone := phoneutil.TenDigitIN(req.Phone)
	email := oneLine(req.Email, 160)
	address := clip(req.Address, 300)

	if len([]rune(name)) < 2 {
		httpjson.Error(w, http.StatusBadRequest, "Please enter your name.")
		return
	}
	if phone == "" {
		httpjson.Error(w, http.StatusBadRequest, "Please enter a valid 10-digit mobile number.")
		return
	}
	// Email and address are optional, but a value that is present must be usable.
	if email != "" {
		addr, err := mail.ParseAddress(email)
		if err != nil || !strings.Contains(addr.Address, ".") {
			httpjson.Error(w, http.StatusBadRequest, "Please enter a valid email address, or leave it blank.")
			return
		}
		email = addr.Address
	}

	source := strings.ToLower(oneLine(req.Source, 40))
	if source == "" {
		source = "homepage_popup"
	}

	var userID *uint
	if claims, ok := appauth.FromContext(r.Context()); ok {
		userID = &claims.UserID
	}

	net := services.Capture(r)
	ip := net.IP
	if ip == "" {
		ip = middlewares.ClientIP(r)
	}
	entry := models.DoothaWaitlist{
		Name:      name,
		Phone:     phone,
		Email:     email,
		Address:   address,
		Status:    "pending",
		Source:    source,
		UserID:    userID,
		IP:        ip,
		UserAgent: oneLine(r.UserAgent(), 300),
		Signups:   1,
	}

	db := h.db(r.Context())
	var existing models.DoothaWaitlist
	err := db.Where("phone = ?", phone).First(&existing).Error
	switch {
	case err == nil:
		// Same number again: keep the earliest sign-up but take the newest
		// details, since the visitor may be correcting or adding to them.
		existing.Name = name
		if email != "" {
			existing.Email = email
		}
		if address != "" {
			existing.Address = address
		}
		if userID != nil {
			existing.UserID = userID
		}
		existing.Source = source
		existing.IP = entry.IP
		existing.UserAgent = entry.UserAgent
		existing.Signups++
		if saveErr := db.Save(&existing).Error; saveErr != nil {
			log.Printf("[WAITLIST] update failed for %s: %v", phone, saveErr)
			httpjson.Error(w, http.StatusInternalServerError, "Could not save your details. Please try again.")
			return
		}
		entry = existing
	default:
		if createErr := db.Create(&entry).Error; createErr != nil {
			log.Printf("[WAITLIST] insert failed for %s: %v", phone, createErr)
			httpjson.Error(w, http.StatusInternalServerError, "Could not save your details. Please try again.")
			return
		}
	}

	h.notifyWaitlistSignup(entry, r.Referer(), net)

	httpjson.JSON(w, http.StatusCreated, map[string]any{
		"id":     entry.ID,
		"name":   entry.Name,
		"phone":  entry.Phone,
		"status": entry.Status,
	})
}

// notifyWaitlistSignup emails the sign-up to the waiting-list inbox without
// blocking the response: the entry is already stored, so a mail failure must
// not fail the request.
func (h *Handler) notifyWaitlistSignup(entry models.DoothaWaitlist, referrer string, net services.NetHint) {
	to := strings.TrimSpace(h.Cfg.WaitlistEmail)
	if to == "" {
		to = h.merchantEmail()
	}
	if strings.TrimSpace(h.Cfg.DiscordWebhookURL) == "" && (to == "" || h.Cfg.SMTPEmail == "" || h.Cfg.SMTPPassword == "") {
		log.Printf("[WAITLIST] alerts not configured; sign-up %d not sent", entry.ID)
		return
	}

	userID := "guest"
	if entry.UserID != nil {
		userID = fmt.Sprintf("%d", *entry.UserID)
	}
	body := fmt.Sprintf(`Dootha Care waiting list sign-up

Name: %s
Phone: %s
Email: %s
Address: %s

Entry ID: %d
Signed up: %d time(s)
Source: %s
User ID: %s
IP: %s
Referrer: %s
User-Agent: %s
Received: %s
`,
		entry.Name,
		entry.Phone,
		orDash(entry.Email),
		orDash(entry.Address),
		entry.ID,
		entry.Signups,
		entry.Source,
		userID,
		entry.IP,
		orDash(oneLine(referrer, 300)),
		entry.UserAgent,
		time.Now().In(istZone).Format("02-01-2006 15:04 IST"),
	)

	subject := fmt.Sprintf("Dootha Care waitlist · %s", entry.Name)
	if net.IP == "" {
		net.IP = entry.IP
	}
	if net.UserAgent == "" {
		net.UserAgent = entry.UserAgent
	}
	h.dispatchMerchantTo(to, services.DiscordMessage{
		Title:       subject,
		Description: body,
		Color:       services.ColorBlue,
		Network:     net,
		Detail:      networkExtra(net),
	}, "")
}

func orDash(value string) string {
	if strings.TrimSpace(value) == "" {
		return "—"
	}
	return value
}

// ListDoothaWaitlist returns the waiting list, newest first, for the admin app.
func (h *Handler) ListDoothaWaitlist(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	if !appauth.IsAdminRole(claims.Role) {
		httpjson.Error(w, http.StatusForbidden, "admin access required")
		return
	}

	query := h.db(r.Context()).Model(&models.DoothaWaitlist{}).Order("created_at DESC")
	if status := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("status"))); status != "" {
		query = query.Where("status = ?", status)
	}

	var rows []models.DoothaWaitlist
	if err := query.Limit(500).Find(&rows).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch the waiting list")
		return
	}

	httpjson.JSON(w, http.StatusOK, rows)
}
