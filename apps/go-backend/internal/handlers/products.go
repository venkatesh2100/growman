package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/cache"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	paginationpkg "github.com/venkatesh2100/growman/apps/go-backend/pkg/pagination"
	"golang.org/x/sync/errgroup"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type cachedPage struct {
	Data       []models.Product             `json:"data"`
	Pagination paginationpkg.PaginationMeta `json:"pagination"`
}

// ListProducts returns paginated products with Redis/L1 caching.
func (h *Handler) ListProducts(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	paginationParams := paginationpkg.ParsePagination(r)
	key := fmt.Sprintf("%sp%d:s%d", cache.KeyPrefixProductList, paginationParams.Page, paginationParams.PageSize)

	raw, err := h.Cache.GetOrLoadRaw(ctx, key, 10*time.Minute, func() ([]byte, error) {
		var total int64
		var products []models.Product
		g, gctx := errgroup.WithContext(ctx)
		g.Go(func() error {
			return h.db(gctx).Model(&models.Product{}).Count(&total).Error
		})
		g.Go(func() error {
			return h.productCardQuery(gctx).
				Order("created_at DESC").
				Offset(paginationParams.Offset).
				Limit(paginationParams.PageSize).
				Find(&products).Error
		})
		if err := g.Wait(); err != nil {
			return nil, err
		}
		h.ResolveProductImageURLsSlice(products)
		return json.Marshal(cachedPage{
			Data:       products,
			Pagination: paginationpkg.BuildPaginationMeta(paginationParams.Page, paginationParams.PageSize, total),
		})
	})
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch products")
		return
	}
	cache.ServePublic(w, r, raw)
}

// GetProduct returns a single product with relationships.
func (h *Handler) GetProduct(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if slug == "" || utf8.RuneCountInString(slug) > 180 {
		httpjson.Error(w, http.StatusBadRequest, "invalid slug")
		return
	}
	ctx := r.Context()
	key := cache.KeyPrefixProductDetail + slug

	raw, err := h.Cache.GetOrLoadRaw(ctx, key, cache.ProductDetailTTL, func() ([]byte, error) {
		product, err := h.loadProductDetail(ctx, slug)
		if err != nil {
			return nil, err
		}
		h.ResolveProductImageURLs(product)
		return json.Marshal(product)
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			httpjson.Error(w, http.StatusNotFound, "product not found")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch product")
		return
	}
	cache.ServePublic(w, r, raw)
}

// loadProductDetail fetches the product row, then loads associations in parallel
// to avoid stacked remote-DB round trips from sequential GORM Preloads.
func (h *Handler) loadProductDetail(ctx context.Context, slug string) (*models.Product, error) {
	var product models.Product
	if err := h.db(ctx).Where("slug = ?", slug).Take(&product).Error; err != nil {
		return nil, err
	}

	g, gctx := errgroup.WithContext(ctx)
	var sizes []models.ProductSize
	var attrs []models.Attribute
	var reviews []models.Review
	var category models.Category
	var subcategory *models.Subcategory
	var brand *models.Brand

	g.Go(func() error {
		return h.db(gctx).Where("product_id = ?", product.ID).Find(&sizes).Error
	})
	g.Go(func() error {
		return h.db(gctx).Where("product_id = ?", product.ID).Find(&attrs).Error
	})
	g.Go(func() error {
		return h.db(gctx).
			Where("product_id = ?", product.ID).
			Order("created_at DESC").
			Limit(12).
			Find(&reviews).Error
	})
	if product.CategoryID > 0 {
		g.Go(func() error {
			return h.db(gctx).Select("id", "name", "slug", "description").
				Where("id = ?", product.CategoryID).Take(&category).Error
		})
	}
	if product.SubcategoryID != nil && *product.SubcategoryID > 0 {
		subID := *product.SubcategoryID
		g.Go(func() error {
			var sub models.Subcategory
			if err := h.db(gctx).Select("id", "name", "slug", "category_id").
				Where("id = ?", subID).Take(&sub).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return nil
				}
				return err
			}
			subcategory = &sub
			return nil
		})
	}
	if product.BrandID != nil && *product.BrandID > 0 {
		brandID := *product.BrandID
		g.Go(func() error {
			var b models.Brand
			if err := h.db(gctx).Select("id", "name", "slug").
				Where("id = ?", brandID).Take(&b).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return nil
				}
				return err
			}
			brand = &b
			return nil
		})
	}

	if err := g.Wait(); err != nil {
		return nil, err
	}

	if len(reviews) > 0 {
		userIDs := make([]uint, 0, len(reviews))
		seen := make(map[uint]struct{}, len(reviews))
		for _, rev := range reviews {
			if _, ok := seen[rev.UserID]; ok {
				continue
			}
			seen[rev.UserID] = struct{}{}
			userIDs = append(userIDs, rev.UserID)
		}
		var users []models.User
		if err := h.db(ctx).Select("id", "name").Where("id IN ?", userIDs).Find(&users).Error; err == nil {
			byID := make(map[uint]models.User, len(users))
			for _, u := range users {
				byID[u.ID] = u
			}
			for i := range reviews {
				if u, ok := byID[reviews[i].UserID]; ok {
					reviews[i].User = u
				}
			}
		}
	}

	product.Sizes = sizes
	product.Attributes = attrs
	product.Reviews = reviews
	product.Category = category
	product.Subcategory = subcategory
	product.Brand = brand
	return &product, nil
}

