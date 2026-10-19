package handlers

import (
	"context"
	"log"
	"net/http"
	"strings"
	"time"

	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/middlewares"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"gorm.io/gorm"
)

// DPDP Act compliance
//
// India's DPDP Rules 2025 require granular consent, a data-access right, a
// right to erasure, and purpose-limited retention. Two rules shape the
// implementation here and pull in opposite directions:
//
//   - Rule 8(3): transactional personal data and processing logs must be
//     retained for at least one year from the date of processing, *even if
//     the user deletes their account*.
//   - Section 8(7): data must be erased once its purpose is served.
//
// So erasure is not a blanket delete. Account-level identifiers are
// scrubbed immediately, while order records are retained — with contact
// details minimised — until the statutory year has passed, after which the
// retention sweep removes them.

// NoticeVersion identifies the privacy notice a consent was given
// against. Bump it whenever the notice materially changes: consent to an
// old notice does not carry forward.
// erasedUserName is the tombstone written over an erased account's name.
// Declared once because the retention sweep matches on it to find rows it
// has already scrubbed, and anywhere a name is displayed has to recognise
// it rather than treat it as a real name.
const erasedUserName = "Deleted user"

const NoticeVersion = "2026-01"

// transactionalRetention is the Rule 8(3) floor for order data and
// processing logs.
const transactionalRetention = 365 * 24 * time.Hour

// validConsentPurposes are the granular purposes a data principal can
// agree to or withdraw independently. "essential" covers what is needed to
// run the shop (taking an order, delivering it) and cannot be withdrawn
// while an order is open.
var validConsentPurposes = map[string]bool{
	"essential":       true,
	"analytics":       true,
	"marketing":       true,
	"personalisation": true,
}

// RecordConsent stores a consent grant or withdrawal. Public, because
// consent is captured before sign-in (the cookie banner on first visit).
//
// Withdrawal is recorded as a new row rather than by mutating the original
// grant, so the history of what was agreed and when is never lost — which
// is the part an audit actually asks for.
func (h *Handler) RecordConsent(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
		// Purposes maps purpose -> granted.
		Purposes map[string]bool `json:"purposes"`
	}
	if !httpjson.Decode(w, r, &req) {
		return
	}
	if len(req.Purposes) == 0 {
		httpjson.Error(w, http.StatusBadRequest, "at least one purpose is required")
		return
	}

	var userID *uint
	if claims, ok := appauth.FromContext(r.Context()); ok {
		userID = &claims.UserID
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if userID == nil && email == "" {
		// Anonymous consent is still worth recording against the visitor's
		// IP: without any identity we cannot honour a later withdrawal.
		log.Printf("[CONSENT] anonymous consent recorded without identity")
	}

	ip := middlewares.ClientIP(r)
	userAgent := r.Header.Get("User-Agent")
	if len(userAgent) > 500 {
		userAgent = userAgent[:500]
	}

	records := make([]models.ConsentRecord, 0, len(req.Purposes))
	for purpose, granted := range req.Purposes {
		if !validConsentPurposes[purpose] {
			httpjson.Error(w, http.StatusBadRequest, "unknown consent purpose: "+purpose)
			return
		}
		records = append(records, models.ConsentRecord{
			UserID:        userID,
			Email:         email,
			Purpose:       purpose,
			Granted:       granted,
			NoticeVersion: NoticeVersion,
			IP:            ip,
			UserAgent:     userAgent,
		})
	}

	if err := h.DB.WithContext(r.Context()).Create(&records).Error; err != nil {
		log.Printf("[CONSENT] record: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to record consent")
		return
	}

	httpjson.JSON(w, http.StatusOK, map[string]any{
		"success":       true,
		"noticeVersion": NoticeVersion,
	})
}

