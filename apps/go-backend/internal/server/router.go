package server

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
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

	// Webhook routes (outside /api/v1, no auth required)
	r.Post("/webhooks/razorpay", h.RazorpayWebhook)

	r.Route("/api/v1", func(r chi.Router) {
		r.Route("/products", func(r chi.Router) {
			r.Get("/", h.ListProducts)
			r.Get("/search", h.SearchProducts)
			r.Get("/featured", h.FeaturedProducts)
			r.Post("/", h.CreateProduct)
			r.Get("/{slug}", h.GetProduct)
			r.Put("/{slug}", h.UpdateProduct)
			r.Delete("/{slug}", h.DeleteProduct)
			r.Get("/{slug}/related", h.RelatedProducts)
		})

		r.Get("/categories", h.ListCategories)
		r.Get("/categories/{slug}", h.GetCategory)
		r.Get("/categories/{slug}/products", h.ProductsByCategory)
		r.Get("/categories/{slug}/subcategories", h.ListSubcategories)
		r.Get("/categories/{slug}/subcategories/{subSlug}/products", h.ProductsBySubcategory)

		r.Get("/brands", h.ListBrands)
		r.Get("/tags", h.ListTags)

		// Payment routes (legacy)
		r.Post("/razorpay/order", h.CreateRazorpayOrder)
		r.Post("/razorpay/verify", h.VerifyPayment)
		r.Get("/order", h.GetOrder)

		// Checkout routes (guest-first with OTP)
		r.Post("/checkout/send-email-otp", h.SendEmailOTP)
		r.Post("/checkout/verify-email-otp", h.VerifyEmailOTP)
		r.Post("/checkout/create-order", h.CreateCheckoutOrder)

		r.Post("/auth/login", h.Login)
		r.Post("/auth/signup", h.Signup)
		r.Post("/auth/google", h.Google)
		r.Post("/auth/google-signup", h.GoogleSignup)
		r.Get("/auth/check-user", h.CheckUserExists)
		r.Post("/auth/forgot-password/send-otp", h.SendPasswordResetOTP)
		r.Post("/auth/forgot-password/verify-otp", h.VerifyPasswordResetOTP)
		r.Post("/auth/forgot-password/reset", h.ResetPassword)

		r.Group(func(pr chi.Router) {
			pr.Use(appauth.AuthMiddleware(cfg.JWTSecret))
			pr.Get("/auth/me", h.Me)
			pr.Put("/auth/profile", h.UpdateProfile)
			pr.Post("/auth/save-location", h.SaveLocation)
		})
	})

	return r
}