// CreateProductRequest represents the product creation request with optional new category/subcategory
type CreateProductRequest struct {
	models.Product
	NewCategory    string `json:"newCategory,omitempty"`
	NewSubcategory string `json:"newSubcategory,omitempty"`
}

// CreateProduct creates a new product and invalidates relevant caches.
func (h *Handler) CreateProduct(w http.ResponseWriter, r *http.Request) {
	var req CreateProductRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid payload")
		return
	}

	ctx := r.Context()

	if req.NewCategory != "" && req.CategoryID == 0 {
		categorySlug := generateSlug(req.NewCategory)
		category := models.Category{
			Name:        req.NewCategory,
			Slug:        categorySlug,
			Description: "",
		}
		if err := h.db(ctx).Where("slug = ?", categorySlug).FirstOrCreate(&category).Error; err != nil {
			log.Printf("[DB] Error creating/finding category: %v", err)
			httpjson.Error(w, http.StatusInternalServerError, "failed to create category")
			return
		}
		if category.Name != req.NewCategory {
			h.db(ctx).Model(&category).Update("name", req.NewCategory)
		}
		req.CategoryID = category.ID
	}

	if req.NewSubcategory != "" && req.CategoryID > 0 {
		subcategorySlug := generateSlug(req.NewSubcategory)
		subcategory := models.Subcategory{
			Name:       req.NewSubcategory,
			Slug:       subcategorySlug,
			CategoryID: req.CategoryID,
		}
		if err := h.db(ctx).Where("slug = ? AND category_id = ?", subcategorySlug, req.CategoryID).FirstOrCreate(&subcategory).Error; err != nil {
			log.Printf("[DB] Error creating/finding subcategory: %v", err)
			httpjson.Error(w, http.StatusInternalServerError, "failed to create subcategory")
			return
		}
		if subcategory.Name != req.NewSubcategory {
			h.db(ctx).Model(&subcategory).Update("name", req.NewSubcategory)
		}
		req.SubcategoryID = &subcategory.ID
	}

	if req.CategoryID == 0 {
		httpjson.Error(w, http.StatusBadRequest, "categoryId is required")
		return
	}

	var category models.Category
	if err := h.db(ctx).Where("id = ?", req.CategoryID).First(&category).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			httpjson.Error(w, http.StatusBadRequest, "category not found")
			return
		}
		log.Printf("[DB] Error verifying category: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to verify category")
		return
	}

	if req.SubcategoryID != nil {
		var subcategory models.Subcategory
		if err := h.db(ctx).Where("id = ? AND category_id = ?", *req.SubcategoryID, req.CategoryID).First(&subcategory).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				httpjson.Error(w, http.StatusBadRequest, "subcategory not found or doesn't belong to category")
				return
			}
			log.Printf("[DB] Error verifying subcategory: %v", err)
			httpjson.Error(w, http.StatusInternalServerError, "failed to verify subcategory")
			return
		}
	}

	if err := h.db(ctx).Create(&req.Product).Error; err != nil {
		log.Printf("[DB] Error creating product: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to create product")
		return
	}

	h.invalidateCatalog(ctx)
	httpjson.JSON(w, http.StatusCreated, req.Product)
}