// ExportMyData answers the DPDP right of access with everything held about
// the requesting data principal.
func (h *Handler) ExportMyData(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	ctx := r.Context()

	var user models.User
	if err := h.DB.WithContext(ctx).First(&user, claims.UserID).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "account not found")
		return
	}

	var orders []models.Order
	if err := h.DB.WithContext(ctx).Preload("Items").
		Where("user_id = ?", claims.UserID).Order("created_at DESC").
		Find(&orders).Error; err != nil {
		log.Printf("[PRIVACY] export orders: %v", err)
	}

	var addresses []models.Address
	h.DB.WithContext(ctx).Where("user_id = ?", claims.UserID).Find(&addresses)

	var reviews []models.Review
	h.DB.WithContext(ctx).Where("user_id = ?", claims.UserID).Find(&reviews)

	var wishlist []models.Wishlist
	h.DB.WithContext(ctx).Preload("Product", func(db *gorm.DB) *gorm.DB {
		return db.Select("id, name, slug")
	}).Where("user_id = ?", claims.UserID).Find(&wishlist)

	var consents []models.ConsentRecord
	h.DB.WithContext(ctx).Where("user_id = ? OR email = ?", claims.UserID, user.Email).
		Order("created_at DESC").Find(&consents)

	var supportRequests []models.OrderSupportRequest
	h.DB.WithContext(ctx).Where("user_id = ?", claims.UserID).Find(&supportRequests)

	var ownedPlants []models.OwnedPlant
	h.DB.WithContext(ctx).Where("user_id = ?", claims.UserID).Find(&ownedPlants)
	var healthLogs []models.PlantHealthLog
	h.DB.WithContext(ctx).Where("user_id = ?", claims.UserID).Find(&healthLogs)
	var notificationPrefs []models.NotificationPreference
	h.DB.WithContext(ctx).Where("user_id = ?", claims.UserID).Find(&notificationPrefs)
	var savedItems []models.SavedItem
	h.DB.WithContext(ctx).Where("user_id = ?", claims.UserID).Find(&savedItems)
	var paymentMethods []models.SavedPaymentMethod
	h.DB.WithContext(ctx).Where("user_id = ?", claims.UserID).Find(&paymentMethods)
	var chatTurns []models.ChatTurn
	h.DB.WithContext(ctx).Where("user_id = ?", claims.UserID).Find(&chatTurns)

	w.Header().Set("Content-Disposition", `attachment; filename="growman-my-data.json"`)
	httpjson.JSON(w, http.StatusOK, map[string]any{
		"exportedAt":    time.Now(),
		"noticeVersion": NoticeVersion,
		"account": map[string]any{
			"id":        user.ID,
			"name":      user.Name,
			"email":     user.Email,
			"phone":     user.Phone,
			"role":      user.Role,
			"createdAt": user.CreatedAt,
		},
		"orders":                  orders,
		"addresses":               addresses,
		"reviews":                 reviews,
		"wishlist":                wishlist,
		"consentHistory":          consents,
		"supportRequests":         supportRequests,
		"plants":                  ownedPlants,
		"plantHealth":             healthLogs,
		"notificationPreferences": notificationPrefs,
		"savedItems":              savedItems,
		"paymentMethods":          paymentMethods,
		"chatHistory":             chatTurns,
		"retentionNotice":         "Order records and processing logs are retained for at least one year from the date of the transaction, as required by Rule 8(3) of the DPDP Rules 2025, even after an account is deleted.",
	})
}

