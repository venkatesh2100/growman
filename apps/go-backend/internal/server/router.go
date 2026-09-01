package server

import (
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/config"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/docs"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/handlers"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/middlewares"
)

func NewRouter(h *handlers.Handler, cfg config.Config) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middlewares.SecurityHeaders)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))
	r.Use(middleware.Throttle(512))
	// Level 1 is much cheaper than 5 for small JSON responses.
	r.Use(middleware.Compress(1))
	// Chi's full request logger is expensive; keep QuietLogger always.
	// Set LOG_HTTP=1 to restore verbose access logs.
	if os.Getenv("LOG_HTTP") == "1" || os.Getenv("LOG_HTTP") == "true" {
		r.Use(middleware.Logger)
	} else {
		r.Use(middlewares.QuietLogger(1200 * time.Millisecond))
	}

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.AllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token", "Origin", "X-Requested-With"},
		ExposedHeaders:   []string{"Content-Length", "Content-Type", "ETag", "X-RateLimit-Limit", "X-RateLimit-Remaining"},
		AllowCredentials: true,
		MaxAge:           600,
	}))

	r.Get("/healthz", h.Health)
	docs.Mount(r)
	r.Post("/webhooks/razorpay", h.RazorpayWebhook)

	r.Route("/api/v1", func(r chi.Router) {
		r.Use(middlewares.MaxBytes(11 << 20))
		if h.Redis != nil {
			r.Use(middlewares.NamedIPRateLimiter(h.Redis, "api", 250, time.Minute))
		}
		r.Get("/debug/version", h.Version)
		r.Get("/healthz", h.Health)

		r.Group(func(r chi.Router) {
			if h.Redis != nil {
				r.Use(middlewares.NamedIPRateLimiter(h.Redis, "auth", 20, time.Minute))
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

		r.Group(func(r chi.Router) {
			if h.Redis != nil {
				r.Use(middlewares.NamedIPRateLimiter(h.Redis, "checkout", 20, time.Minute))
			}
			r.Post("/checkout/send-email-otp", h.SendEmailOTP)
			r.Post("/checkout/verify-email-otp", h.VerifyEmailOTP)
			r.Post("/checkout/create-order", h.CreateCheckoutOrder)
		})

		r.Route("/products", func(r chi.Router) {
			r.Get("/", h.ListProducts)
			r.Get("/search", h.SearchProducts)
			r.Get("/featured", h.FeaturedProducts)
			r.Get("/{slug}", h.GetProduct)
			r.Get("/{slug}/related", h.RelatedProducts)

			r.Group(func(r chi.Router) {
				r.Use(appauth.AdminMiddleware(cfg.JWTSecret))
				r.Post("/", h.CreateProduct)
				r.Put("/{slug}", h.UpdateProduct)
				r.Delete("/{slug}", h.DeleteProduct)
			})
		})

		r.Get("/categories", h.ListCategories)
		r.Get("/categories/{slug}", h.GetCategory)
		r.Get("/categories/{slug}/products", h.ProductsByCategory)
		r.Get("/categories/{slug}/subcategories", h.ListSubcategories)
		r.Get("/categories/{slug}/subcategories/{subSlug}/products", h.ProductsBySubcategory)

		r.Get("/brands", h.ListBrands)
		r.Get("/tags", h.ListTags)
		r.Get("/catalog", h.ListCatalog)

		r.Group(func(r chi.Router) {
			r.Use(appauth.AdminMiddleware(cfg.JWTSecret))
			r.Post("/images/upload", h.UploadImage)
		})

		r.Group(func(r chi.Router) {
			if h.Redis != nil {
				r.Use(middlewares.NamedIPRateLimiter(h.Redis, "plant", 20, time.Minute))
			}
			r.Post("/images/identify-plant", h.IdentifyPlant)
		})

		r.Group(func(r chi.Router) {
			if h.Redis != nil {
				r.Use(middlewares.NamedIPRateLimiter(h.Redis, "chat", 30, time.Minute))
			}
			r.Post("/chat", h.Chat)
		})
		r.Post("/requested-products", h.CreateRequestedProduct)
		r.Post("/engagement/long-browse", h.ReportLongBrowse)

		r.Post("/razorpay/order", h.CreateRazorpayOrder)
		r.Post("/razorpay/verify", h.VerifyPayment)
		r.Get("/order", h.GetOrder)
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
			pr.Get("/orders", h.ListOrders)
			pr.Patch("/orders/{id}/status", h.UpdateOrderStatus)
			pr.Patch("/orders/{id}/expected-delivery", h.UpdateOrderExpectedDeliveryDate)
			pr.Get("/wishlist", h.ListWishlist)
			pr.Post("/wishlist", h.AddToWishlist)
			pr.Delete("/wishlist/{productId}", h.RemoveFromWishlist)
		})
	})

	return r
}
