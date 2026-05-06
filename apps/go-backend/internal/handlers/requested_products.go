package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
)

type CreateRequestedProductRequest struct {
	ProductName    string `json:"productName"`
	Details        string `json:"details"`
	Source         string `json:"source"`
	RequesterName  string `json:"requesterName"`
	RequesterEmail string `json:"requesterEmail"`
	RequesterPhone string `json:"requesterPhone"`
	AdminNotes     string `json:"adminNotes"`
}

func (h *Handler) CreateRequestedProduct(w http.ResponseWriter, r *http.Request) {
	var req CreateRequestedProductRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	name := strings.TrimSpace(req.ProductName)
	if name == "" {
		httpjson.Error(w, http.StatusBadRequest, "productName is required")
		return
	}

	source := strings.TrimSpace(strings.ToLower(req.Source))
	if source == "" {
		source = "manual"
	}

	var requestedByID *uint
	if claims, ok := appauth.FromContext(r.Context()); ok {
		requestedByID = &claims.UserID
	}

	record := models.RequestedProduct{
		ProductName:    name,
		Details:        strings.TrimSpace(req.Details),
		Status:         "pending",
		Source:         source,
		RequestedByID:  requestedByID,
		RequesterName:  strings.TrimSpace(req.RequesterName),
		RequesterEmail: strings.TrimSpace(req.RequesterEmail),
		RequesterPhone: strings.TrimSpace(req.RequesterPhone),
		AdminNotes:     strings.TrimSpace(req.AdminNotes),
	}

	if err := h.DB.Create(&record).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to save requested product")
		return
	}

	httpjson.JSON(w, http.StatusCreated, record)
}

func (h *Handler) ListRequestedProducts(w http.ResponseWriter, r *http.Request) {
	claims, ok := appauth.FromContext(r.Context())
	if !ok {
		httpjson.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if claims.Role != "admin" && claims.Role != "superadmin" {
		httpjson.Error(w, http.StatusForbidden, "admin access required")
		return
	}

	status := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("status")))
	query := h.DB.Model(&models.RequestedProduct{}).Order("created_at DESC")
	if status != "" {
		query = query.Where("status = ?", status)
	}

	var rows []models.RequestedProduct
	if err := query.Limit(200).Find(&rows).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch requested products")
		return
	}

	httpjson.JSON(w, http.StatusOK, rows)
}
