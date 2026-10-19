package handlers

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"gorm.io/gorm"
)

func (h *Handler) notificationPrefs(r *http.Request, userID uint) models.NotificationPreference {
	var prefs models.NotificationPreference
	err := h.DB.WithContext(r.Context()).Where("user_id = ?", userID).First(&prefs).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		prefs = defaultPrefs(userID)
		if createErr := h.DB.WithContext(r.Context()).Create(&prefs).Error; createErr != nil {
			log.Printf("[NOTIFY] create prefs: %v", createErr)
		}
		return prefs
	}
	if err != nil {
		log.Printf("[NOTIFY] load prefs: %v", err)
	}
	return prefs
}

func (h *Handler) GetNotificationPreferences(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	prefs := h.notificationPrefs(r, claims.UserID)
	httpjson.JSON(w, http.StatusOK, prefsView(prefs))
}

func (h *Handler) UpdateNotificationPreferences(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	var req struct {
		OrderUpdates   *bool   `json:"orderUpdates"`
		Promotions     *bool   `json:"promotions"`
		CareReminders  *bool   `json:"careReminders"`
		WeatherAlerts  *bool   `json:"weatherAlerts"`
		DoothaAlerts   *bool   `json:"doothaAlerts"`
		ReminderHour   *int    `json:"reminderHour"`
		QuietStartHour *int    `json:"quietStartHour"`
		QuietEndHour   *int    `json:"quietEndHour"`
		VacationUntil  *string `json:"vacationUntil"`
		ClearVacation  *bool   `json:"clearVacation"`
		PushToken      *string `json:"pushToken"`
	}
	if !httpjson.Decode(w, r, &req) {
		return
	}
	prefs := h.notificationPrefs(r, claims.UserID)
	if req.OrderUpdates != nil {
		prefs.OrderUpdates = *req.OrderUpdates
	}
	if req.Promotions != nil {
		prefs.Promotions = *req.Promotions
	}
	if req.CareReminders != nil {
		prefs.CareReminders = *req.CareReminders
	}
	if req.WeatherAlerts != nil {
		prefs.WeatherAlerts = *req.WeatherAlerts
	}
	if req.DoothaAlerts != nil {
		prefs.DoothaAlerts = *req.DoothaAlerts
	}
	if req.ReminderHour != nil {
		if *req.ReminderHour < 0 || *req.ReminderHour > 23 {
			httpjson.Error(w, http.StatusBadRequest, "reminder hour must be between 0 and 23")
			return
		}
		prefs.ReminderHour = *req.ReminderHour
		if prefs.ReminderHour == 0 {
			prefs.ReminderHour = 8
		}
	}
	if req.QuietStartHour != nil {
		if *req.QuietStartHour < 0 || *req.QuietStartHour > 23 {
			httpjson.Error(w, http.StatusBadRequest, "quiet hours must be between 0 and 23")
			return
		}
		prefs.QuietStartHour = *req.QuietStartHour
	}
	if req.QuietEndHour != nil {
		if *req.QuietEndHour < 0 || *req.QuietEndHour > 23 {
			httpjson.Error(w, http.StatusBadRequest, "quiet hours must be between 0 and 23")
			return
		}
		prefs.QuietEndHour = *req.QuietEndHour
	}
	if req.ClearVacation != nil && *req.ClearVacation {
		prefs.VacationUntil = nil
	}
	if req.VacationUntil != nil && strings.TrimSpace(*req.VacationUntil) != "" {
		parsed, err := time.Parse("2006-01-02", strings.TrimSpace(*req.VacationUntil))
		if err != nil {
			httpjson.Error(w, http.StatusBadRequest, "vacationUntil must be YYYY-MM-DD")
			return
		}
		end := parsed.Add(23*time.Hour + 59*time.Minute)
		prefs.VacationUntil = &end
	}
	if req.PushToken != nil {
		token := strings.TrimSpace(*req.PushToken)
		if len(token) > 255 {
			token = token[:255]
		}
		prefs.PushToken = token
	}
	if err := h.DB.WithContext(r.Context()).Save(&prefs).Error; err != nil {
		log.Printf("[NOTIFY] save prefs: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to save notification settings")
		return
	}
	httpjson.JSON(w, http.StatusOK, prefsView(prefs))
}

func prefsView(prefs models.NotificationPreference) map[string]any {
	hour := prefs.ReminderHour
	if hour == 0 {
		hour = 8
	}
	return map[string]any{
		"orderUpdates":   prefs.OrderUpdates,
		"promotions":     prefs.Promotions,
		"careReminders":  prefs.CareReminders,
		"weatherAlerts":  prefs.WeatherAlerts,
		"doothaAlerts":   prefs.DoothaAlerts,
		"reminderHour":   hour,
		"quietStartHour": prefs.QuietStartHour,
		"quietEndHour":   prefs.QuietEndHour,
		"vacationUntil":  prefs.VacationUntil,
		"pushRegistered": prefs.PushToken != "",
	}
}

func (h *Handler) ListAppNotifications(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	var notes []models.AppNotification
	if err := h.DB.WithContext(r.Context()).
		Where("user_id = ?", claims.UserID).
		Order("created_at DESC").
		Limit(50).
		Find(&notes).Error; err != nil {
		log.Printf("[NOTIFY] list: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to load notifications")
		return
	}
	var unread int64
	h.DB.WithContext(r.Context()).Model(&models.AppNotification{}).
		Where("user_id = ? AND read_at IS NULL", claims.UserID).
		Count(&unread)
	httpjson.JSON(w, http.StatusOK, map[string]any{
		"notifications": notes,
		"unread":        unread,
	})
}

func (h *Handler) MarkNotificationRead(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	id, err := strconv.ParseUint(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid notification id")
		return
	}
	res := h.DB.WithContext(r.Context()).Model(&models.AppNotification{}).
		Where("id = ? AND user_id = ? AND read_at IS NULL", id, claims.UserID).
		Update("read_at", gorm.Expr("NOW()"))
	if res.Error != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to update notification")
		return
	}
	httpjson.JSON(w, http.StatusOK, map[string]any{"success": true})
}

func (h *Handler) MarkAllNotificationsRead(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	if err := h.DB.WithContext(r.Context()).Model(&models.AppNotification{}).
		Where("user_id = ? AND read_at IS NULL", claims.UserID).
		Update("read_at", gorm.Expr("NOW()")).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to update notifications")
		return
	}
	httpjson.JSON(w, http.StatusOK, map[string]any{"success": true})
}
