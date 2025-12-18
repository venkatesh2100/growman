package handlers

import (
	"net/http"

	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
)

func (h *Handler) ListTags(w http.ResponseWriter, r *http.Request) {
	var tags []string
	rows, err := h.DB.Model(&models.Product{}).Select("unnest(tags)").Rows()
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch tags")
		return
	}
	defer rows.Close()

	tagSet := map[string]struct{}{}
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err == nil {
			tagSet[t] = struct{}{}
		}
	}

	for t := range tagSet {
		tags = append(tags, t)
	}

	httpjson.JSON(w, http.StatusOK, tags)
}
