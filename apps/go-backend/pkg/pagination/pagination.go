// Package pagination parses page/pageSize query parameters and builds the
// pagination metadata every paginated list endpoint returns alongside its data.
package pagination

import (
	"net/http"
	"strconv"
)

// PaginationParams holds pagination parameters from request
type PaginationParams struct {
	Page     int
	PageSize int
	Offset   int
}

// PaginatedResponse wraps data with pagination metadata
type PaginatedResponse struct {
	Data       any            `json:"data"`
	Pagination PaginationMeta `json:"pagination"`
}

// PaginationMeta contains pagination metadata
type PaginationMeta struct {
	Page       int   `json:"page"`
	PageSize   int   `json:"pageSize"`
	Total      int64 `json:"total"`
	TotalPages int   `json:"totalPages"`
	HasNext    bool  `json:"hasNext"`
	HasPrev    bool  `json:"hasPrev"`
}

// ParsePagination extracts pagination parameters from HTTP request
func ParsePagination(r *http.Request) PaginationParams {
	page := 1
	pageSize := 20 // Default page size

	if p := r.URL.Query().Get("page"); p != "" {
		if parsed, err := strconv.Atoi(p); err == nil && parsed > 0 {
			page = parsed
		}
	}

	if ps := r.URL.Query().Get("pageSize"); ps != "" {
		if parsed, err := strconv.Atoi(ps); err == nil && parsed > 0 {
			// Limit max page size to prevent abuse
			if parsed > 100 {
				parsed = 100
			}
			pageSize = parsed
		}
	}

	offset := (page - 1) * pageSize

	return PaginationParams{
		Page:     page,
		PageSize: pageSize,
		Offset:   offset,
	}
}

// BuildPaginationMeta creates pagination metadata
func BuildPaginationMeta(page, pageSize int, total int64) PaginationMeta {
	totalPages := int((total + int64(pageSize) - 1) / int64(pageSize))
	if totalPages == 0 {
		totalPages = 1
	}

	return PaginationMeta{
		Page:       page,
		PageSize:   pageSize,
		Total:      total,
		TotalPages: totalPages,
		HasNext:    page < totalPages,
		HasPrev:    page > 1,
	}
}
