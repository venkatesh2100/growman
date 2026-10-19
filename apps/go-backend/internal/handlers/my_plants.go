package handlers

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/care"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"gorm.io/gorm"
)

// Personal plant care: a customer's own collection, watering and fertilizing
// reminders, health notes, and the in-app notification inbox those reminders
// land in. Seasonal advice is computed, not stored.

var healthStatuses = map[string]bool{
	"thriving":   true,
	"healthy":    true,
	"stressed":   true,
	"yellowing":  true,
	"pests":      true,
	"wilting":    true,
	"recovering": true,
}

type ownedPlantBody struct {
	Name               string `json:"name"`
	Location           string `json:"location"`
	Notes              string `json:"notes"`
	Room               string `json:"room"`
	PhotoURL           string `json:"photoUrl"`
	ProductID          *uint  `json:"productId"`
	ProductSlug        string `json:"productSlug"`
	WaterEveryDays     *int   `json:"waterEveryDays"`
	FertilizeEveryDays *int   `json:"fertilizeEveryDays"`
	MistEveryDays      *int   `json:"mistEveryDays"`
	RotateEveryDays    *int   `json:"rotateEveryDays"`
	RepotEveryDays     *int   `json:"repotEveryDays"`
	PruneEveryDays     *int   `json:"pruneEveryDays"`
	WaterReminder      *bool  `json:"waterReminder"`
	FertilizeReminder  *bool  `json:"fertilizeReminder"`
	MistReminder       *bool  `json:"mistReminder"`
	RotateReminder     *bool  `json:"rotateReminder"`
	RepotReminder      *bool  `json:"repotReminder"`
	PruneReminder      *bool  `json:"pruneReminder"`
}

type ownedPlantView struct {
	models.OwnedPlant
	LatestHealth string `json:"latestHealth,omitempty"`
	WaterDue     bool   `json:"waterDue"`
	FertilizeDue bool   `json:"fertilizeDue"`
	MistDue      bool   `json:"mistDue"`
	RotateDue    bool   `json:"rotateDue"`
	RepotDue     bool   `json:"repotDue"`
	PruneDue     bool   `json:"pruneDue"`
}

// CareSeason is public: the advice depends only on the month.
func (h *Handler) CareSeason(w http.ResponseWriter, r *http.Request) {
	httpjson.JSON(w, http.StatusOK, care.For(care.India(time.Now())))
}

func (h *Handler) ListOwnedPlants(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	var plants []models.OwnedPlant
	if err := h.DB.WithContext(r.Context()).
		Where("user_id = ?", claims.UserID).
		Order("name ASC").
		Find(&plants).Error; err != nil {
		log.Printf("[PLANTS] list: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to load your plants")
		return
	}
	h.recordDueReminders(r, claims.UserID, plants)
	h.checkWeather(r.Context(), claims.UserID, plants)
	httpjson.JSON(w, http.StatusOK, map[string]any{
		"plants": h.presentPlants(r, claims.UserID, plants),
		"season": care.For(care.India(time.Now())),
	})
}

