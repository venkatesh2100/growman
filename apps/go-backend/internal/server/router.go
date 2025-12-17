package server

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	// appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/config"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/handlers"
)

// NewRouter wires all HTTP routes and middleware.
func NewRouter(h *handlers.Handler, cfg config.Config) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.AllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	r.Get("/healthz", h.Health)

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/products", h.ListProducts)
		r.Post("/products", h.CreateProduct)
		r.Get("/products/featured", h.FeaturedProducts)
		r.Get("/products/{slug}", h.GetProduct)
		r.Put("/products/{slug}", h.UpdateProduct)
		r.Delete("/products/{slug}", h.DeleteProduct)
		r.Get("/products/{slug}/related", h.RelatedProducts)

		// r.Get("/categories", h.ListCategories)
		// r.Get("/categories/{slug}", h.GetCategory)
		// r.Get("/categories/{slug}/products", h.ProductsByCategory)
		// r.Get("/categories/{slug}/subcategories", h.ListSubcategories)
		// r.Get("/categories/{slug}/subcategories/{subSlug}/products", h.ProductsBySubcategory)

		// r.Get("/brands", h.ListBrands)
		// r.Get("/tags", h.ListTags)

		// r.Post("/auth/login", h.Login)

		// r.Group(func(pr chi.Router) {
		// 	pr.Use(appauth.AuthMiddleware(cfg.JWTSecret))
		// 	pr.Get("/auth/me", h.Me)
		// })
	})

	return r
}
