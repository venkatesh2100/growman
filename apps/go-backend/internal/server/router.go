// Package server assembles the chi router: the global middleware chain,
// per-route-group rate limits and auth, and the full route table. This is
// the one place that wires handlers to HTTP paths — see
// internal/docs/08-middleware-and-security.md for the middleware stack.
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
	"github.com/venkatesh2100/growman/apps/go-backend/internal/metrics"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/middlewares"
)

func NewRouter(h *handlers.Handler, cfg config.Config) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middlewares.SecurityHeaders)
	r.Use(middleware.Recoverer)
	r.Use(middlewares.Prometheus("growman-api"))
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

	// Liveness is static and cheap; readiness pings Postgres and reports
	// Redis as degraded-but-serving. Orchestrator probes should use /readyz.
	r.Get("/healthz", h.Health)
	r.Get("/readyz", h.Ready)
	r.Handle("/metrics", metrics.Handler())
	docs.Mount(r)
	// Provider webhooks authenticate by HMAC body signature, not JWT, and
	// so sit outside /api/v1 and its rate limiters — throttling a provider
	// just converts a delivery into a retry.
	r.Post("/webhooks/razorpay", h.RazorpayWebhook)
	r.Post("/webhooks/shiprocket", h.ShiprocketWebhook)

	r.Route("/api/v1", func(r chi.Router) {
		r.Use(middlewares.MaxBytes(11 << 20))
		if h.Redis != nil {
			r.Use(middlewares.NamedIPRateLimiter(h.Redis, "api", 250, time.Minute))
		}
		r.Get("/debug/version", h.Version)
		r.Get("/healthz", h.Health)

		// Auth is fail-closed: a Redis outage must not turn login and OTP
		// into unlimited endpoints. Each OTP send is also a paid SMS.
		r.Group(func(r chi.Router) {
			r.Use(middlewares.StrictIPRateLimiter(h.Redis, "auth", 20, time.Minute))
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
			r.Use(middlewares.StrictIPRateLimiter(h.Redis, "checkout", 20, time.Minute))
			// Guests must be able to check out, so these cannot require a
			// token — but CreateCheckoutOrder reads the claims to decide
			// whether to demand an email-verification proof, and
			// ValidateCoupon needs the user for per-customer usage caps.
			// Without this the claims are never present and a signed-in
			// customer is treated as a guest.
			r.Use(appauth.OptionalAuthMiddleware(cfg.JWTSecret))
			r.Post("/checkout/quote", h.QuoteFulfillment)
			r.Post("/checkout/send-email-otp", h.SendEmailOTP)
			r.Post("/checkout/verify-email-otp", h.VerifyEmailOTP)
			r.Post("/checkout/create-order", h.CreateCheckoutOrder)
			r.Post("/checkout/validate-coupon", h.ValidateCoupon)
		})

		r.Route("/products", func(r chi.Router) {
			r.Get("/", h.ListProducts)
			r.Get("/search", h.SearchProducts)
			r.Get("/featured", h.FeaturedProducts)
			r.Get("/filters", h.FilterProducts)
			r.Get("/{slug}", h.GetProduct)
			r.Get("/{slug}/related", h.RelatedProducts)
			r.Get("/{slug}/companions", h.ProductCompanions)
			r.Get("/{slug}/reviews", h.ListProductReviews)
			r.Post("/{slug}/back-in-stock", h.CreateBackInStockRequest)

			// Writing a review requires a completed account, not just any
			// token: an onboarding user has no verified identity to attach.
			r.Group(func(r chi.Router) {
				r.Use(appauth.FullAuthMiddleware(cfg.JWTSecret))
				r.Post("/{slug}/reviews", h.CreateProductReview)
			})

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
		r.Get("/care/season", h.CareSeason)

		r.Group(func(r chi.Router) {
			r.Use(appauth.AdminMiddleware(cfg.JWTSecret))
			r.Post("/images/upload", h.UploadImage)

			// Inventory
			r.Post("/inventory/adjust", h.AdjustStock)
			r.Get("/inventory/low-stock", h.ListLowStock)

			// Review moderation
			r.Get("/reviews", h.ListReviewsForModeration)
			r.Patch("/reviews/{id}/status", h.ModerateReview)

			// Refunds
			r.Get("/refunds", h.ListRefunds)
			r.Post("/orders/{id}/refund", h.CreateRefund)

			// Invoicing
			r.Post("/orders/{id}/invoice/email", h.EmailOrderInvoice)
			r.Get("/reports/gst", h.ExportGSTReport)

			// Shipment booking
			r.Post("/orders/{id}/shipment", h.CreateShipment)
			r.Post("/orders/{id}/shipment/pickup", h.SchedulePickup)

			// Coupons
			r.Get("/coupons", h.ListCoupons)
			r.Post("/coupons", h.CreateCoupon)
			r.Put("/coupons/{id}", h.UpdateCoupon)
			r.Delete("/coupons/{id}", h.DeleteCoupon)
			r.Patch("/quotes/{id}", h.UpdateQuoteStatus)
		})

		r.Group(func(r chi.Router) {
			r.Use(middlewares.StrictIPRateLimiter(h.Redis, "plant", 20, time.Minute))
			r.Post("/images/identify-plant", h.IdentifyPlant)
			r.Get("/plants/status", h.PlantNetStatus)
			r.Get("/plants/languages", h.PlantNetLanguages)
			r.Get("/plants/projects", h.PlantNetProjects)
			r.Get("/plants/species", h.PlantNetSpecies)
			r.Get("/plants/diseases", h.PlantNetDiseases)
			r.Get("/plants/varieties", h.PlantNetVarieties)
			r.Get("/plants/quota", h.PlantNetQuota)
		})

		r.Group(func(r chi.Router) {
			r.Use(middlewares.StrictIPRateLimiter(h.Redis, "chat", 30, time.Minute))
			r.Post("/chat", h.Chat)
		})
		r.Group(func(r chi.Router) {
			if h.Redis != nil {
				r.Use(middlewares.NamedIPRateLimiter(h.Redis, "quotation", 5, 10*time.Minute))
			}
			r.Post("/quotations", h.CreateQuotation)
		})
		r.Group(func(r chi.Router) {
			if h.Redis != nil {
				r.Use(middlewares.NamedIPRateLimiter(h.Redis, "waitlist", 5, 10*time.Minute))
			}
			r.Post("/dootha-waitlist", h.JoinDoothaWaitlist)
		})
		r.Post("/requested-products", h.CreateRequestedProduct)
		r.Post("/engagement/long-browse", h.ReportLongBrowse)

		r.Post("/razorpay/verify", h.VerifyPayment)
		r.Get("/auth/check-user", h.CheckUserExists)

		// DPDP consent can be recorded before sign-in, so this is public.
		// OptionalAuthMiddleware is what lets RecordConsent attach the user
		// id when the caller *is* signed in; without it every record would
		// be keyed by email only, including a logged-in customer's.
		r.Group(func(r chi.Router) {
			r.Use(appauth.OptionalAuthMiddleware(cfg.JWTSecret))
			r.Post("/consent", h.RecordConsent)
		})

		// Guest order lookup for the post-payment page, authorised by the
		// opaque ?token= minted at order creation. The same handler serves
		// authenticated owners by ?id= — see GetOrder. Mounted with
		// optional auth so both paths work through one route.
		r.Group(func(r chi.Router) {
			r.Use(appauth.OptionalAuthMiddleware(cfg.JWTSecret))
			r.Get("/order", h.GetOrder)
			r.Get("/orders/{id}/invoice", h.GetOrderInvoice)
		})

		// Onboarding-scoped tokens may only finish their profile. Mounting
		// OnboardingAuthMiddleware here replaces the hand-rolled scope
		// check that used to live inside the handler.
		r.Group(func(pr chi.Router) {
			pr.Use(appauth.OnboardingAuthMiddleware(cfg.JWTSecret))
			pr.Post("/auth/profile/complete", h.CompletePhoneProfile)
		})

		// Everything below needs a *full* account. Using AuthMiddleware
		// here would let a half-registered phone signup read orders and
		// write to the wishlist.
		r.Group(func(pr chi.Router) {
			pr.Use(appauth.FullAuthMiddleware(cfg.JWTSecret))
			pr.Get("/auth/me", h.Me)
			pr.Get("/dashboard/map", h.DashboardMap)
			pr.Get("/requested-products", h.ListRequestedProducts)
			pr.Get("/dootha-waitlist", h.ListDoothaWaitlist)
			pr.Get("/order-support-requests", h.ListOrderSupportRequests)
			pr.Patch("/order-support-requests/{id}/status", h.UpdateOrderSupportStatus)
			pr.Put("/auth/profile", h.UpdateProfile)
			pr.Post("/auth/save-location", h.SaveLocation)
			pr.Get("/orders", h.ListOrders)
			pr.Patch("/orders/{id}/status", h.UpdateOrderStatus)
			pr.Patch("/orders/{id}/expected-delivery", h.UpdateOrderExpectedDeliveryDate)
			pr.Post("/orders/{id}/cancel", h.CancelOrder)
			pr.Get("/wishlist", h.ListWishlist)
			pr.Post("/wishlist", h.AddToWishlist)
			pr.Delete("/wishlist/{productId}", h.RemoveFromWishlist)

			// Saved addresses
			pr.Get("/addresses", h.ListAddresses)
			pr.Post("/addresses", h.CreateAddress)
			pr.Put("/addresses/{id}", h.UpdateAddress)
			pr.Delete("/addresses/{id}", h.DeleteAddress)

			// DPDP data-principal rights
			pr.Get("/privacy/export", h.ExportMyData)
			pr.Post("/privacy/erase", h.RequestErasure)

			// Personal plant collection, care reminders, and the notification inbox.
			pr.Get("/me/plants", h.ListOwnedPlants)
			pr.Post("/me/plants", h.CreateOwnedPlant)
			pr.Get("/me/plants/calendar", h.PlantCalendar)
			pr.Post("/me/plants/import-orders", h.ImportPurchasedPlants)
			pr.Get("/me/plants/{id}", h.GetOwnedPlant)
			pr.Put("/me/plants/{id}", h.UpdateOwnedPlant)
			pr.Delete("/me/plants/{id}", h.DeleteOwnedPlant)
			pr.Post("/me/plants/{id}/water", h.MarkPlantWatered)
			pr.Post("/me/plants/{id}/fertilize", h.MarkPlantFertilized)
			pr.Post("/me/plants/{id}/health", h.AddPlantHealth)
			pr.Post("/me/plants/{id}/care", h.MarkPlantTask)
			pr.Post("/me/plants/{id}/snooze", h.SnoozePlant)
			pr.Post("/me/plants/{id}/diagnosis", h.DiagnosePlant)
			pr.Post("/me/plants/{id}/care-plan", h.StartCarePlan)
			pr.Get("/me/plants/{id}/card", h.PlantCareCard)
			pr.Get("/notification-preferences", h.GetNotificationPreferences)
			pr.Put("/notification-preferences", h.UpdateNotificationPreferences)
			pr.Get("/notifications", h.ListAppNotifications)
			pr.Post("/notifications/read-all", h.MarkAllNotificationsRead)
			pr.Patch("/notifications/{id}/read", h.MarkNotificationRead)
			pr.Get("/me/saved", h.ListSavedItems)
			pr.Post("/me/saved", h.SaveForLater)
			pr.Delete("/me/saved/{id}", h.RemoveSavedItem)
			pr.Get("/me/payment-methods", h.ListPaymentMethods)
			pr.Post("/me/payment-methods", h.SavePaymentMethod)
			pr.Delete("/me/payment-methods/{id}", h.DeletePaymentMethod)
			pr.Get("/me/referral", h.GetReferral)
			pr.Post("/me/referral", h.ClaimReferral)
			pr.Post("/me/recently-viewed", h.RecordRecentView)
			pr.Get("/me/recently-viewed", h.ListRecentViews)
			pr.Post("/me/cart-signals", h.SyncCartSignals)
			pr.Get("/me/offers", h.ListOffers)
			pr.Get("/me/quotes", h.ListMyQuotes)
			pr.Get("/me/orders/active", h.ActiveOrder)
			pr.Post("/me/images", h.UploadMyImage)
			pr.Post("/me/scan-alert", h.ScanAlert)
			pr.Post("/me/care-followup", h.CareFollowUp)
			pr.Get("/me/chat", h.ListChatHistory)
			pr.Post("/orders/{id}/reorder", h.Reorder)
			pr.Post("/orders/{id}/rating", h.RateDelivery)
			pr.Post("/orders/{id}/retry-payment", h.RetryPayment)
		})
	})

	return r
}