func (h *Handler) CreateOwnedPlant(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	var req ownedPlantBody
	if !httpjson.Decode(w, r, &req) {
		return
	}
	plant := models.OwnedPlant{
		UserID:             claims.UserID,
		WaterEveryDays:     7,
		FertilizeEveryDays: 45,
		WaterReminder:      true,
		FertilizeReminder:  true,
	}
	if msg, ok := applyPlantBody(&plant, req); !ok {
		httpjson.Error(w, http.StatusBadRequest, msg)
		return
	}
	hour := h.reminderHour(r.Context(), claims.UserID)
	now := time.Now()
	plant.WaterNextAt = dueIf(plant.WaterReminder, now, plant.WaterEveryDays, hour)
	plant.FertilizeNextAt = dueIf(plant.FertilizeReminder, now, plant.FertilizeEveryDays, hour)
	plant.MistNextAt = dueIf(plant.MistReminder, now, plant.MistEveryDays, hour)
	plant.RotateNextAt = dueIf(plant.RotateReminder, now, plant.RotateEveryDays, hour)
	plant.RepotNextAt = dueIf(plant.RepotReminder, now, plant.RepotEveryDays, hour)
	plant.PruneNextAt = dueIf(plant.PruneReminder, now, plant.PruneEveryDays, hour)
	if err := h.DB.WithContext(r.Context()).
		Select("UserID", "Name", "Location", "Notes", "Room", "PhotoURL", "ProductID", "ProductSlug",
			"WaterEveryDays", "FertilizeEveryDays", "MistEveryDays", "RotateEveryDays", "RepotEveryDays", "PruneEveryDays",
			"WaterNextAt", "FertilizeNextAt", "MistNextAt", "RotateNextAt", "RepotNextAt", "PruneNextAt",
			"WaterReminder", "FertilizeReminder", "MistReminder", "RotateReminder", "RepotReminder", "PruneReminder").
		Create(&plant).Error; err != nil {
		log.Printf("[PLANTS] create: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to save plant")
		return
	}
	httpjson.JSON(w, http.StatusCreated, h.presentPlants(r, claims.UserID, []models.OwnedPlant{plant})[0])
}

func (h *Handler) GetOwnedPlant(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	plant, ok := h.ownedPlant(w, r, claims.UserID)
	if !ok {
		return
	}
	var logs []models.PlantHealthLog
	h.DB.WithContext(r.Context()).
		Where("owned_plant_id = ? AND user_id = ?", plant.ID, claims.UserID).
		Order("recorded_at DESC").
		Limit(30).
		Find(&logs)
	view := h.presentPlants(r, claims.UserID, []models.OwnedPlant{plant})[0]
	httpjson.JSON(w, http.StatusOK, map[string]any{
		"plant":  view,
		"health": logs,
	})
}

func (h *Handler) UpdateOwnedPlant(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	plant, ok := h.ownedPlant(w, r, claims.UserID)
	if !ok {
		return
	}
	var req ownedPlantBody
	if !httpjson.Decode(w, r, &req) {
		return
	}
	prev := plant
	if msg, ok := applyPlantBody(&plant, req); !ok {
		httpjson.Error(w, http.StatusBadRequest, msg)
		return
	}
	hour := h.reminderHour(r.Context(), claims.UserID)
	now := time.Now()
	reschedule(&plant.WaterNextAt, plant.WaterReminder, plant.WaterEveryDays, prev.WaterEveryDays, now, hour)
	reschedule(&plant.FertilizeNextAt, plant.FertilizeReminder, plant.FertilizeEveryDays, prev.FertilizeEveryDays, now, hour)
	reschedule(&plant.MistNextAt, plant.MistReminder, plant.MistEveryDays, prev.MistEveryDays, now, hour)
	reschedule(&plant.RotateNextAt, plant.RotateReminder, plant.RotateEveryDays, prev.RotateEveryDays, now, hour)
	reschedule(&plant.RepotNextAt, plant.RepotReminder, plant.RepotEveryDays, prev.RepotEveryDays, now, hour)
	reschedule(&plant.PruneNextAt, plant.PruneReminder, plant.PruneEveryDays, prev.PruneEveryDays, now, hour)
	if err := h.DB.WithContext(r.Context()).Save(&plant).Error; err != nil {
		log.Printf("[PLANTS] update: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to update plant")
		return
	}
	httpjson.JSON(w, http.StatusOK, h.presentPlants(r, claims.UserID, []models.OwnedPlant{plant})[0])
}

