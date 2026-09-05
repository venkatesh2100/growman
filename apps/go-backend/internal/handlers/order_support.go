package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
)

type UpdateOrderSupportStatusRequest struct {
	Status     string `json:"status"`
	AdminNotes string `json:"adminNotes"`
}

// ListOrderSupportRequests returns support tickets for admin review.
func (h *Handler) ListOrderSupportRequests(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	if !appauth.IsAdminRole(claims.Role) {
		httpjson.Error(w, http.StatusForbidden, "admin access required")
		return
	}

	status := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("status")))
	query := h.DB.Model(&models.OrderSupportRequest{}).Order("created_at DESC")
	if status != "" {
		query = query.Where("status = ?", status)
	}

	var rows []models.OrderSupportRequest
	if err := query.Limit(200).Find(&rows).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch order support requests")
		return
	}

	httpjson.JSON(w, http.StatusOK, rows)
}

// UpdateOrderSupportStatus updates ticket status (admin).
func (h *Handler) UpdateOrderSupportStatus(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	if !appauth.IsAdminRole(claims.Role) {
		httpjson.Error(w, http.StatusForbidden, "admin access required")
		return
	}

	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id == 0 {
		httpjson.Error(w, http.StatusBadRequest, "invalid id")
		return
	}

	var req UpdateOrderSupportStatusRequest
	if !httpjson.Decode(w, r, &req) {
		return
	}

	status := strings.TrimSpace(strings.ToLower(req.Status))
	allowed := map[string]bool{"pending": true, "in_progress": true, "resolved": true}
	if !allowed[status] {
		httpjson.Error(w, http.StatusBadRequest, "unsupported status")
		return
	}

	var record models.OrderSupportRequest
	if err := h.DB.First(&record, id).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "request not found")
		return
	}

	updates := map[string]any{"status": status}
	if notes := strings.TrimSpace(req.AdminNotes); notes != "" {
		updates["admin_notes"] = notes
	}
	if err := h.DB.Model(&record).Updates(updates).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to update request")
		return
	}

	if err := h.DB.First(&record, id).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch updated request")
		return
	}

	httpjson.JSON(w, http.StatusOK, record)
}

func detectOrderSupportIntent(msg string) bool {
	lower := strings.ToLower(strings.TrimSpace(msg))

	for _, term := range []string{
		"delivery support", "support for order", "escalate", "escalation",
		"order delay", "delayed delivery", "late delivery", "not delivered",
		"need support", "help with order", "order problem", "order issue",
		"customer support", "contact support", "support team", "support contact",
	} {
		if strings.Contains(lower, term) {
			return true
		}
	}

	if extractOrderIDFromMessage(msg) != nil {
		for _, term := range []string{"support", "help", "delay", "delivery", "escalat", "refund", "track"} {
			if strings.Contains(lower, term) {
				return true
			}
		}
	}

	if strings.Contains(lower, "refund") && strings.Contains(lower, "order") {
		return true
	}

	return false
}

func classifyOrderIssueType(msg string) string {
	lower := strings.ToLower(msg)
	switch {
	case strings.Contains(lower, "refund"):
		return "refund"
	case strings.Contains(lower, "track"):
		return "tracking"
	case strings.Contains(lower, "delay") || strings.Contains(lower, "late") || strings.Contains(lower, "not delivered"):
		return "delivery_delay"
	default:
		return "order_support"
	}
}