func generateSlug(name string) string {
	slug := strings.ToLower(name)
	slug = strings.ReplaceAll(slug, " ", "-")
	slug = strings.ReplaceAll(slug, "_", "-")
	var result strings.Builder
	for _, r := range slug {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			result.WriteRune(r)
		}
	}
	return result.String()
}

// UpdateProduct updates a product and invalidates relevant caches.
func (h *Handler) UpdateProduct(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	ctx := r.Context()
	var existing models.Product
	if err := h.db(ctx).Where("slug = ?", slug).First(&existing).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "product not found")
		return
	}

	var input models.Product
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid payload")
		return
	}

	input.ID = existing.ID
	if err := h.db(ctx).Session(&gorm.Session{FullSaveAssociations: true}).Save(&input).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to update product")
		return
	}

	h.invalidateCatalog(ctx)
	httpjson.JSON(w, http.StatusOK, input)
}

// DeleteProduct deletes a product and invalidates relevant caches.
func (h *Handler) DeleteProduct(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	ctx := r.Context()
	if err := h.db(ctx).Where("slug = ?", slug).Delete(&models.Product{}).Error; err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to delete product")
		return
	}
	h.invalidateCatalog(ctx)
	httpjson.JSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// RelatedProducts returns related products for a given product.
func (h *Handler) RelatedProducts(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	ctx := r.Context()
	key := cache.KeyPrefixRelatedProducts + slug

	raw, err := h.Cache.GetOrLoadRaw(ctx, key, cache.RelatedProductsTTL, func() ([]byte, error) {
		var product models.Product
		if err := h.db(ctx).Select("id", "slug", "category_id").Where("slug = ?", slug).Take(&product).Error; err != nil {
			return nil, err
		}
		var related []models.Product
		if err := h.productCardQuery(ctx).
			Where("category_id = ? AND slug <> ?", product.CategoryID, slug).
			Order("created_at DESC").
			Limit(4).
			Find(&related).Error; err != nil {
			return nil, err
		}
		h.ResolveProductImageURLsSlice(related)
		return json.Marshal(related)
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			httpjson.Error(w, http.StatusNotFound, "product not found")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch related products")
		return
	}
	cache.ServePublic(w, r, raw)
}

// FeaturedProducts returns paginated featured products.
func (h *Handler) FeaturedProducts(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	paginationParams := paginationpkg.ParsePagination(r)
	key := fmt.Sprintf("%s:page:%d:size:%d", cache.KeyPrefixFeaturedProducts, paginationParams.Page, paginationParams.PageSize)

	raw, err := h.Cache.GetOrLoadRaw(ctx, key, cache.FeaturedProductsTTL, func() ([]byte, error) {
		var products []models.Product
		// Fetch pageSize+1 to know hasNext without a separate COUNT round-trip.
		limit := paginationParams.PageSize + 1
		if err := h.productCardQuery(ctx).
			Where("featured = ?", true).
			Order("created_at DESC").
			Offset(paginationParams.Offset).
			Limit(limit).
			Find(&products).Error; err != nil {
			return nil, err
		}
		hasNext := len(products) > paginationParams.PageSize
		if hasNext {
			products = products[:paginationParams.PageSize]
		}
		total := int64(paginationParams.Offset + len(products))
		if hasNext {
			total++
		}
		h.ResolveProductImageURLsSlice(products)
		meta := paginationpkg.BuildPaginationMeta(paginationParams.Page, paginationParams.PageSize, total)
		meta.HasNext = hasNext
		return json.Marshal(cachedPage{
			Data:       products,
			Pagination: meta,
		})
	})
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "failed to fetch featured products")
		return
	}
	cache.ServePublic(w, r, raw)
}