func (h *Handler) DeleteOwnedPlant(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	plant, ok := h.ownedPlant(w, r, claims.UserID)
	if !ok {
		return
	}
	if err := h.DB.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("owned_plant_id = ? AND user_id = ?", plant.ID, claims.UserID).
			Delete(&models.PlantHealthLog{}).Error; err != nil {
			return err
		}
		if err := tx.Where("owned_plant_id = ? AND user_id = ?", plant.ID, claims.UserID).
			Delete(&models.AppNotification{}).Error; err != nil {
			return err
		}
		return tx.Delete(&plant).Error
	}); err != nil {
		log.Printf("[PLANTS] delete: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to remove plant")
		return
	}
	httpjson.JSON(w, http.StatusOK, map[string]any{"success": true})
}

func (h *Handler) MarkPlantWatered(w http.ResponseWriter, r *http.Request) {
	h.markPlantCare(w, r, "water")
}

func (h *Handler) MarkPlantFertilized(w http.ResponseWriter, r *http.Request) {
	h.markPlantCare(w, r, "fertilize")
}

func (h *Handler) MarkPlantTask(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Kind string `json:"kind"`
	}
	if !httpjson.Decode(w, r, &req) {
		return
	}
	h.markPlantCare(w, r, strings.ToLower(strings.TrimSpace(req.Kind)))
}

func (h *Handler) markPlantCare(w http.ResponseWriter, r *http.Request, kind string) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	plant, ok := h.ownedPlant(w, r, claims.UserID)
	if !ok {
		return
	}
	now := time.Now()
	hour := h.reminderHour(r.Context(), claims.UserID)
	switch kind {
	case "water":
		if plant.WaterEveryDays <= 0 {
			httpjson.Error(w, http.StatusBadRequest, "set how many days between waterings first")
			return
		}
		plant.WaterNextAt = care.NextDueAt(now, plant.WaterEveryDays, hour)
	case "fertilize":
		if plant.FertilizeEveryDays <= 0 {
			httpjson.Error(w, http.StatusBadRequest, "set how many days between feeds first")
			return
		}
		plant.FertilizeNextAt = care.NextDueAt(now, plant.FertilizeEveryDays, hour)
	case "mist":
		plant.MistNextAt = care.NextDueAt(now, positive(plant.MistEveryDays, 2), hour)
	case "rotate":
		plant.RotateNextAt = care.NextDueAt(now, positive(plant.RotateEveryDays, 14), hour)
	case "repot":
		plant.RepotNextAt = care.NextDueAt(now, positive(plant.RepotEveryDays, 365), hour)
	case "prune":
		plant.PruneNextAt = care.NextDueAt(now, positive(plant.PruneEveryDays, 90), hour)
	default:
		httpjson.Error(w, http.StatusBadRequest, "unknown care task")
		return
	}
	if err := h.DB.WithContext(r.Context()).Save(&plant).Error; err != nil {
		log.Printf("[PLANTS] mark %s: %v", kind, err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to update the reminder")
		return
	}
	httpjson.JSON(w, http.StatusOK, h.presentPlants(r, claims.UserID, []models.OwnedPlant{plant})[0])
}

func (h *Handler) AddPlantHealth(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	plant, ok := h.ownedPlant(w, r, claims.UserID)
	if !ok {
		return
	}
	var req struct {
		Status   string `json:"status"`
		Notes    string `json:"notes"`
		PhotoURL string `json:"photoUrl"`
	}
	if !httpjson.Decode(w, r, &req) {
		return
	}
	status := strings.ToLower(strings.TrimSpace(req.Status))
	if !healthStatuses[status] {
		httpjson.Error(w, http.StatusBadRequest, "choose a health status")
		return
	}
	notes := strings.TrimSpace(req.Notes)
	if len(notes) > 1000 {
		notes = notes[:1000]
	}
	entry := models.PlantHealthLog{
		OwnedPlantID: plant.ID,
		UserID:       claims.UserID,
		Status:       status,
		Notes:        notes,
		PhotoURL:     clipText(req.PhotoURL, 500),
		RecordedAt:   time.Now(),
	}
	if status == "stressed" || status == "yellowing" || status == "pests" || status == "wilting" {
		follow := care.NextDueAt(time.Now(), 7, h.reminderHour(r.Context(), claims.UserID))
		entry.FollowUpAt = follow
		uid := claims.UserID
		pid := plant.ID
		h.pushNotice(r.Context(), &uid, "health", "Check on "+plant.Name,
			"It was logged as "+status+". Look again in a week.",
			"/my-plants/"+strconv.FormatUint(uint64(plant.ID), 10),
			"health:"+strconv.FormatUint(uint64(plant.ID), 10)+":"+follow.Format("2006-01-02"), nil, nil, &pid)
	}
	if err := h.DB.WithContext(r.Context()).Create(&entry).Error; err != nil {
		log.Printf("[PLANTS] health: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to save the health note")
		return
	}
	httpjson.JSON(w, http.StatusCreated, entry)
}

