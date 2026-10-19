package handlers

import (
	"context"
	"errors"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"gorm.io/gorm"
)

// pushNotice writes one in-app notification when the customer's settings
// allow that kind. Duplicate dedupe keys are ignored. Vacation mode holds
// care and weather alerts; order and assistant alerts still go through.
func (h *Handler) pushNotice(ctx context.Context, userID *uint, kind, title, body, href, dedupe string, orderID, productID, plantID *uint) {
	if userID == nil || *userID == 0 || strings.TrimSpace(dedupe) == "" {
		return
	}
	prefs := h.prefsFor(ctx, *userID)
	if !noticeAllowed(prefs, kind) {
		return
	}
	if prefs.VacationUntil != nil && prefs.VacationUntil.After(time.Now()) && careKind(kind) {
		return
	}
	title = clipText(title, 140)
	body = clipText(body, 500)
	href = clipText(href, 200)
	if len(dedupe) > 120 {
		dedupe = dedupe[:120]
	}
	note := models.AppNotification{
		UserID:       *userID,
		Kind:         kind,
		Title:        title,
		Body:         body,
		Href:         href,
		OrderID:      orderID,
		ProductID:    productID,
		OwnedPlantID: plantID,
		DedupeKey:    dedupe,
	}
	err := h.DB.WithContext(ctx).Create(&note).Error
	if err == nil || isDuplicateKey(err) {
		return
	}
	log.Printf("[NOTIFY] inbox: %v", err)
}

func (h *Handler) prefsFor(ctx context.Context, userID uint) models.NotificationPreference {
	var prefs models.NotificationPreference
	err := h.DB.WithContext(ctx).Where("user_id = ?", userID).First(&prefs).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		prefs = defaultPrefs(userID)
		if createErr := h.DB.WithContext(ctx).Create(&prefs).Error; createErr != nil && !isDuplicateKey(createErr) {
			log.Printf("[NOTIFY] create prefs: %v", createErr)
		}
		return prefs
	}
	return prefs
}

func defaultPrefs(userID uint) models.NotificationPreference {
	return models.NotificationPreference{
		UserID:         userID,
		OrderUpdates:   true,
		Promotions:     false,
		CareReminders:  true,
		WeatherAlerts:  true,
		DoothaAlerts:   true,
		ReminderHour:   8,
		QuietStartHour: 22,
		QuietEndHour:   7,
	}
}

func noticeAllowed(prefs models.NotificationPreference, kind string) bool {
	switch kind {
	case "offer":
		return prefs.Promotions
	case "weather":
		return prefs.WeatherAlerts
	case "dootha":
		return prefs.DoothaAlerts
	case "order":
		return prefs.OrderUpdates
	default:
		return prefs.CareReminders
	}
}

func careKind(kind string) bool {
	switch kind {
	case "watering", "fertilizing", "mist", "rotate", "repot", "prune", "health", "digest", "weather", "care":
		return true
	default:
		return false
	}
}

func (h *Handler) notifyOrderEvent(ctx context.Context, order models.Order, title, body, dedupeSuffix string) {
	if order.UserID == nil {
		return
	}
	id := order.ID
	h.pushNotice(ctx, order.UserID, "order", title, body, "/orders",
		"order:"+strconv.FormatUint(uint64(order.ID), 10)+":"+dedupeSuffix, &id, nil, nil)
}