func (h *Handler) handleOrderSupportChat(userMessage string, claims *appauth.Claims, loggedIn bool) accountChatResult {
	orderID := extractOrderIDFromMessage(userMessage)
	var user models.User
	var order *models.Order

	if loggedIn && claims != nil {
		_ = h.DB.Select("id, name, email, phone").First(&user, claims.UserID).Error

		if orderID != nil {
			var o models.Order
			if err := h.userOrdersQuery(claims.UserID).Preload("Items").Where("id = ?", *orderID).First(&o).Error; err == nil {
				order = &o
			}
		}
	} else if orderID != nil {
		var o models.Order
		if err := h.DB.Preload("Items").Where("id = ?", *orderID).First(&o).Error; err == nil {
			order = &o
		}
	}

	// Reuse open pending ticket for same order + user
	if loggedIn && claims != nil && orderID != nil {
		var existing models.OrderSupportRequest
		if err := h.DB.Where("order_id = ? AND user_id = ? AND status = ?", *orderID, claims.UserID, "pending").
			Order("created_at DESC").First(&existing).Error; err == nil && existing.ID != 0 {
			return h.orderSupportChatResult(&existing, order, true)
		}
	}

	record := models.OrderSupportRequest{
		IssueType:   classifyOrderIssueType(userMessage),
		Priority:    "high",
		UserMessage: strings.TrimSpace(userMessage),
		Status:      "pending",
		Source:      "chatbot",
	}
	if orderID != nil {
		record.OrderID = orderID
	}
	if loggedIn && claims != nil {
		record.UserID = &claims.UserID
		record.CustomerName = user.Name
		record.CustomerEmail = user.EmailOrEmpty()
		record.CustomerPhone = user.PhoneOrEmpty()
	}
	if order != nil {
		record.OrderStatus = order.Status
		record.PaymentStatus = order.PaymentStatus
		record.OrderAmount = order.Amount
		record.OrderItems = formatOrderItems(order.Items)
		if order.ExpectedDeliveryDate != nil {
			record.ExpectedDelivery = order.ExpectedDeliveryDate.Format("2 Jan 2006")
		}
		if record.CustomerEmail == "" {
			record.CustomerEmail = order.CustomerEmail
		}
		if record.CustomerPhone == "" {
			record.CustomerPhone = order.CustomerPhone
		}
		if record.CustomerName == "" {
			record.CustomerName = order.CustomerName
		}
	}

	if err := h.DB.Create(&record).Error; err != nil {
		return accountChatResult{
			ok:   true,
			text: "Our support team is at **growman.live@gmail.com**. We couldn't save your ticket automatically — please email us with your order number.",
		}
	}

	return h.orderSupportChatResult(&record, order, false)
}

func (h *Handler) orderSupportChatResult(record *models.OrderSupportRequest, order *models.Order, existing bool) accountChatResult {
	var b strings.Builder

	// Order status first — what the user asked about
	if record.OrderID != nil {
		if order != nil || record.OrderStatus != "" || record.OrderItems != "" {
			fmt.Fprintf(&b, "**Order #%d status**\n", *record.OrderID)
			statusLabel := displayOrderStatusFromFields(record.OrderStatus, record.PaymentStatus)
			if statusLabel == "" {
				statusLabel = "Processing"
			}
			fmt.Fprintf(&b, "- **Status:** %s\n", statusLabel)
			if record.PaymentStatus != "" {
				fmt.Fprintf(&b, "- **Payment:** %s\n", humanOrderStatus(record.PaymentStatus))
			}
			if record.OrderAmount > 0 {
				fmt.Fprintf(&b, "- **Amount:** ₹%.0f\n", record.OrderAmount)
			}
			if record.OrderItems != "" {
				fmt.Fprintf(&b, "- **Items:** %s\n", record.OrderItems)
			}
			if record.ExpectedDelivery != "" {
				fmt.Fprintf(&b, "- **Expected delivery:** %s\n", record.ExpectedDelivery)
			}
			b.WriteString("\n")
		} else {
			fmt.Fprintf(&b, "**Order #%d** — we will verify details with our support team.\n\n", *record.OrderID)
		}
	}

	// Escalation confirmation
	if existing {
		fmt.Fprintf(&b, "Your request is **already raised with our support team** (ticket **#%d**). They are looking into it.\n\n", record.ID)
	} else {
		fmt.Fprintf(&b, "Your request has been **raised to our support team** (priority ticket **#%d**). We will review the delay and get back to you within **24–48 hours**.\n\n", record.ID)
	}

	b.WriteString("**Thank you for your patience.**\n\n")

	b.WriteString("**Support contact:**\n")
	b.WriteString("- Email: **growman.live@gmail.com**\n")
	b.WriteString("- Website: https://growman.live/\n")
	fmt.Fprintf(&b, "\nPlease mention ticket **#%d** when you email us.", record.ID)

	var orders []OrderChatCard
	if order != nil {
		orders = []OrderChatCard{h.orderToChatCard(*order)}
	}

	return accountChatResult{ok: true, text: b.String(), orders: orders}
}

func displayOrderStatusFromFields(status, payment string) string {
	return displayOrderStatus(models.Order{Status: status, PaymentStatus: payment})
}
