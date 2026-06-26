package handlers

import (
	"net/http"
	"sort"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
)

type catalogResponse struct {
	Tags       []string           `json:"tags"`
	Categories []models.Category  `json:"categories"`
}

func (h *Handler) listProductTags() ([]string, error) {
	rows, err := h.DB.Model(&models.Product{}).Select("unnest(tags)").Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tagSet := map[string]struct{}{}
	for rows.Next() {
		var tag string
		if err := rows.Scan(&tag); err == nil && tag != "" {
			tagSet[tag] = struct{}{}
		}
	}

	tags := make([]string, 0, len(tagSet))
	for tag := range tagSet {
		tags = append(tags, tag)
	}
	sort.Strings(tags)
	return tags, nil
}

// ListTags returns unique product tags sorted alphabetically.
func (h *Handler) ListTags(w http.ResponseWriter, r *http.Request) {
	tags, err := h.listProductTags()
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch tags")
		return
	}
	httpjson.JSON(w, http.StatusOK, tags)
}

// ListCatalog returns tags and categories in one response for navbar/shop filters.
func (h *Handler) ListCatalog(w http.ResponseWriter, r *http.Request) {
	tags, err := h.listProductTags()
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch tags")
		return
	}

	var categories []models.Category
	if err := h.DB.Preload("Subcategories").Order("name asc").Find(&categories).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch categories")
		return
	}

	httpjson.JSON(w, http.StatusOK, catalogResponse{
		Tags:       tags,
		Categories: categories,
	})
}