func (h *Handler) ownedPlant(w http.ResponseWriter, r *http.Request, userID uint) (models.OwnedPlant, bool) {
	id, err := strconv.ParseUint(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid plant id")
		return models.OwnedPlant{}, false
	}
	var plant models.OwnedPlant
	err = h.DB.WithContext(r.Context()).
		Where("id = ? AND user_id = ?", id, userID).
		First(&plant).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		httpjson.Error(w, http.StatusNotFound, "plant not found")
		return models.OwnedPlant{}, false
	}
	if err != nil {
		log.Printf("[PLANTS] load: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to load plant")
		return models.OwnedPlant{}, false
	}
	return plant, true
}

func applyPlantBody(plant *models.OwnedPlant, req ownedPlantBody) (string, bool) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return "Enter a name for the plant.", false
	}
	if len(name) > 80 {
		name = name[:80]
	}
	location := strings.TrimSpace(req.Location)
	if len(location) > 80 {
		location = location[:80]
	}
	notes := strings.TrimSpace(req.Notes)
	if len(notes) > 1000 {
		notes = notes[:1000]
	}
	room := strings.ToLower(strings.TrimSpace(req.Room))
	if room != "" && !allowedRooms[room] {
		return "Choose a spot: balcony, living room, bedroom, office, kitchen, outdoor, or other.", false
	}
	plant.Name = name
	plant.Location = location
	plant.Notes = notes
	plant.Room = room
	plant.PhotoURL = clipText(req.PhotoURL, 500)
	plant.ProductSlug = clipText(req.ProductSlug, 180)
	if req.ProductID != nil && *req.ProductID != 0 {
		plant.ProductID = req.ProductID
	}
	if req.WaterEveryDays != nil {
		if *req.WaterEveryDays < 0 || *req.WaterEveryDays > 60 {
			return "Watering interval must be between 0 and 60 days.", false
		}
		plant.WaterEveryDays = *req.WaterEveryDays
	}
	if req.FertilizeEveryDays != nil {
		if *req.FertilizeEveryDays < 0 || *req.FertilizeEveryDays > 180 {
			return "Fertilizing interval must be between 0 and 180 days.", false
		}
		plant.FertilizeEveryDays = *req.FertilizeEveryDays
	}
	if req.WaterReminder != nil {
		plant.WaterReminder = *req.WaterReminder
	}
	if req.FertilizeReminder != nil {
		plant.FertilizeReminder = *req.FertilizeReminder
	}
	if msg, ok := applyInterval(&plant.MistEveryDays, req.MistEveryDays, 30); !ok {
		return msg, false
	}
	if msg, ok := applyInterval(&plant.RotateEveryDays, req.RotateEveryDays, 90); !ok {
		return msg, false
	}
	if msg, ok := applyInterval(&plant.RepotEveryDays, req.RepotEveryDays, 730); !ok {
		return msg, false
	}
	if msg, ok := applyInterval(&plant.PruneEveryDays, req.PruneEveryDays, 365); !ok {
		return msg, false
	}
	if req.MistReminder != nil {
		plant.MistReminder = *req.MistReminder
	}
	if req.RotateReminder != nil {
		plant.RotateReminder = *req.RotateReminder
	}
	if req.RepotReminder != nil {
		plant.RepotReminder = *req.RepotReminder
	}
	if req.PruneReminder != nil {
		plant.PruneReminder = *req.PruneReminder
	}
	return "", true
}

