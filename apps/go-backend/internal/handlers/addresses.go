package handlers

import (
	"log"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"gorm.io/gorm"
)

// maxSavedAddresses bounds the address book. Generous for a household,
// low enough that the list stays usable and cannot be abused as storage.
const maxSavedAddresses = 10

// ListAddresses returns the signed-in customer's saved addresses, default
// first.
func (h *Handler) ListAddresses(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}

	var addresses []models.Address
	if err := h.DB.WithContext(r.Context()).
		Where("user_id = ?", claims.UserID).
		Order("is_default DESC, updated_at DESC").
		Find(&addresses).Error; err != nil {
		log.Printf("[ADDRESS] list: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to load addresses")
		return
	}
	httpjson.JSON(w, http.StatusOK, map[string]any{"addresses": addresses})
}

// CreateAddress saves a new shipping address.
func (h *Handler) CreateAddress(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}

	var address models.Address
	if !httpjson.Decode(w, r, &address) {
		return
	}
	if msg, ok := validateAddress(address); !ok {
		httpjson.Error(w, http.StatusBadRequest, msg)
		return
	}

	var count int64
	if err := h.DB.WithContext(r.Context()).Model(&models.Address{}).
		Where("user_id = ?", claims.UserID).Count(&count).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to save address")
		return
	}
	if count >= maxSavedAddresses {
		httpjson.Error(w, http.StatusConflict, "you've reached the saved address limit — delete one first")
		return
	}

	address.ID = 0
	address.UserID = claims.UserID
	// The first address saved is the default by definition.
	if count == 0 {
		address.IsDefault = true
	}

	if err := h.DB.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		if address.IsDefault {
			if err := clearDefaultAddress(tx, claims.UserID); err != nil {
				return err
			}
		}
		return tx.Create(&address).Error
	}); err != nil {
		log.Printf("[ADDRESS] create: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to save address")
		return
	}
	httpjson.JSON(w, http.StatusCreated, address)
}

// UpdateAddress edits one of the customer's own addresses.
func (h *Handler) UpdateAddress(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	id, err := strconv.ParseUint(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid address ID")
		return
	}

	var existing models.Address
	if err := h.DB.WithContext(r.Context()).
		Where("id = ? AND user_id = ?", id, claims.UserID).
		First(&existing).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "address not found")
		return
	}

	var req models.Address
	if !httpjson.Decode(w, r, &req) {
		return
	}
	if msg, ok := validateAddress(req); !ok {
		httpjson.Error(w, http.StatusBadRequest, msg)
		return
	}

	if err := h.DB.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		if req.IsDefault && !existing.IsDefault {
			if err := clearDefaultAddress(tx, claims.UserID); err != nil {
				return err
			}
		}
		// Coordinates are only overwritten when the request actually
		// carries them. They are captured by "Use my location" and are
		// what makes the delivery quote precise, so a client that edits a
		// label or sets the default without echoing them back must not
		// silently discard a position the customer already gave us.
		fields := []string{
			"label", "name", "phone", "address_line", "city", "state",
			"pincode", "is_default",
		}
		if req.Latitude != nil || req.Longitude != nil {
			fields = append(fields, "latitude", "longitude")
		}
		return tx.Model(&existing).Select(fields).Updates(req).Error
	}); err != nil {
		log.Printf("[ADDRESS] update: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to update address")
		return
	}

	existing.UserID = claims.UserID
	httpjson.JSON(w, http.StatusOK, existing)
}

// DeleteAddress removes a saved address, promoting another to default if
// the deleted one held that role.
func (h *Handler) DeleteAddress(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.Require(w, r)
	if !ok {
		return
	}
	id, err := strconv.ParseUint(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid address ID")
		return
	}

	var existing models.Address
	if err := h.DB.WithContext(r.Context()).
		Where("id = ? AND user_id = ?", id, claims.UserID).
		First(&existing).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "address not found")
		return
	}

	if err := h.DB.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&models.Address{}, existing.ID).Error; err != nil {
			return err
		}
		if !existing.IsDefault {
			return nil
		}
		// Promote the most recently used remaining address.
		var next models.Address
		err := tx.Where("user_id = ?", claims.UserID).
			Order("updated_at DESC").First(&next).Error
		if err == gorm.ErrRecordNotFound {
			return nil
		}
		if err != nil {
			return err
		}
		return tx.Model(&models.Address{}).Where("id = ?", next.ID).
			UpdateColumn("is_default", true).Error
	}); err != nil {
		log.Printf("[ADDRESS] delete: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to delete address")
		return
	}
	httpjson.JSON(w, http.StatusOK, map[string]any{"success": true})
}

func clearDefaultAddress(tx *gorm.DB, userID uint) error {
	return tx.Model(&models.Address{}).
		Where("user_id = ? AND is_default = true", userID).
		UpdateColumn("is_default", false).Error
}

func validateAddress(address models.Address) (string, bool) {
	switch {
	case address.Name == "":
		return "name is required", false
	case !phoneRegex.MatchString(address.Phone):
		return "invalid phone number format", false
	case address.AddressLine == "":
		return "address is required", false
	case address.City == "":
		return "city is required", false
	// Required because Shiprocket rejects a booking without it, so an
	// address saved without a state would fail at dispatch rather than
	// here, where the customer can still fix it.
	case address.State == "":
		return "state is required", false
	case !pincodeRegex.MatchString(address.Pincode):
		return "invalid pincode format", false
	}
	return "", true
}