// AllProducts is an alias for ListProducts.
func (h *Handler) AllProducts(w http.ResponseWriter, r *http.Request) {
	h.ListProducts(w, r)
}

// SearchProducts searches products by query string with pagination.
func (h *Handler) SearchProducts(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if query == "" {
		httpjson.JSON(w, http.StatusOK, paginationpkg.PaginatedResponse{
			Data:       []models.Product{},
			Pagination: paginationpkg.BuildPaginationMeta(1, 20, 0),
		})
		return
	}
	if utf8.RuneCountInString(query) > 80 {
		query = string([]rune(query)[:80])
	}
	query = strings.ToLower(query)
	escaped := escapeLike(query)
	like := "%" + escaped + "%"
	prefix := escaped + "%"

	ctx := r.Context()
	paginationParams := paginationpkg.ParsePagination(r)
	if paginationParams.PageSize > 40 {
		paginationParams.PageSize = 40
		paginationParams.Offset = (paginationParams.Page - 1) * paginationParams.PageSize
	}
	key := fmt.Sprintf("%s%s:p%d:s%d", cache.KeyPrefixProductSearch, cache.HashKey(query), paginationParams.Page, paginationParams.PageSize)

	raw, err := h.Cache.GetOrLoadRaw(ctx, key, 3*time.Minute, func() ([]byte, error) {
		matchSQL := `
			(
				name ILIKE ? OR short_desc ILIKE ?
				OR EXISTS (SELECT 1 FROM unnest(tags) AS tag WHERE tag ILIKE ?)
				OR EXISTS (SELECT 1 FROM categories WHERE categories.id = products.category_id AND categories.deleted_at IS NULL AND categories.name ILIKE ?)
				OR EXISTS (SELECT 1 FROM brands WHERE brands.id = products.brand_id AND brands.deleted_at IS NULL AND brands.name ILIKE ?)
				OR description ILIKE ?
			)`
		args := []interface{}{like, like, like, like, like, like}
		rankArgs := []interface{}{query, prefix, like, like, like}

		var total int64
		var products []models.Product

		type result struct {
			err error
		}
		countCh := make(chan result, 1)
		findCh := make(chan result, 1)

		go func() {
			err := h.db(ctx).Model(&models.Product{}).
				Where(matchSQL, args...).
				Count(&total).Error
			countCh <- result{err: err}
		}()

		go func() {
			err := h.productCardQuery(ctx).
				Where(matchSQL, args...).
				Order(clause.Expr{
					SQL: `CASE
						WHEN lower(name) = ? THEN 0
						WHEN lower(name) LIKE ? THEN 1
						WHEN name ILIKE ? THEN 2
						WHEN EXISTS (SELECT 1 FROM unnest(tags) AS tag WHERE tag ILIKE ?) THEN 3
						WHEN short_desc ILIKE ? THEN 4
						ELSE 5
					END ASC, created_at DESC`,
					Vars: rankArgs,
				}).
				Offset(paginationParams.Offset).
				Limit(paginationParams.PageSize).
				Find(&products).Error
			findCh <- result{err: err}
		}()

		countRes := <-countCh
		findRes := <-findCh
		if countRes.err != nil {
			return nil, countRes.err
		}
		if findRes.err != nil {
			return nil, findRes.err
		}

		h.ResolveProductImageURLsSlice(products)
		return json.Marshal(cachedPage{
			Data:       products,
			Pagination: paginationpkg.BuildPaginationMeta(paginationParams.Page, paginationParams.PageSize, total),
		})
	})
	if err != nil {
		log.Printf("[DB] Error searching products: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to search products")
		return
	}
	cache.ServePublic(w, r, raw)
}

func escapeLike(s string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return replacer.Replace(s)
}

// InvalidateProductCache clears all product-related cache entries.
func (h *Handler) InvalidateProductCache() error {
	h.invalidateCatalog(context.Background())
	return nil
}