// RequestErasure honours the right to erasure within the statutory
// retention floor: account identifiers are scrubbed now, order records are
// minimised and retained for the mandated year, then removed by the sweep.
func (h *Handler) RequestErasure(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}

	var user models.User
	if err := h.DB.WithContext(r.Context()).First(&user, claims.UserID).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "account not found")
		return
	}

	// An open order needs its address to be delivered, so erasure waits.
	var openOrders int64
	if err := h.DB.WithContext(r.Context()).Model(&models.Order{}).
		Where("user_id = ? AND payment_status = ? AND delivered_at IS NULL AND cancelled_at IS NULL",
			claims.UserID, "paid").
		Count(&openOrders).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to check open orders")
		return
	}
	if openOrders > 0 {
		httpjson.JSON(w, http.StatusConflict, map[string]any{
			"error":  "open_orders",
			"reason": "You have an order still in transit. We need your delivery details until it arrives — please request erasure once it's been delivered.",
		})
		return
	}

	erasedAt := time.Now()
	if err := h.DB.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		// Scrub account identifiers. The row is kept as a tombstone so
		// order foreign keys stay valid for the retention period.
		if err := tx.Model(&models.User{}).Where("id = ?", user.ID).Updates(map[string]any{
			"name":     erasedUserName,
			"email":    gorm.Expr("CONCAT('erased-', id, '@deleted.invalid')"),
			"phone":    gorm.Expr("CONCAT('erased-', id)"),
			"password": "",
		}).Error; err != nil {
			return err
		}

		// Saved addresses serve no retained purpose — delete outright.
		if err := tx.Unscoped().Where("user_id = ?", user.ID).Delete(&models.Address{}).Error; err != nil {
			return err
		}
		// Reviews are anonymised rather than deleted: the content is
		// useful to other shoppers and is no longer personal data once
		// detached from an identity.
		if err := tx.Model(&models.Review{}).Where("user_id = ?", user.ID).
			UpdateColumn("verified_purchase", false).Error; err != nil {
			return err
		}
		if err := tx.Unscoped().Where("user_id = ?", user.ID).Delete(&models.Wishlist{}).Error; err != nil {
			return err
		}
		if err := tx.Unscoped().Where("user_id = ?", user.ID).Delete(&models.BackInStockRequest{}).Error; err != nil {
			return err
		}
		if err := tx.Unscoped().Where("user_id = ?", user.ID).Delete(&models.PlantHealthLog{}).Error; err != nil {
			return err
		}
		if err := tx.Unscoped().Where("user_id = ?", user.ID).Delete(&models.AppNotification{}).Error; err != nil {
			return err
		}
		if err := tx.Unscoped().Where("user_id = ?", user.ID).Delete(&models.OwnedPlant{}).Error; err != nil {
			return err
		}
		if err := tx.Unscoped().Where("user_id = ?", user.ID).Delete(&models.NotificationPreference{}).Error; err != nil {
			return err
		}
		for _, model := range []any{
			&models.SavedItem{}, &models.StoreCredit{}, &models.CreditEntry{},
			&models.SavedPaymentMethod{}, &models.RecentView{}, &models.CartSnapshot{},
			&models.ChatTurn{}, &models.QuoteRequest{},
		} {
			if err := tx.Unscoped().Where("user_id = ?", user.ID).Delete(model).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&models.User{}).Where("referred_by = ?", user.ID).Update("referred_by", nil).Error; err != nil {
			return err
		}

		// Minimise retained order data: drop the contact details, keep the
		// transaction record Rule 8(3) requires.
		if err := tx.Model(&models.Order{}).Where("user_id = ?", user.ID).Updates(map[string]any{
			"customer_name":  erasedUserName,
			"customer_email": "",
			"customer_phone": "",
			"client_ip":      "",
			"user_agent":     "",
		}).Error; err != nil {
			return err
		}

		// Record the erasure itself as a consent event.
		return tx.Create(&models.ConsentRecord{
			UserID:        &user.ID,
			Purpose:       "essential",
			Granted:       false,
			NoticeVersion: NoticeVersion,
			IP:            middlewares.ClientIP(r),
		}).Error
	}); err != nil {
		log.Printf("[PRIVACY] erasure for user %d: %v", user.ID, err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to process erasure request")
		return
	}

	log.Printf("[PRIVACY] erasure completed for user %d at %s", user.ID, erasedAt.Format(time.RFC3339))
	h.notifyMerchantAsync(
		"Data erasure request completed",
		"A customer exercised their DPDP right to erasure. Account identifiers have been scrubbed; order records are retained in minimised form for the statutory one-year period.")

	httpjson.JSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "Your personal details have been erased. Order records are kept in minimised form for one year, as the law requires, and then deleted.",
	})
}

// SweepExpiredData enforces purpose-limited retention: it removes
// transactional data past the Rule 8(3) one-year floor for accounts that
// have been erased, and clears stale operational rows that no longer serve
// their purpose.
func (h *Handler) SweepExpiredData(ctx context.Context) error {
	cutoff := time.Now().Add(-transactionalRetention)

	// Orders belonging to erased accounts, past the retention floor.
	res := h.DB.WithContext(ctx).Unscoped().
		Where(`created_at < ? AND customer_email = '' AND customer_name = ?`, cutoff, erasedUserName).
		Delete(&models.Order{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected > 0 {
		log.Printf("[PRIVACY] retention sweep removed %d expired order record(s)", res.RowsAffected)
	}

	// Processing logs: webhook events past the one-year floor.
	if err := h.DB.WithContext(ctx).Unscoped().
		Where("created_at < ?", cutoff).
		Delete(&models.WebhookEvent{}).Error; err != nil {
		return err
	}

	// Verified OTP-era waitlist and back-in-stock rows that were notified
	// long ago have served their purpose.
	if err := h.DB.WithContext(ctx).Unscoped().
		Where("notified_at IS NOT NULL AND notified_at < ?", cutoff).
		Delete(&models.BackInStockRequest{}).Error; err != nil {
		return err
	}

	return nil
}

// StartRetentionSweeper runs SweepExpiredData daily until ctx is cancelled.
func (h *Handler) StartRetentionSweeper(ctx context.Context) {
	ticker := time.NewTicker(24 * time.Hour)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := h.SweepExpiredData(ctx); err != nil {
					log.Printf("[PRIVACY] retention sweep: %v", err)
				}
			}
		}
	}()
}