var allowedRooms = map[string]bool{
	"balcony": true, "living room": true, "bedroom": true, "office": true,
	"kitchen": true, "outdoor": true, "other": true,
}

func applyInterval(dest *int, value *int, max int) (string, bool) {
	if value == nil {
		return "", true
	}
	if *value < 0 || *value > max {
		return "That interval is outside the allowed range.", false
	}
	*dest = *value
	return "", true
}

func dueIf(on bool, from time.Time, every, hour int) *time.Time {
	if !on {
		return nil
	}
	return care.NextDueAt(from, every, hour)
}

func reschedule(dest **time.Time, on bool, every, prev int, now time.Time, hour int) {
	if !on || every <= 0 {
		*dest = nil
		return
	}
	if *dest == nil || every != prev {
		*dest = care.NextDueAt(now, every, hour)
	}
}

func positive(value, fallback int) int {
	if value <= 0 {
		return fallback
	}
	return value
}

func (h *Handler) presentPlants(r *http.Request, userID uint, plants []models.OwnedPlant) []ownedPlantView {
	latest := map[uint]string{}
	if len(plants) > 0 {
		var logs []models.PlantHealthLog
		h.DB.WithContext(r.Context()).
			Where("user_id = ?", userID).
			Order("recorded_at DESC").
			Find(&logs)
		for _, log := range logs {
			if _, seen := latest[log.OwnedPlantID]; !seen {
				latest[log.OwnedPlantID] = log.Status
			}
		}
	}
	now := time.Now()
	out := make([]ownedPlantView, 0, len(plants))
	for _, plant := range plants {
		out = append(out, ownedPlantView{
			OwnedPlant:   plant,
			LatestHealth: latest[plant.ID],
			WaterDue:     plant.WaterReminder && care.IsDue(plant.WaterNextAt, now),
			FertilizeDue: plant.FertilizeReminder && care.IsDue(plant.FertilizeNextAt, now),
			MistDue:      plant.MistReminder && care.IsDue(plant.MistNextAt, now),
			RotateDue:    plant.RotateReminder && care.IsDue(plant.RotateNextAt, now),
			RepotDue:     plant.RepotReminder && care.IsDue(plant.RepotNextAt, now),
			PruneDue:     plant.PruneReminder && care.IsDue(plant.PruneNextAt, now),
		})
	}
	return out
}

func (h *Handler) recordDueReminders(r *http.Request, userID uint, plants []models.OwnedPlant) {
	prefs := h.notificationPrefs(r, userID)
	if !prefs.CareReminders {
		return
	}
	now := time.Now()
	for _, plant := range plants {
		if plant.WaterReminder && care.IsDue(plant.WaterNextAt, now) {
			h.ensureCareNotification(r, userID, plant, "watering", plant.WaterNextAt)
		}
		if plant.FertilizeReminder && care.IsDue(plant.FertilizeNextAt, now) {
			h.ensureCareNotification(r, userID, plant, "fertilizing", plant.FertilizeNextAt)
		}
		if plant.MistReminder && care.IsDue(plant.MistNextAt, now) {
			h.ensureCareNotification(r, userID, plant, "mist", plant.MistNextAt)
		}
		if plant.RotateReminder && care.IsDue(plant.RotateNextAt, now) {
			h.ensureCareNotification(r, userID, plant, "rotate", plant.RotateNextAt)
		}
		if plant.RepotReminder && care.IsDue(plant.RepotNextAt, now) {
			h.ensureCareNotification(r, userID, plant, "repot", plant.RepotNextAt)
		}
		if plant.PruneReminder && care.IsDue(plant.PruneNextAt, now) {
			h.ensureCareNotification(r, userID, plant, "prune", plant.PruneNextAt)
		}
	}
	h.recordCareDigest(r, userID, plants)
}

