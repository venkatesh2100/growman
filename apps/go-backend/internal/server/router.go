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
	"github.com/venkatesh2100/growman/apps/go-backend/internal/middlewares"
)

// NewRouter wires all HTTP routes and middleware.
func NewRouter(h *handlers.Handler, cfg config.Config) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))
	// Add compression middleware to reduce response size
	r.Use(middleware.Compress(5))

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.AllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token", "Origin", "X-Requested-With"},
		ExposedHeaders:   []string{"Content-Length", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	r.Get("/healthz", h.Health)

	// Webhook routes (outside /api/v1, no auth required)
	r.Post("/webhooks/razorpay", h.RazorpayWebhook)

	r.Route("/api/v1", func(r chi.Router) {
		// General rate limit: 300 req/min per IP.
		// Checkout flow also has its own tighter limiter below.
		if h.Redis != nil {
			r.Use(middlewares.IPRateLimiter(h.Redis, 250, time.Minute))
		}
		r.Get("/debug/version", h.Version)

		r.Get("/healthz", h.Health)

		// Auth: 40 req/min (allows retries without impacting normal users)
		r.Group(func(r chi.Router) {
			if h.Redis != nil {
				r.Use(middlewares.IPRateLimiter(h.Redis, 20, time.Minute))
			}
			r.Post("/auth/login", h.Login)
			r.Post("/auth/admin/login", h.AdminLogin)
			r.Post("/auth/signup", h.Signup)
			r.Post("/auth/google", h.Google)
			r.Post("/auth/google-signup", h.GoogleSignup)
			r.Post("/auth/forgot-password/send-otp", h.SendPasswordResetOTP)
			r.Post("/auth/forgot-password/verify-otp", h.VerifyPasswordResetOTP)
			r.Post("/auth/forgot-password/reset", h.ResetPassword)
			r.Post("/auth/otp/send", h.SendPhoneOTP)
			r.Post("/auth/otp/verify", h.VerifyPhoneOTP)
			r.Post("/auth/otp/widget/verify", h.VerifyWidgetOTP)
			r.Post("/auth/truecaller", h.VerifyTruecaller)
		})

		// Checkout/OTP: 60 req/min (prevents abuse but avoids blocking first-time payments)
		r.Group(func(r chi.Router) {
			if h.Redis != nil {
				r.Use(middlewares.IPRateLimiter(h.Redis, 20, time.Minute))
			}
			r.Post("/checkout/send-email-otp", h.SendEmailOTP)
			r.Post("/checkout/verify-email-otp", h.VerifyEmailOTP)
			r.Post("/checkout/create-order", h.CreateCheckoutOrder)
		})
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
		r.Get("/catalog", h.ListCatalog)

		// Image upload route
		r.Post("/images/upload", h.UploadImage)
		r.Post("/images/identify-plant", h.IdentifyPlant) // Alias for Cloud Run compatibility

		// Plant identification (Pl@ntNet)
		// r.Post("/plants/identify", h.IdentifyPlant)
		// r.Post("/plants/identify/", h.IdentifyPlant) // Trailing slash variant

		// AI Chat route
		r.Post("/chat", h.Chat)
		r.Post("/requested-products", h.CreateRequestedProduct)

		// Payment routes (legacy)
		r.Post("/razorpay/order", h.CreateRazorpayOrder)
		r.Post("/razorpay/verify", h.VerifyPayment)
		r.Get("/order", h.GetOrder)

		// Checkout routes (guest-first with OTP)
		r.Get("/auth/check-user", h.CheckUserExists)

		r.Group(func(pr chi.Router) {
			pr.Use(appauth.AuthMiddleware(cfg.JWTSecret))
			pr.Get("/auth/me", h.Me)
			pr.Post("/auth/profile/complete", h.CompletePhoneProfile)
			pr.Get("/dashboard/map", h.DashboardMap)
			pr.Get("/requested-products", h.ListRequestedProducts)
			pr.Get("/order-support-requests", h.ListOrderSupportRequests)
			pr.Patch("/order-support-requests/{id}/status", h.UpdateOrderSupportStatus)
			pr.Put("/auth/profile", h.UpdateProfile)
			pr.Post("/auth/save-location", h.SaveLocation)
			// Orders endpoint for authenticated users
			pr.Get("/orders", h.ListOrders)
			pr.Patch("/orders/{id}/status", h.UpdateOrderStatus)
			pr.Patch("/orders/{id}/expected-delivery", h.UpdateOrderExpectedDeliveryDate)
			// Wishlist endpoints
			pr.Get("/wishlist", h.ListWishlist)
			pr.Post("/wishlist", h.AddToWishlist)
			pr.Delete("/wishlist/{productId}", h.RemoveFromWishlist)
		})
	})

	return r
}
