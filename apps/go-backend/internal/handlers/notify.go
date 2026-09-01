package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/services"
)

func (h *Handler) merchantEmail() string {
	return strings.TrimSpace(h.Cfg.MerchantNotifyEmail)
}

func (h *Handler) emailService() *services.EmailService {
	return services.NewEmailService(h.Cfg.SMTPHost, h.Cfg.SMTPPort, h.Cfg.SMTPEmail, h.Cfg.SMTPPassword)
}

// notifyMerchantAsync sends an internal alert without blocking the request.
func (h *Handler) notifyMerchantAsync(subject, body string) {
	to := h.merchantEmail()
	if to == "" || h.Cfg.SMTPEmail == "" || h.Cfg.SMTPPassword == "" {
		return
	}
	go func() {
		if err := h.emailService().SendMerchantAlert(to, subject, body); err != nil {
			log.Printf("[MERCHANT] email failed: %v", err)
		}
	}()
}

func (h *Handler) notifyMerchantNewUser(user models.User, source, ip, userAgent string) {
	body := fmt.Sprintf(`New user signup

Source: %s
User ID: %d
Name: %s
Email: %s
Phone: %s
Provider: %s
Role: %s
Email verified: %v
Address: %s
City: %s
State: %s
Pincode: %s
Country: %s
IP: %s
User-Agent: %s
Created at: %s
`,
		source,
		user.ID,
		user.Name,
		user.EmailOrEmpty(),
		user.PhoneOrEmpty(),
		user.Provider,
		user.Role,
		user.EmailVerified,
		user.AddressLine,
		user.City,
		user.State,
		user.Pincode,
		user.Country,
		ip,
		userAgent,
		user.CreatedAt.Format(time.RFC3339),
	)
	h.notifyMerchantAsync(fmt.Sprintf("[Growman] New user #%d — %s", user.ID, user.Name), body)
}

func (h *Handler) notifyMerchantPaidOrder(order models.Order) {
	var items strings.Builder
	for i, item := range order.Items {
		items.WriteString(fmt.Sprintf("%d. %s | qty=%d | price=₹%.2f | productId=%d\n",
			i+1, item.Name, item.Quantity, item.Price, item.ProductID))
	}
	userID := "guest"
	if order.UserID != nil {
		userID = fmt.Sprintf("%d", *order.UserID)
	}
	body := fmt.Sprintf(`Order placed (paid)

Order ID: #%d
User ID: %s
Razorpay order: %s
Razorpay payment: %s
Amount: ₹%.2f %s
Payment status: %s
Order status: %s

Customer
  Name: %s
  Email: %s
  Phone: %s
  Address: %s
  City: %s
  State: %s
  Pincode: %s

Items:
%s
`,
		order.ID,
		userID,
		order.RazorpayOrderID,
		order.RazorpayPaymentID,
		order.Amount,
		order.Currency,
		order.PaymentStatus,
		order.Status,
		order.CustomerName,
		order.CustomerEmail,
		order.CustomerPhone,
		order.AddressLine,
		order.City,
		order.State,
		order.Pincode,
		items.String(),
	)
	h.notifyMerchantAsync(fmt.Sprintf("[Growman] Order #%d paid — ₹%.2f", order.ID, order.Amount), body)
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
		req.SessionID = clientIP(r)
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

	paths := strings.Join(req.Paths, "\n  ")
	if paths == "" {
		paths = req.Path
	}
	body := fmt.Sprintf(`Long browsing session (10+ minutes)

Session: %s
Duration: ~%d minutes
IP: %s
User-Agent: %s
Referrer: %s
Current path: %s

Visitor
  Name: %s
  Email: %s
  Phone: %s

Paths visited:
  %s
`,
		req.SessionID,
		req.DurationMin,
		clientIP(r),
		r.UserAgent(),
		req.Referrer,
		req.Path,
		name,
		email,
		phone,
		paths,
	)
	h.notifyMerchantAsync("[Growman] Visitor browsing 10+ minutes", body)
	w.WriteHeader(http.StatusNoContent)
}