func (h *Handler) ensureCareNotification(r *http.Request, userID uint, plant models.OwnedPlant, kind string, due *time.Time) {
	if due == nil {
		return
	}
	day := care.India(*due).Format("2006-01-02")
	key := strconv.FormatUint(uint64(userID), 10) + ":" + strconv.FormatUint(uint64(plant.ID), 10) + ":" + kind + ":" + day
	title, body := careCopy(plant.Name, kind)
	var existing models.AppNotification
	err := h.DB.WithContext(r.Context()).Unscoped().Where("dedupe_key = ?", key).First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		note := models.AppNotification{
			UserID:       userID,
			Kind:         kind,
			Title:        title,
			Body:         body,
			Href:         "/my-plants/" + strconv.FormatUint(uint64(plant.ID), 10),
			OwnedPlantID: &plant.ID,
			DedupeKey:    key,
		}
		if err := h.DB.WithContext(r.Context()).Create(&note).Error; err != nil {
			log.Printf("[PLANTS] reminder: %v", err)
		}
		return
	}
	if err != nil {
		log.Printf("[PLANTS] reminder lookup: %v", err)
		return
	}
	if existing.DeletedAt.Valid {
		if err := h.DB.WithContext(r.Context()).Unscoped().Model(&existing).Updates(map[string]any{
			"deleted_at": nil,
			"read_at":    nil,
			"title":      title,
			"body":       body,
		}).Error; err != nil {
			log.Printf("[PLANTS] reminder restore: %v", err)
		}
	}
}

func careCopy(name, kind string) (string, string) {
	switch kind {
	case "fertilizing":
		return "Feed " + name, "A light feed is due. Skip it if the plant looks stressed or the soil is still wet."
	case "mist":
		return "Mist " + name, "A light mist helps if the air is dry. Skip it when the leaves are already wet."
	case "rotate":
		return "Rotate " + name, "Turn the pot a quarter turn so each side gets light."
	case "repot":
		return "Repot " + name, "Check whether roots are circling the pot. Mild weather is the easiest time."
	case "prune":
		return "Prune " + name, "Remove dead or crowded growth. Keep the shape open so air can move through."
	default:
		return "Water " + name, "Check the soil, then water if the top few centimetres are dry."
	}
}

func (h *Handler) recordCareDigest(r *http.Request, userID uint, plants []models.OwnedPlant) {
	now := time.Now()
	year, week := care.India(now).ISOWeek()
	due := 0
	for _, plant := range plants {
		if plant.WaterReminder && care.IsDue(plant.WaterNextAt, now.AddDate(0, 0, 7)) {
			due++
		}
		if plant.FertilizeReminder && care.IsDue(plant.FertilizeNextAt, now.AddDate(0, 0, 7)) {
			due++
		}
	}
	if due == 0 {
		return
	}
	uid := userID
	h.pushNotice(r.Context(), &uid, "digest", "This week's plant care",
		strconv.Itoa(due)+" watering or feeding tasks are coming up.",
		"/my-plants/calendar", fmt.Sprintf("digest:%d-w%d", year, week), nil, nil, nil)
	advice := care.For(care.India(now))
	if advice.Season == care.Monsoon || advice.Season == care.Winter || advice.Season == care.PostMonsoon {
		h.pushNotice(r.Context(), &uid, "care", advice.Title, advice.Tasks[0], "/care-guides",
			"season:"+string(advice.Season)+":"+strconv.Itoa(year), nil, nil, nil)
	}
}
