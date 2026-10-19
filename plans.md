# Growman Improvement Plan

An audit of `apps/web` (Next.js 16 on Cloudflare Workers) and `apps/go-backend` (Go/Chi + Postgres + Redis), with a prioritised plan for what to fix and build next.

Every finding below was verified against the code and cites `file:line`. Line numbers reflect the state of the repo at the time of audit, which is **before** the remediation work described under each item's status — so most of the cited lines have since moved or no longer exist. The quoted snippets are kept as the record of what was wrong.

---

## Executive summary

The platform was further along than most e-commerce codebases of its age even before this work: the fulfillment quoting engine is genuinely good, SEO is thorough (sitemap, JSON-LD, canonicals, per-page metadata), caching is layered (L1 memory + Redis + singleflight), and the Go code is well-commented with real architectural reasoning. The internal docs under `apps/go-backend/internal/docs/` are better than most teams produce.

The audit found the problems concentrated in three places, and all three have now been closed in the backend.

**1. Payment confirmation was not trustworthy — fixed.** An unauthenticated caller could mark any order paid without a valid signature, and the webhook path was signing with the API key secret rather than the dashboard webhook secret, so it had almost certainly never succeeded in production. `VerifyPayment` now loads the order first and verifies the HMAC against the `razorpay_order_id` the server stored, rejects a missing or wrong signature with a `400`, and can only skip the check when `APP_ENV` is explicitly non-production — a missing secret no longer silently disables verification. `RAZORPAY_WEBHOOK_SECRET` is a separate config value that `config.Load()` refuses to start production without. Webhook handling is now idempotent through a `webhook_events` table with a unique index on `event_id`, responds `200` before processing asynchronously, discards deliveries older than ten minutes, and handles the failure, refund and dispute events alongside `payment.captured`. See `internal/handlers/payments.go`, `internal/handlers/webhooks.go`, `internal/config/config.go`.

**2. Order data was publicly enumerable — fixed.** `GET /order` now requires either the opaque 64-hex `public_token` minted at order creation (for guests) or a JWT whose user owns the order; "absent" and "not yours" both return an identical `404` so the endpoint cannot be used to probe which ids exist. See `internal/handlers/payments.go` (`GetOrder`), `internal/auth/jwt.go` (`OptionalAuthMiddleware`). One part of this finding is still open: `GET /auth/check-user` remains a public account-enumeration oracle returning existence plus a partial email and phone, and it is still throttled only by the general 250/min API limiter.

**3. There was no inventory system — built.** Stock is now reserved at order creation, committed on paid and released on failure, cancellation or an abandoned-order sweep, with the race arbitrated by a conditional `UPDATE ... WHERE stock >= ?` rather than in Go. See `internal/handlers/inventory.go`. The storefront out-of-stock and low-stock states and the JSON-LD `availability` field were already present before this work; a back-in-stock signup form is the piece still missing from the frontend.

The commerce fundamentals the audit called out are also built, on the backend: reviews with moderation and a denormalised aggregate, refunds and customer-initiated cancellation, coupons with server-side discount evaluation, GST invoicing with financial-year invoice numbering and a GSTR export, and Shiprocket shipment booking with AWB, pickup scheduling, a status webhook and polling as a backstop. Database writes that used to be a sequence of independent saves now commit in one transaction, scoped auth middleware is actually mounted, `/readyz` checks dependencies, the rate limiter fails closed on the buckets that cost money, DPDP consent/export/erasure is implemented against the Rule 8(3) retention floor, and a CI workflow now gates merges with gofmt, vet, `go test -race` and the web type-check.

What genuinely remains is, almost entirely, user interface. The backend endpoints for reviews, cancellation, invoice download, saved addresses, shipment tracking and consent all exist and are unreachable from the storefront: there is no review submission form, no cancel button on `/orders`, no invoice download link, no address-book screen, no tracking page and no consent banner — so Google Analytics and the `vid`/`sid` cookies in `middleware.ts` still load unconditionally, which is the part of DPDP that carries a deadline. There is no admin panel, so every new admin endpoint is operated by calling the API directly. Error tracking and tracing (P2.4) are not started. The new tests exercise pure helpers well but there is still no HTTP handler test in `internal/handlers`, which was the specific gap P3.3 identified. And the P3.4 hygiene list is largely untouched: the GA measurement ID is still inline, `/product` still carries its redirect TODO, the chat handler still returns the AI provider's error text, and `apps/web/example.env` still contains credential-shaped values.

One thing needs doing outside the code. `apps/go-backend/example.env` has been rewritten as a clean template with no real values, but it is **still tracked in git**, and every value it previously held remains in the history. Rotating those credentials is still outstanding — see P3.4.

The remaining sequence is: ship the frontend surfaces for what the backend already does (reviews, cancel, invoice, addresses, tracking), then the consent banner ahead of the 13 November 2026 DPDP deadline, then error tracking, then the admin panel.

---

## How to read this document

Each item carries a **severity**, an **effort** estimate, and a **status**.

| Severity | Meaning |
|---|---|
| **P0** | Active money or data loss. Fix before the next deploy. |
| **P1** | Blocks correct operation or growth. Fix within a month. |
| **P2** | Meaningful quality, reliability, or conversion gain. |
| **P3** | Hygiene and long-term maintainability. |

Effort is rough developer-days for one engineer familiar with the codebase.

| Status | Meaning |
|---|---|
| **Done** | Implemented and verified in the code. The item records the reasoning; the status line says where the fix lives. |
| **Partially done** | Some of the item shipped. The status line names which half is outstanding. |
| **Not started** | No implementation found. |

Statuses were set by reading the current code, not by taking the implementation notes at face value. Where a finding's description no longer matches what is in the repo, the status line says so.

---

# P0 — Fix before the next deploy

## P0.1 Payment verification does not reject forged payments

**Severity: P0 · Effort: 0.5d · `apps/go-backend/internal/handlers/payments.go:249-254`**

**Status:** Done

Resolved exactly as prescribed below, in `internal/handlers/payments.go`. `VerifyPayment` now loads the order before verifying anything, so the HMAC is checked against the `razorpay_order_id` the server persisted rather than the one the browser posted. A missing `razorpay_signature` is a `400`; a failed check is a `400` with `{"error": "payment verification failed"}` and increments `payment_signature_failures_total{stage="verify"}`. The escape hatch is now `skipSignatureChecks()`, gated solely on `APP_ENV` being `development`, `dev` or `test` — an empty `RAZORPAY_KEY_SECRET` no longer disables verification, which was the dangerous case. `config.Load()` refuses to start in production without the secret (`internal/config/config.go`). `internal/handlers/payments_test.go` covers hex and base64 signatures, a wrong secret, a tampered message, and specifically that a missing secret in production does not switch verification off.

`VerifyPayment` computes the Razorpay signature, logs a failure, and then marks the order paid regardless:

```249:254:apps/go-backend/internal/handlers/payments.go
	// Signature check is advisory today (logged, not enforced) and skipped
	// entirely in dev/test or when no key secret is configured.
	isTestMode := h.Cfg.AppEnv == "development" || h.Cfg.AppEnv == "test" || h.Cfg.RazorpayKeySecret == ""
	if req.RazorpaySignature != "" && !isTestMode && !h.verifyRazorpaySignature(req.RazorpayOrderID, req.RazorpayPaymentID, req.RazorpaySignature) {
		log.Printf("[PAYMENT] signature verification failed for order: %s", req.RazorpayOrderID)
	}
```

There are two independent bypasses. First, the check only runs when `req.RazorpaySignature != ""` — omit the field entirely and no verification is attempted at all. Second, even when a signature is present and wrong, execution falls through to `markOrderPaid` on line 266.

The endpoint is in the public route group (`internal/server/router.go:52-174`, no auth middleware), so the full exploit is a single unauthenticated request:

```
POST /api/v1/razorpay/verify
{"razorpay_order_id": "order_abc", "razorpay_payment_id": "pay_anything"}
```

This sets `payment_status=paid` and `status=paid`, writes a `Payment` row with `status=captured`, creates a soft account, and fires the customer confirmation email plus the merchant "new paid order" alert. Operationally indistinguishable from a real sale. Razorpay's own documentation is unambiguous that a failed signature check means "reject the order entirely — do not fulfil it, do not retry and do not treat it as a genuine payment."

**Fix.** Make the signature mandatory and fail closed:

```go
if req.RazorpaySignature == "" {
    httpjson.Error(w, http.StatusBadRequest, "razorpay_signature is required")
    return
}
if !h.verifyRazorpaySignature(req.RazorpayOrderID, req.RazorpayPaymentID, req.RazorpaySignature) {
    log.Printf("[PAYMENT] signature verification failed for order: %s", req.RazorpayOrderID)
    httpjson.Error(w, http.StatusBadRequest, "payment verification failed")
    return
}
```

Keep the dev/test escape hatch gated strictly on `AppEnv` and never on `RazorpayKeySecret == ""`, because a misconfigured production secret currently disables verification silently. Better still, have `config.Load()` refuse to start in production without `RAZORPAY_KEY_SECRET`, alongside the existing default-JWT guard at `internal/config/config.go:185-187`.

Also follow Razorpay's guidance to use your own stored `razorpay_order_id` rather than the browser-supplied one when constructing the HMAC message. The order lookup at line 257 already keys off the client value; look the order up by your internal `orderId` instead and verify against the `razorpay_order_id` you persisted at creation time.

## P0.2 The webhook is signed with the wrong secret

**Severity: P0 · Effort: 0.5d · `apps/go-backend/internal/handlers/webhooks.go:101-104`**

**Status:** Done

`Config.RazorpayWebhookSecret` now exists, sourced from `RAZORPAY_WEBHOOK_SECRET` (`internal/config/config.go`), and `config.Load()` returns an error when it is empty in production — with an error message that spells out that this is the dashboard webhook secret and not the API key secret, because that confusion is what caused the bug. `verifyRazorpayHMAC` takes the secret as a parameter instead of reaching into config, so the webhook path keys on the webhook secret and the checkout callback stays on the key secret. `internal/handlers/payments_test.go` has a test asserting the two paths use different secrets. `example.env` documents the distinction at length, and `payment_signature_failures_total{stage="webhook"}` is the metric to watch after any change to either value.

`verifyWebhookSignature` delegates to `verifyRazorpayHMAC`, which keys the HMAC with `h.Cfg.RazorpayKeySecret` (`payments.go:355-363`). A grep for `RAZORPAY_WEBHOOK_SECRET` across the backend returns nothing — the config has no such field.

Razorpay signs webhook bodies with the **webhook secret configured in the dashboard**, which is a separate value from the API key secret. Unless someone deliberately typed the key secret into the dashboard's webhook secret field, every webhook delivery hits the `401` at `webhooks.go:37-40`, Razorpay retries with exponential backoff for 24 hours, and then gives up and disables the endpoint.

Combined with P0.1 this is the serious part: the hardened confirmation path is broken and the unhardened one is the only one that works. Check your Razorpay dashboard webhook delivery logs — if they are a wall of 401s, this has been the case since launch.

**Fix.** Add a distinct `RazorpayWebhookSecret` to `internal/config/config.go` sourced from `RAZORPAY_WEBHOOK_SECRET`, and key the webhook HMAC with it. Leave `verifyRazorpaySignature` on the key secret, since the checkout-callback signature genuinely does use the API key secret. The shared `verifyRazorpayHMAC` primitive should take the secret as a parameter rather than reaching into config.

## P0.3 Webhook handling is not idempotent and processes inline

**Severity: P0 · Effort: 1d · `apps/go-backend/internal/handlers/webhooks.go:25-99`**

**Status:** Done

`internal/handlers/webhooks.go` was substantially rewritten and `models.WebhookEvent` added to the migration list in `internal/handlers/handler.go`. Deduplication works through `claimWebhookEvent`, which inserts the `x-razorpay-event-id` into `webhook_events`; the unique index on `event_id` is what makes the claim atomic, so concurrent duplicate deliveries race on the insert and exactly one wins with no application-level lock. A duplicate returns `200` without reprocessing. The handler responds `200` first and then processes in a goroutine bounded by a 30-second timeout, which keeps it inside Razorpay's 5-second budget. Deliveries older than `maxWebhookAge` (10 minutes, rather than the five suggested here) are discarded as replays. Handled events are now `payment.captured`, `order.paid`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed` and `payment.dispute.created`. The read-then-write `firstTimePaid` race is gone too — see P2.1.

Three problems, all of which Razorpay's best-practices documentation calls out directly:

**No event deduplication.** Razorpay has at-least-once delivery semantics and sends the `x-razorpay-event-id` header specifically so you can detect replays. Nothing reads it. The `firstTimePaid` guard in `markOrderPaid` (`payments.go:287`) prevents duplicate *emails*, but it is a read-then-write with no locking, so two concurrent deliveries can both observe `PaymentStatus != "paid"` and both send confirmations. It also does nothing about duplicate `Payment` rows — line 304 attempts an insert on every call and swallows the unique-constraint violation as a non-fatal log.

**Synchronous processing.** Razorpay requires a 2xx within 5 seconds and treats a timeout as failure. The handler performs an order lookup with `Preload("Items")`, two `Save` calls, a `Payment` insert, and a soft-account lookup-or-create before responding. Under database load this will exceed the budget and trigger retries, which then compound with the missing deduplication.

**Only one event type.** Line 49 handles `payment.captured` and nothing else. `payment.failed`, `refund.created`, `refund.processed`, and `payment.dispute.created` are all silently dropped, so failed payments stay `created` forever and refunds never reach your database.

**Fix.** Add a `webhook_events` table keyed on a unique `event_id`, insert on arrival, and return 200 immediately on a duplicate-key conflict. Respond 200 before doing the work and process the event in a background goroutine or a small Redis-backed queue. Add a replay guard that discards events older than five minutes. Subscribe to and handle the failure, refund, and dispute events.

## P0.4 Any order can be read by anyone by incrementing an integer

**Severity: P0 · Effort: 0.5d · `apps/go-backend/internal/handlers/payments.go:367-384`**

**Status:** Partially done — the order endpoint is fixed, `check-user` is not

`GetOrder` in `internal/handlers/payments.go` now requires either `?token=` matching `Order.PublicToken` (a new `uniqueIndex` column holding 32 random bytes hex-encoded, returned once by `POST /checkout/create-order` and used by the guest order-success page) or `?id=` plus a JWT whose user owns the order, with admins exempt. Absent and not-yours return an identical `404`, so the endpoint cannot be used to probe which ids exist. The route is mounted under the new `OptionalAuthMiddleware` (`internal/auth/jwt.go`) so one route serves both signed-in owners and token-bearing guests, and `apps/web/app/checkout/page.tsx` now forwards `?token=` to `/order-success`. Token entropy has a test in `internal/handlers/payments_test.go`.

Still outstanding: the `GET /api/v1/auth/check-user` sub-finding. `CheckUserExists` (`internal/handlers/auth.go`) still returns `{exists, email, phone}` with the partial email and phone, and it is still registered in the general `/api/v1` group behind the 250/min `api` limiter rather than the fail-closed `auth` bucket. Reducing it to a boolean and moving it into the strict group is a few minutes' work.

`GetOrder` is mounted in the public `/api/v1` group and takes an ID straight from the query string with no ownership check:

```367:375:apps/go-backend/internal/handlers/payments.go
func (h *Handler) GetOrder(w http.ResponseWriter, r *http.Request) {
	orderID := r.URL.Query().Get("id")
	if orderID == "" {
		httpjson.Error(w, http.StatusBadRequest, "order ID is required")
		return
	}

	var order models.Order
	if err := h.DB.Preload("Items").First(&order, orderID).Error; err != nil {
```

Order IDs come from `Base.ID uint` with `gorm:"primaryKey"` (`internal/models/models.go:120-126`), so they are sequential autoincrement integers. The response is the whole `Order` struct, which carries `CustomerName`, `CustomerEmail`, `CustomerPhone`, `AddressLine`, `City`, `State`, `Pincode`, plus the Razorpay IDs and every line item (`models.go:287-330`).

A `for i in {1..100000}` loop against this endpoint exfiltrates your entire customer base. Under the DPDP Act this is a reportable personal-data breach, and the API rate limit of 250 requests per minute per IP (`router.go:57-61`) merely paces the scrape rather than preventing it.

**Fix.** Two changes, both needed. Move the route behind `AuthMiddleware` and filter by `user_id` from the JWT. Then, for the guest order-success page that legitimately needs this before login, issue an opaque unguessable token at order creation — a random 32-byte `public_token` column on `orders` — and look up by that token instead of by ID. `apps/web/app/order-success/page.tsx` is the caller to migrate.

While you are there, `GET /api/v1/auth/check-user` (`internal/handlers/auth.go:242-268`) is a public account-enumeration oracle that returns existence plus partial email and phone. Restrict it to a boolean, rate-limit it hard, or remove it.

## P0.5 Client-supplied prices are trusted on two paths

**Severity: P0 · Effort: 1d · `apps/go-backend/internal/handlers/fulfillment.go:294-298`, `payments.go:135-184`**

**Status:** Done

All three parts shipped. `resolveOrderFulfillment` (`internal/handlers/fulfillment.go`) now returns `400 {"error": "fulfillment_channel_required"}` when the channel is absent, so the repricing path can no longer be skipped by omitting a field. `buildOrderItems` (`internal/handlers/payments.go`) selects `price, gst_rate, hsn_code` and sets each line's price from the product row — a size price overrides it and the size label is appended to the name — so the client's `item.Price` is ignored entirely and `order_items` now reconciles against the order total. `CreateRazorpayOrder` and its `CreateOrderRequest`/`CustomerInfo` types are deleted along with the `POST /razorpay/order` route; `POST /checkout/create-order` is the only path that creates an order.

Credit where it is due: `resolveOrderFulfillment` does the right thing when a fulfillment channel is present. It reprices the cart from the database via `resolveCart` (which selects `price` from `products` and `product_sizes` at `fulfillment.go:89-115`), compares against the client's figure with a tolerance, rejects on mismatch with `amount_mismatch`, and then explicitly overwrites `req.Amount` with the server's number:

```332:343:apps/go-backend/internal/handlers/fulfillment.go
	expected := quote.Subtotal + opt.Fee
	if math.Abs(req.Amount-expected) > amountTolerance {
		httpjson.JSON(w, http.StatusConflict, map[string]any{
			"error":          "amount_mismatch",
			"expectedAmount": expected,
			"quote":          quote,
		})
		return orderFulfillment{}, false
	}
	// Charge the server's figure, not the client's, now that they agree to
	// within rounding.
	req.Amount = expected
```

That is exactly right. The problem is that it is all conditional on line 295:

```294:298:apps/go-backend/internal/handlers/fulfillment.go
func (h *Handler) resolveOrderFulfillment(w http.ResponseWriter, r *http.Request, req *CreateCheckoutOrderRequest) (orderFulfillment, bool) {
	if req.FulfillmentChannel == "" {
		log.Printf("[FULFILLMENT] order created without a channel; recording amount as subtotal")
		return orderFulfillment{Subtotal: req.Amount}, true
	}
```

Omit `fulfillment_channel` from the request body and the entire repricing path is skipped — the client's `amount` becomes the Razorpay order amount verbatim. A ₹5,000 cart can be checked out for ₹1. The legacy `CreateRazorpayOrder` endpoint (`payments.go:135-184`) has no amount validation at all and is also publicly routed.

Separately, `buildOrderItems` snapshots the client's price onto each line item rather than the database's:

```118:125:apps/go-backend/internal/handlers/payments.go
		orderItems[i] = models.OrderItem{
			ProductID:   item.ProductID,
			ProductSize: item.ProductSizeID,
			Quantity:    item.Quantity,
			Price:       item.Price,
```

It selects only `id, name, image_key` on line 69, so it never loads the real price. Even on the correctly-validated path, per-line prices in your order records are attacker-controlled. The total is right but the line items may not reconcile against it, which will corrupt any invoice, refund calculation, or revenue report built on `order_items`.

**Fix.** Make `fulfillment_channel` a required field and return 400 when absent, so repricing can never be skipped. Have `buildOrderItems` select `price` and populate `OrderItem.Price` from the database row, ignoring `item.Price` on the request entirely. Delete `CreateRazorpayOrder` — the comment at `payments.go:131-134` already marks it superseded, and the frontend only calls the checkout endpoint.

## P0.6 Checkout never verifies that email OTP actually happened

**Severity: P0 · Effort: 0.5d · `apps/go-backend/internal/handlers/checkout.go:174-186`**

**Status:** Done

Implemented as described. `POST /checkout/verify-email-otp` now returns `{"verificationToken": "<64 hex>"}`, minted by `OTPService.IssueVerificationProof` (`internal/services/otp.go`) and stored in Redis under `checkout:verified:<email>` with a 15-minute `VerificationProofTTL`. The proof is bound to one email address, single-use, and compared in constant time. `CreateCheckoutOrder` consumes it through `ConsumeVerificationProof` for unauthenticated callers only — signed-in customers skip it, which is why the checkout route group also mounts `OptionalAuthMiddleware` — and a missing or stale token is a `403 {"error": "email_not_verified"}`. `apps/web/app/checkout/page.tsx` carries the token through its guest verification step and handles the `403` specifically. `internal/services/otp_proof_test.go` asserts single use, email binding and unguessability.

The handler's own doc comment admits it:

```174:179:apps/go-backend/internal/handlers/checkout.go
// CreateCheckoutOrder creates a Razorpay order plus its local Order record.
// Item/product validation is shared with the legacy CreateRazorpayOrder via
// buildOrderItems (payments.go); this endpoint additionally validates the
// full shipping address. The frontend calls send/verify-email-otp first —
// this endpoint does not itself re-check that the OTP step happened.
```

The OTP gate is enforced only by the frontend calling the endpoints in order. A direct API call skips it, which turns `/checkout/create-order` into an unauthenticated writer of arbitrary rows into your orders table with any email address you like — useful for spamming your merchant alerts and poisoning your customer data.

**Fix.** On successful `VerifyEmailOTP`, store a short-lived server-side proof in Redis keyed to the email (say `checkout:verified:<email>` with a 15-minute TTL) and return an opaque token. Require that token on `CreateCheckoutOrder`, validate it matches `req.Customer.Email`, and consume it on use. The `OTPService` at `internal/services/otp.go` already has the Redis plumbing.

---

# P1 — Missing commerce fundamentals

## P1.1 There is no inventory management at all

**Severity: P1 · Effort: 4d**

**Status:** Done on the backend; one frontend piece outstanding, and part of the finding below was already inaccurate

`internal/handlers/inventory.go` is new and implements the full lifecycle: reserve at order creation, commit on paid, release on failure, cancellation or sweep. Stock is held from order creation rather than from payment, so two shoppers cannot both reach the payment screen for the last plant. The race-safety primitive is the conditional update suggested in step 2, with the check inside the `WHERE` clause so the database arbitrates — `UPDATE products SET stock = stock - ? WHERE id = ? AND (track_inventory = false OR stock >= ?)` — and `RowsAffected == 0` becomes a structured `409 out_of_stock` listing the offending lines, matching the `amount_mismatch` response shape. `releaseOrderInventory` claims the release via `inventory_released = false` before crediting anything, so a replayed failure event cannot inflate stock twice, and `commitOrderInventory` re-takes the reservation when the sweep already returned the units (a payment landing after a slow bank redirect), failing loudly rather than marking an order paid against stock that is back on the shelf. `SweepAbandonedOrders` returns stock from orders unpaid after 30 minutes, driven by `StartInventorySweeper` on a 5-minute ticker from `cmd/server/main.go`. New columns: `products.track_inventory`, `products.low_stock_threshold`, `orders.inventory_released`. Step 6's back-in-stock list exists as `POST /products/{slug}/back-in-stock` plus `SendBackInStockEmail`, and admin stock control as `POST /inventory/adjust` and `GET /inventory/low-stock`.

Two corrections to the finding as written. First, step 5 was largely already true at the time of this audit and is not new work: `apps/web/app/product/[slug]/AddCart.tsx` already disabled Add to Cart and rendered an "Out of stock" label, `sizeSelector.tsx` already marked sold-out sizes, `components/productspage/ProductCard.tsx` already computed `inStock`, `productClient.tsx` already had a `LOW_STOCK_THRESHOLD` urgency cue, and `lib/seo/jsonLd.ts` already emitted a truthful `availability`. The claim that "the Add to Cart button is always live" does not match the code. Second, what the storefront still lacks is a back-in-stock signup form for the new endpoint, and `app/cart/page.tsx` does not revalidate stock before checkout — so a cart that went out of stock while it sat in `localStorage` is only caught by the `409` at order creation, which the checkout page does handle.

`Stock` is declared on both `Product` (`internal/models/models.go:224`) and `ProductSize` (line 245). A repository-wide grep for `Stock` in Go files returns exactly five matches: the two model declarations, and three in `seed/seed.go` that set initial values. **No handler ever reads it, checks it, or decrements it.**

The consequences for a plant nursery are concrete. There is no way to mark something out of stock, so customers order plants you do not have. Nothing prevents overselling a one-of-a-kind specimen to fifty people simultaneously. The product page has no "only 2 left" urgency cue and no out-of-stock state, so the Add to Cart button at `apps/web/app/product/[slug]/AddCart.tsx` is always live. Your `Product` JSON-LD cannot emit a truthful `availability` field, which means Google Merchant Center listings will be wrong.

**Plan.**

1. Add an availability check to `resolveCart` (`fulfillment.go:66`), which already loads the product and size rows — extend the `Select` to include `stock` and reject lines exceeding it with a structured `out_of_stock` error naming the offending line, mirroring the existing `channel_unavailable` and `amount_mismatch` shapes.
2. Reserve stock at order creation with a conditional update so concurrency is handled in the database rather than in Go: `UPDATE product_sizes SET stock = stock - ? WHERE id = ? AND stock >= ?`, and treat zero rows affected as a conflict.
3. Release reservations for orders that never reach `paid`, via a periodic sweep over orders older than the Razorpay session window.
4. Decrement for real on the `paid` transition inside the transaction from P2.1.
5. Surface it in the frontend: disabled Add to Cart with an "Out of stock" state, a low-stock badge on `ProductCard.tsx`, and `availability` in the product JSON-LD builder in `lib/seo/jsonLd.ts`.
6. Add a back-in-stock email signup, which for a nursery with seasonal availability is a genuinely valuable list.

## P1.2 Customers cannot write reviews

**Severity: P1 · Effort: 3d**

**Status:** Partially done — the API is complete, the storefront has no way to submit a review

`internal/handlers/reviews.go` is new. `POST /products/{slug}/reviews` sits behind `FullAuthMiddleware` (not the generic `AuthMiddleware` suggested here, because an onboarding-scope user has no verified identity to attach), and `hasPurchased` sets `VerifiedPurchase`; verified reviews auto-approve while unverified ones land in `pending`. A unique index `idx_reviews_user_product` on `(product_id, user_id)` enforces one review per customer per product, updated on re-submit. The denormalised aggregate landed as `products.rating_average`/`rating_count`, but `RecalculateProductRating` recomputes it from scratch rather than incrementing, so reversing a moderation decision cannot leave the aggregate drifting. `GET /products/{slug}/reviews` returns approved reviews with a star histogram and reduces reviewer identity to a first name. Moderation is `GET /reviews` and `PATCH /reviews/{id}/status`. `SendReviewRequests` emails customers ten days after delivery, driven by `StartShipmentWorker`. New `Review` columns: `status`, `title`, `verified_purchase`, `image_keys`, `admin_notes`.

Outstanding, and this is the part that delivers the conversion and SEO value the finding is about: there is no review submission form anywhere in `apps/web`. `app/product/[slug]/ProductTabs.tsx` has a read-only reviews tab and `lib/seo/jsonLd.ts` emits `aggregateRating`, but both were already there before this work and both still derive the rating by averaging the embedded review list rather than reading the new `ratingAverage`/`ratingCount` fields. Photo upload is modelled (`image_keys`) but has no UI, and no admin moderation screen exists.

The `Review` model exists and is migrated (`internal/handlers/handler.go:53`), and the product detail handler reads and attaches reviews (`internal/handlers/products.go:105`, `:190`). But there is no `POST` endpoint anywhere in `internal/server/router.go` — the display path is read-only against rows nothing can create.

Reviews are the highest-leverage missing feature for both conversion and SEO. `AggregateRating` and `Review` structured data produce star ratings in search results, which lifts click-through on every product page you have. For plants specifically, buyer photos showing actual plant size and condition address the single biggest hesitation in the category.

**Plan.** Add `POST /api/v1/products/{slug}/reviews` behind `AuthMiddleware`, with a verified-purchase check against the user's paid orders. Add admin moderation endpoints alongside the existing patterns in `order_support.go`. Store an `AggregateRating` denormalised onto `products` so list pages do not need a join, and invalidate it through the existing `invalidateCatalog()` in `internal/handlers/query.go:48-55`. Extend `lib/seo/jsonLd.ts` to emit `aggregateRating` and nested `review` objects. Add a post-delivery review request email using the existing `services/email.go` infrastructure. Support photo uploads through the GCS service in `internal/services/storage/`.

## P1.3 No refund, cancellation, or return flow

**Severity: P1 · Effort: 4d**

**Status:** Partially done — refunds and cancellation work through the API; no cancel button, and no returns flow

`internal/handlers/refunds.go` is new, along with a `refunds` table. The local row is written **before** calling Razorpay, so a provider timeout cannot move money with no record of it on our side. `applyRefundOutcome` is the single writer of terminal refund state, is idempotent, and also absorbs refunds initiated from the Razorpay dashboard, which arrive only as webhooks — so the two systems stay reconciled, which was the core complaint here. `POST /orders/{id}/cancel` is authenticated to the owner; `Order.IsCancellable()` (`internal/models/models.go`) permits `pending`, `paid`, `confirmed` and `processing` and refuses once an AWB is assigned or the parcel has shipped, with cases covered in `internal/handlers/invoicing_test.go`. Cancellation and restock commit in one transaction and the refund is requested afterwards; if the refund call fails the order stays cancelled and an order-support request is raised rather than failing the customer's request. Admin surfaces are `POST /orders/{id}/refund` and `GET /refunds`. New order columns: `cancelled_at`, `cancel_reason`, `refunded_amount`.

Outstanding: `app/orders/page.tsx` renders a "Cancelled" status label but has no cancel action, so the customer-facing cancellation the finding asks for is not reachable. The returns request flow with a photo upload for damage claims is not implemented at all.

`Payment.Status` documents `refunded` as a valid value (`models.go:351`) but nothing ever writes it. The only thing resembling a refund path is keyword matching in the AI chatbot that routes the conversation to a human (`internal/handlers/order_support.go:114-132`, `chat.go:287`). There is no Razorpay refund API call, no customer-facing cancel button, and no admin refund action.

For a plant store this is unavoidable: plants arrive damaged, the wrong size ships, and orders need cancelling before dispatch. Right now every one of these is a manual dashboard operation with no record in your own database, so your order data and your Razorpay data permanently disagree.

**Plan.** Add a `refunds` table and a `POST /api/v1/orders/{id}/refund` admin endpoint calling Razorpay's refund API, handle `refund.processed` and `refund.failed` in the webhook from P0.3, add customer-initiated cancellation while the order is pre-dispatch, build a returns request flow with a photo upload for damage claims, and restore inventory on refund once P1.1 lands.

## P1.4 Fulfillment is manual — Shiprocket is quote-only

**Severity: P1 · Effort: 5d**

**Status:** Partially done — booking, AWB, pickup and tracking ingest all work; the customer still cannot see tracking

`internal/shiprocket/shipments.go` and `internal/handlers/shipments.go` are both new and carry the order → AWB → pickup → tracking sequence. `bookShipment` persists `shipment_id` before requesting an AWB, so retrying after a partial failure does not double-book. Status arrives by `POST /webhooks/shiprocket`, which authenticates on an `x-api-key` header matched against `SHIPROCKET_WEBHOOK_TOKEN` and **refuses the request outright when that token is unconfigured** rather than trusting unauthenticated status updates; `RefreshShipmentTracking` polls as a backstop for missed deliveries. `StartShipmentWorker` runs every 15 minutes from `cmd/server/main.go`, booking pending shipments, refreshing tracking and sending review requests. `SendOrderShippedEmail` carries the courier, AWB and tracking link. New order columns: `shipment_id`, `awb_number`, `tracking_url`, `shipped_at`, `delivered_at`, `pickup_booked_at`, `review_requested_at`. Booking is also exposed manually at `POST /orders/{id}/shipment` and `POST /orders/{id}/shipment/pickup` for admins. `SHIPROCKET_PICKUP_LOCATION` is new required config for the courier flow, because Shiprocket rejects a booking whose pickup location does not match one of the nicknames configured in its panel.

Outstanding: the `/orders/{id}/track` page does not exist, and `app/orders/page.tsx` does not render `awbNumber`, `trackingUrl` or the courier name at all — a grep for those fields across `apps/web` returns nothing. So the shipped email is currently the only place a customer sees tracking, and the chatbot's order-support branch has not been retired.

The Shiprocket client implements exactly one business method. `rg "^func " internal/shiprocket/client.go` returns `CheckServiceability` and nothing else — the rest are auth, circuit breaker, and JSON-unmarshalling helpers. The circuit breaker and token caching are nicely done, but the integration stops at rate quoting.

So every courier order is created by hand in the Shiprocket dashboard. No AWB is generated through the API, no label or manifest, no pickup scheduling, and no tracking webhook. `Order` has no `awb_number` or `shipment_id` column, so there is nowhere to put tracking even if you fetched it. Customers get a confirmation email and then silence, which is the single largest driver of "where is my order" support contacts — and your chatbot has an entire code path dedicated to handling exactly those (`chat.go:335`, `:362`).

**Plan.** Extend the client with `CreateOrder`, `GenerateAWB`, `GeneratePickup`, and `TrackShipment`. Add `shipment_id`, `awb_number`, `courier_name`, and `tracking_url` to `orders`. Create the shipment automatically on the `paid` transition for courier-channel orders. Accept Shiprocket's tracking webhook and advance order status from it. Send "shipped" and "out for delivery" emails. Add a `/orders/{id}/track` page on the frontend. This work pays for itself in reduced support load and should let you retire the chatbot's order-support branch.

## P1.5 Onboarding-scope tokens can access full-account endpoints

**Severity: P1 · Effort: 0.5d · `apps/go-backend/internal/auth/jwt.go:88-96`**

**Status:** Done

`internal/server/router.go` now mounts `FullAuthMiddleware` on the main authenticated group and `OnboardingAuthMiddleware` on a group containing only `POST /auth/profile/complete`, and the hand-rolled scope check inside `CompletePhoneProfile` is gone. `FullAuthMiddleware` also guards review submission, for the same reason. A third middleware was added while here: `OptionalAuthMiddleware` attaches claims when a valid token is present and proceeds anonymously otherwise, which is what lets `GET /order`, the checkout group and `POST /consent` serve guests and signed-in customers through one route.

`FullAuthMiddleware` and `OnboardingAuthMiddleware` are both implemented and neither is mounted anywhere in `internal/server/router.go`. Every authenticated route uses the generic `AuthMiddleware`, which accepts any valid JWT regardless of scope.

Phone and Truecaller signups that have not completed their profile are issued `scope=onboarding` tokens (`internal/handlers/auth.go:581-601`). Only `CompletePhoneProfile` checks the scope, and it does so by hand inside the handler (`auth.go:660-662`). That means a half-registered user holding an onboarding token can call `/auth/me`, read and write `/wishlist`, list `/orders`, and `PUT /auth/profile` — defeating the purpose of having scoped tokens.

**Fix.** Mount `FullAuthMiddleware` on the authenticated route group at `router.go:156-173` and mount `OnboardingAuthMiddleware` on a small group containing only `/auth/profile/complete`. Then delete the manual check in the handler. This is a fifteen-minute change that closes the gap the two unused middlewares were written for.

## P1.6 No coupons, discounts, or promotions

**Severity: P1 · Effort: 4d**

**Status:** Done

`internal/handlers/coupons.go` is new, with `coupons` and `coupon_redemptions` tables. `evaluateCoupon` returns the discount the **server** will honour, so the authoritative-total property from P0.5 is preserved exactly as this item asks. It supports percentage and fixed discounts, a minimum subtotal, category and product scoping through `eligibleSubtotal`, a validity window, global and per-user usage caps (per-user works for guests by email), and a first-order-only flag. `recordCouponRedemption` increments `usage_count` conditionally, so concurrent checkouts cannot exceed a global cap. `POST /checkout/validate-coupon` is the public preview the checkout page calls, returning `{code, discount, description}`, and `CreateCheckoutOrder` accepts a `couponCode` field, rejecting with `422 {"error": "coupon_rejected", "reason": ...}`. Order creation, inventory reservation and coupon redemption all commit together in one transaction. All three discount types from the plan are there: `percentage` (with an optional `max_discount` cap), `fixed`, and `free_shipping`, which sets a flag rather than an amount. Admin CRUD lives at `/coupons`, and the coupon input exists on `apps/web/app/checkout/page.tsx`. There is no admin UI for creating coupons, so running a promotion currently means calling the API.

No coupon, discount, or promotion model exists anywhere in `internal/models/models.go`. There is no way to run a sale, offer a first-order discount, issue a referral code, or honour a seasonal promotion.

This blocks essentially all paid-acquisition and email marketing. The welcome-discount offer is the standard mechanic for converting an email signup, and you have no mechanism to honour one.

**Plan.** Add a `coupons` table with type (percentage, fixed, free-shipping), value, minimum cart value, usage limits globally and per user, validity window, and optional category or product scoping. Validate and apply inside the existing quote engine so that the server-authoritative total from P0.5 stays authoritative. Add an admin CRUD surface, and a coupon input on the checkout page.

## P1.7 No GST tax invoices for retail orders

**Severity: P1 · Effort: 3d**

**Status:** Partially done — invoices are generated and downloadable from the API; not attached to the confirmation email and no link on the order page

`internal/handlers/invoicing.go` and `internal/services/invoice_pdf.go` are both new. All the columns this item asks for exist: `products.hsn_code`, `products.gst_rate`, and `orders.taxable_value`, `tax_amount`, `invoice_number`, `invoice_date`. One design decision is worth recording because it is easy to get backwards: Indian catalogue prices are tax-inclusive, so GST is **extracted** rather than added — for an inclusive price `P` at rate `r`, `taxable = P / (1 + r/100)` and the tax is the remainder. Adding tax on top would have overcharged every customer. `DefaultGSTRate` is `0` because nursery stock is predominantly nil-rated; pots, soil and tools carry a per-product `gst_rate`. Invoice numbers look like `GRW/2026-27/000123`, namespaced by Indian financial year via `financialYear()`, and `assignInvoiceNumber` runs inside `markOrderPaid`'s transaction so the sequence cannot skip on a rolled-back payment. `GET /orders/{id}/invoice` serves the PDF to a token-bearing guest or the owner/admin, and `GET /reports/gst` is the GSTR-ready CSV for the accountant. `internal/handlers/invoicing_test.go` covers the financial-year boundaries and the inclusive-price extraction. A bug was found and fixed while writing those tests: `round2` used `int64(v*100+0.5)`, which truncates toward zero and so rounded negative values the wrong way, understating credit notes and refund adjustments; it now uses `math.Round`.

Outstanding: the invoice is not attached to the order confirmation email. `SendInvoiceEmail` exists and does attach the PDF, but its only caller is the admin-triggered `POST /orders/{id}/invoice/email` (`internal/handlers/invoicing.go`). And there is no download link on the frontend — a grep for "invoice" across `apps/web` finds only prose on the delete-account and checkout pages.

GST handling exists only for bulk quotations — `internal/handlers/quotation.go:29` validates GSTIN and `internal/services/quotation_pdf.go:154-155` renders it. Retail orders have no tax breakdown, no HSN codes, and no invoice document. The `Order` model carries no tax fields at all.

Indian GST rules require a tax invoice for B2C sales with the invoice number, HSN classification, the tax rate and amount, and your GSTIN. Business customers cannot claim input credit without one, which rules out the entire B2B segment your bulk flow is clearly aimed at.

**Plan.** Add `hsn_code` and `gst_rate` to `products`, and `tax_amount`, `taxable_value`, `invoice_number`, and `invoice_date` to `orders`. Compute GST during the quote so the displayed price is the final price. Generate a PDF invoice by reusing the generator in `internal/services/quotation_pdf.go`, which already handles this document class well. Attach the invoice to the confirmation email and expose it for download on the order detail page. Add a monthly GSTR-ready export for your accountant.

---

# P2 — Reliability, data integrity, and observability

## P2.1 No database transactions anywhere

**Severity: P2 · Effort: 2d**

**Status:** Done on the paths that matter

Every fix prescribed here landed. `markOrderPaid` (`internal/handlers/payments.go`) now runs inside `h.DB.Transaction` and opens by *claiming* the transition with a conditional update — `WHERE id = ? AND payment_status <> 'paid'` — so `RowsAffected == 1` is what decides whether this call is the one that moved the order. That single change makes notification dispatch exactly-once under concurrent webhook and verify calls, which is also the fix for the double-notification race flagged in P0.3. The `Payment` insert is now a `clause.OnConflict` upsert on `razorpay_payment_id` rather than an insert whose constraint violation was logged and ignored. `CreateCheckoutOrder` commits the order, the inventory reservation and the coupon redemption together. `SkipDefaultTransaction: true` is unchanged, which is the right call — the transactions are now explicit where they are needed rather than implicit everywhere.

GORM is configured with `SkipDefaultTransaction: true` (`internal/db/postgres.go:40-44`) and no handler calls `Transaction` or `Begin`. Multi-step writes are therefore partially-applied on failure.

`markOrderPaid` is the clearest case (`payments.go:286-317`): it saves the order, creates a `Payment`, creates or links a soft account, and saves the order again. A failure after the first save leaves an order marked paid with no payment record. A failure in the soft-account step leaves an order with no `user_id`, so it never appears in the customer's order history. `CreateCheckoutOrder` has the same shape — the Razorpay order is created before the local `Order` insert at `checkout.go:241`, so a database failure there orphans a live Razorpay order the customer can still pay.

**Fix.** Wrap `markOrderPaid` and order creation in `h.DB.Transaction(func(tx *gorm.DB) error { ... })`. Replace the read-then-write `firstTimePaid` check with a conditional update returning rows affected, which makes the paid transition atomic and fixes the double-notification race from P0.3 at the same time. Make the `Payment` insert an upsert on `razorpay_payment_id` rather than an insert whose constraint violation is logged and ignored.

## P2.2 Health check reports healthy when the database is down

**Severity: P2 · Effort: 0.5d · `apps/go-backend/internal/handlers/health.go:11-16`**

**Status:** Done in the code; the orchestrator probe still needs pointing at it

`GET /readyz` is new in `internal/handlers/health.go` and mounted in `internal/server/router.go`. It checks Postgres and Redis under a `readinessTimeout` of 2 seconds. A Postgres failure returns `503` with status `down`; a Redis failure reports `degraded` but still returns `200`, because the codebase treats Redis as optional throughout and taking a replica out of rotation over a cache outage would be worse than serving from the database. `/healthz` is deliberately unchanged — it is liveness only and must not depend on a datastore. Updating the deployment's readiness probe to use `/readyz` is a configuration change outside this repo.

`/healthz` returns a static JSON body with no dependency check. If Postgres is unreachable the endpoint still returns 200, so your orchestrator keeps routing traffic to a worker that cannot serve a request.

**Fix.** Split liveness from readiness. Keep `/healthz` as the cheap process-liveness probe. Add `/readyz` that pings Postgres with a short context and reports Redis status as degraded-but-serving, since the code already tolerates a nil Redis throughout. Point your orchestrator's readiness probe at the new endpoint.

## P2.3 Rate limiting fails open

**Severity: P2 · Effort: 1d · `apps/go-backend/internal/middlewares/ratelimit.go:56-58`**

**Status:** Partially done — fail-closed behaviour shipped, alerting did not

`internal/middlewares/ratelimit.go` gained `RateLimitConfig.FailClosed` and a `StrictIPRateLimiter` helper, plus an in-process fallback counter (`localLimiter`) so a Redis outage degrades rather than disables protection. The fallback is per-process, so with N replicas the effective limit is N times the configured one, which is still far better than none. `internal/server/router.go` now puts `auth` (login and OTP, where each send is a paid SMS), `checkout`, `plant` and `chat` on the fail-closed limiter — the last two because they call paid AI providers. Catalogue reads still fail open, deliberately: a Redis blip should not take the shop offline. `internal/middlewares/ratelimit_test.go` covers fail-open versus fail-closed during an outage, per-identifier isolation and window expiry.

Outstanding: the error path is still a silent log. `monitoring/` has the Grafana dashboard and Prometheus scrape config but no alerting rules, so nothing pages on a limiter falling back — see P2.4.

When the Redis Lua evaluation errors, the limiter allows the request. Combined with the optional-Redis design, a Redis outage removes every rate limit simultaneously — including the auth limiter at 20/min and the OTP limiters. OTP sends cost real money through MSG91, so this is a billing exposure as well as an abuse one.

**Fix.** Fail closed on the auth, OTP, and checkout limiters while continuing to fail open on catalog reads. Add an in-process fallback limiter so a Redis blip degrades rather than disables protection. Alert on the error path, which is currently a silent log.

## P2.4 No error tracking and no distributed tracing

**Severity: P2 · Effort: 2d**

**Status:** Not started, apart from three new metrics

A grep for `sentry` or `slog` across both apps returns nothing: there is still no error tracking, no structured logging, and no OpenTelemetry tracing. The `log.Printf` calls are unchanged, and `monitoring/` has no alerting rules.

The one piece of this that landed is the observability the P0 findings specifically needed. `internal/metrics/prometheus.go` gained `payment_signature_failures_total{stage}`, `payment_outcomes_total{result}` and `inventory_reservation_conflicts_total`. The first is the direct answer to this item's closing observation: a jump on `stage="webhook"` is the signature of a mismatched `RAZORPAY_WEBHOOK_SECRET`, and an alert on it would have caught P0.2 immediately. The metrics exist; the alert does not.

Neither app has Sentry or any equivalent. The backend logs to stdout with the standard library `log` package, and the frontend has nothing — a React render error surfaces to the user as a blank page and to you as silence.

Prometheus metrics and the Grafana dashboard under `monitoring/` cover HTTP latency well, but there is no OpenTelemetry tracing, so a slow checkout cannot be attributed between Postgres, Redis, Razorpay, and Shiprocket.

**Plan.** Add Sentry to both apps with release tagging and source maps. Adopt structured logging via `log/slog` with the Chi request ID as a correlation field, replacing the ad-hoc `log.Printf` calls. Add OpenTelemetry tracing with instrumentation on GORM and the outbound HTTP clients. Add alerts for the 5xx rate, the payment failure rate, and webhook signature failures — the last of which would have caught P0.2 immediately.

## P2.5 Frontend has no error boundaries

**Severity: P2 · Effort: 1d**

**Status:** Done, except the product-detail boundary and the Sentry wiring

`apps/web/app/global-error.tsx` and `app/error.tsx` now exist, with route-specific boundaries at `app/checkout/error.tsx`, `app/cart/error.tsx` and `app/orders/error.tsx` — checkout first, for the reason this item gives. The missing route-level loading UI was also filled in: `app/orders/loading.tsx`, `app/wishlist/loading.tsx`, `app/account/loading.tsx`, `app/shop/loading.tsx` and `app/categories/[categorySlug]/loading.tsx`.

Outstanding: there is no `app/product/[slug]/error.tsx`, so an uncaught render error on a product page still falls through to the root boundary. And the boundaries cannot be wired to Sentry because P2.4 has not started, so a caught error is shown to the customer but not reported to anyone.

There is no `error.tsx` anywhere under `apps/web/app/` and no `global-error.tsx`. Any uncaught render error in a client component falls through to Next's default error screen, with no recovery, no branding, and no reporting.

This matters most on `app/checkout/page.tsx`, which at 1,200 lines is the largest client component in the app and handles the Razorpay SDK, address forms, OTP, and fulfillment quoting. A single thrown error there loses the sale.

**Plan.** Add `app/global-error.tsx` and a root `app/error.tsx` with a retry affordance, then route-specific boundaries for checkout, product detail, and cart. Add `loading.tsx` to the routes that currently lack one — the Suspense coverage on `/shop`, `/categories`, and `/search` is good, but `/orders`, `/wishlist`, and `/account` fetch client-side with no route-level loading UI. Wire the boundaries to Sentry from P2.4.

## P2.6 TypeScript errors are suppressed at build time

**Severity: P2 · Effort: 2d · `apps/web/next.config.ts:4-6`**

**Status:** Done

`apps/web/next.config.ts` now sets `typescript.ignoreBuildErrors: false`, so a type error fails the production build, and `pnpm --filter web check-types` currently passes against the whole app. The root cause this item identifies — no CI at all — is addressed by the new `.github/workflows/ci.yml`, which runs on every pull request and on `main`. The backend job does `go mod verify`, a gofmt check (treating `gofmt -l` output as the failure signal, since the command itself exits 0), `go vet`, `go build` and `go test -race`. The race detector is there deliberately: the webhook dedup claim, inventory reservation and the cache's singleflight all depend on correct synchronisation. The frontend job runs the type check first (it reports every error at once rather than stopping at the first module), then lint, tests and build. The pre-existing `cd.yml` deploy workflow is left alone; `ci.yml` is the one that should gate a merge.

The `any` types this item lists as contributing causes are almost all gone: `app/product/add/page.tsx` and `components/productspage/FilterSideBar.tsx` are clean, and one remains at `lib/utils/geolocation.ts:277` on a Google Maps address component.

```4:6:apps/web/next.config.ts
  typescript: {
    ignoreBuildErrors: true,
  },
```

Production builds ship regardless of type errors. There is a `check-types` script in `package.json` but nothing enforces it. Combined with the `any` types scattered through `app/product/add/page.tsx` (lines 73, 90, 308, 565, 750, 782), `components/productspage/FilterSideBar.tsx:33`, and `lib/utils/geolocation.ts:253`, the type system is not currently protecting you.

**Fix.** Run `pnpm check-types` and fix what it reports, then set `ignoreBuildErrors: false`. Add a CI workflow running type-check, lint, `go vet`, and both test suites on every pull request. There appears to be no CI configuration in the repo at all, which is the root cause here.

---

# P3 — Conversion, growth, and hygiene

## P3.1 Conversion gaps on the storefront

**Severity: P3 · Effort: 5d for the set**

**Status:** Mostly not started; the address book exists as an API only

Of the set below, only the multi-address book moved, and only on the backend: `internal/handlers/addresses.go` provides authenticated list, create, update and delete at `/addresses`, backed by a new `addresses` table. There is no address-book screen in `apps/web`, so repeat customers still retype their address at checkout. The order status timeline now has real data behind it (P1.4 added `shipped_at`, `delivered_at`, `tracking_url` and the rest) but nothing renders it.

Abandoned-cart recovery deserves a specific note, because it looks closer than it is. `SendAbandonedCartEmail` was added to `internal/services/email.go`, but a grep for callers finds none outside the docs — it is groundwork with no scheduler and no trigger. The cart is still client-only in `lib/store/cartStore.ts`, so there is nothing server-side to detect an abandonment from. Treat this as not started.

The rest are untouched: search is still plain `ILIKE` with no fuzzy matching or synonyms despite `pg_trgm` being installed, recommendations are still category-based only, there are no bundles, and `CreateSoftAccount` still creates the guest's account silently with no prompt to set a password.

Ranked by expected impact:

**No abandoned-cart recovery.** The cart lives in Zustand with `persist` to `localStorage` (`lib/store/cartStore.ts:33-102`) and is never synced server-side. You cannot see what people abandon or email them about it. Abandoned-cart email is typically the single highest-ROI e-commerce automation. Add a server-side cart tied to user or session and a reminder sequence.

**No search intelligence.** `SearchProducts` uses Postgres `ILIKE` with trigram indexes (`internal/handlers/products.go:509-511`). That handles substrings but not typos, synonyms, or relevance ranking — "mony plant" returns nothing, and plant names are frequently misspelled. Add fuzzy matching via the `pg_trgm` similarity operator you already have installed, plus a synonym table and search-term logging so you learn what people want and cannot find.

**No recommendations beyond related products.** `RelatedProducts` is category-based. There is no "frequently bought together," which for plants is a natural fit — pot, soil, and fertiliser alongside the plant. Order history is right there to mine.

**No product bundles or kits.** "Complete beginner kit" and "Low-light starter set" raise average order value and are well suited to a nursery.

**No guest-checkout-to-account conversion prompt.** `CreateSoftAccount` already creates the account silently (`checkout.go:263`). Tell the customer and prompt them to set a password — you are leaving a registered user on the table at the moment of highest intent.

**No multi-address book.** The `User` model has no saved addresses, so repeat customers retype their address every time.

**No order status timeline.** Once P1.4 lands, surface it visually rather than as a status string.

## P3.2 SEO and content opportunities

**Severity: P3 · Effort: 3d**

**Status:** Not started

None of these shipped. Reviews in structured data was the highest-value item and is blocked on the review submission UI from P1.2 — `lib/seo/jsonLd.ts` already emits `aggregateRating`, but it averages the embedded review list, so with no way to write a review there is nothing new for it to report. There is still no `opengraph-image.tsx` or `ImageResponse` route anywhere under `app/`, the blog posts are still hardcoded in `lib/seo/blog.ts`, there is no Merchant Center feed, and no hreflang. The two TODOs are both still open: `lib/seo/jsonLd.ts:80` still wants `streetAddress`, `postalCode` and `geo` for `LocalBusiness`, and `lib/seo/site.ts:76` still wants the social profile URLs. These need information about the physical nursery rather than engineering time, which is probably why they have not moved.

The SEO foundation is strong, so these are additive:

- **Reviews in structured data** — covered by P1.2 and the highest-value item here, since star ratings affect click-through on every product page.
- **No dynamic OG images.** Metadata is thorough but there is no `opengraph-image.tsx` or `ImageResponse` route. Per-product generated OG cards improve social and WhatsApp sharing, which matters a lot for Indian traffic.
- **Thin blog.** Posts are hardcoded in `lib/seo/blog.ts`. Plant care content is a large organic-search surface; consider a lightweight CMS or MDX pipeline so non-engineers can publish.
- **Incomplete `LocalBusiness` data.** `lib/seo/jsonLd.ts:80-81` has a TODO for address and geo coordinates, and `lib/seo/site.ts:76` has one for social profile URLs. Both are quick wins for local search, which is directly relevant given you have a physical nursery and a store-pickup flow.
- **No Google Merchant Center feed.** A product feed unlocks Shopping ads and free Shopping listings. It needs the availability data from P1.1 to be accurate.
- **No hreflang or regional targeting** if you intend to serve beyond one region.

## P3.3 Testing is thin where it matters most

**Severity: P3 · Effort: 5d**

**Status:** Partially done — four new test files, but the specific gap this item names is still open

Four test files were added and they are good tests of the logic the P0 fixes depend on. `internal/handlers/payments_test.go` covers HMAC verification in hex and base64, a wrong secret, a tampered message, the key-secret versus webhook-secret distinction, `skipSignatureChecks` (including that a missing secret in production does *not* disable verification), webhook entity parsing, unique-violation detection and order token entropy. `internal/handlers/invoicing_test.go` covers financial-year boundaries, GST extraction from inclusive prices, `round2` and the cancellability rules — and writing it is what surfaced the `round2` negative-rounding bug. `internal/middlewares/ratelimit_test.go` covers fail-open versus fail-closed during a Redis outage. `internal/services/otp_proof_test.go` covers the proof token's single use, email binding and unguessability. CI runs all of it with `-race`.

But the sentence in this item that matters — "there are **no tests for any HTTP handler**" — is still true. A grep for `httptest` in `internal/handlers` returns nothing; the only `httptest` users are in `internal/middlewares`. The new tests all exercise pure helper functions, not request handling, so there is no `dockertest`-backed Postgres and no test that drives `VerifyPayment`, `CreateCheckoutOrder` or the auth endpoints end to end. The signature-rejection test this item asks for exists at the HMAC level but not at the handler level, so it would not have caught P0.1's control-flow fall-through. On the frontend, `lib/seo/seo.test.ts` is still the only test file, and there is no Playwright coverage of the purchase flow.

The backend has nine `_test.go` files and `go test ./...` passes, but coverage is concentrated on pure logic — fulfillment, quotation, cache, JWT, image optimisation. There are **no tests for any HTTP handler**, which means the payment flow, checkout, and auth have zero automated coverage. All four P0 findings in this document are the kind of thing a handler test would have caught.

The frontend has a single test file, `lib/seo/seo.test.ts`, with 39 passing tests all on SEO helpers. Cart, checkout, and the API client are untested. There is no end-to-end test of the purchase flow.

**Plan.** Add handler tests with `httptest` and a `dockertest`-backed Postgres, starting with payment verification, checkout, and auth. Add a signature-rejection test that would fail against today's P0.1 code. Add Vitest and React Testing Library for cart and checkout logic. Add one Playwright end-to-end test covering browse → cart → checkout → payment with Razorpay in test mode. Enforce all of it in the CI workflow from P2.6.

## P3.4 Code organisation and cleanup

**Severity: P3 · Effort: 3d**

**Status:** Partially done — one item of the ten, plus a sanitised template that still needs credentials rotated

Done: the dead `app/product/[slug]/cartItems.tsx` is deleted, confirmed gone from the directory and staged as a deletion in git.

Also done, but only halfway, and this is the one to act on. `apps/go-backend/example.env` has been rewritten as a clean template: every value is now blank or an obvious placeholder, the two Razorpay secrets are documented at length so they cannot be confused again, and the entries that `config.Load()` requires in production are marked `REQUIRED IN PRODUCTION`. **The file is still tracked in git and was never gitignored**, and the previous contents — including credential-shaped Razorpay keys and SMTP settings — remain in the history, reachable by anyone with repository access. Sanitising the working copy does not undo that. Anything that was ever real in that file needs rotating: the Razorpay key secret, the SMTP app password, and any API key that passed through it. Separately, `apps/web/example.env` was **not** sanitised and is also tracked; it still contains truncated Razorpay key values and a Google OAuth client ID.

Still outstanding, each verified against the current code:

- **Oversized files** — unchanged, and one got worse. `internal/handlers/auth.go` is 1,214 lines, `chat.go` is 1,099, and `app/checkout/page.tsx` has grown from 1,200 to 1,629 lines as the coupon field, guest verification step and new error handling were added to it. It is now the most urgent of the three.
- **`/product` redirect** — not done. `app/product/page.tsx` still carries the TODO and is still noindexed and canonicalised to `/categories` rather than redirecting.
- **Auth token stored three ways** — unchanged. `resolveAuthToken` in `lib/api.ts` still falls back through the Zustand store, a raw `localStorage.token`, and the persisted `auth-storage` blob.
- **No server-side route protection** — unchanged. `middleware.ts` still only does analytics and rate limiting.
- **Hardcoded values** — the Google Analytics measurement ID is still inline at `app/layout.tsx:150` and `:158`, with no environment variable read anywhere. The Google OAuth `"dummy"` fallback is still in both `app/login/page.tsx` and `app/signup/page.tsx`. The merchant email fallback in `internal/config/config.go` is unchanged.
- **Typos in paths** — `components/hompage/` and `RealatedProducts.tsx` both still exist.
- **Chat errors leak provider detail** — not fixed. `internal/handlers/chat.go` still returns `fmt.Sprintf("AI service error: %v", err)` in the 500 body, so the upstream provider's error text still reaches the client.

**Oversized files.** `internal/handlers/auth.go` is 1,216 lines covering password login, Google, phone OTP, Truecaller, password reset, and onboarding. `internal/handlers/chat.go` is 1,099. `app/checkout/page.tsx` is 1,200. All three are prime review-bottleneck and merge-conflict territory. Split `auth.go` by provider, and extract the checkout page's address form, OTP step, payment step, and order summary into components.

**Dead code.** `app/product/[slug]/cartItems.tsx` reads a legacy `localStorage` key `"cart"` (lines 11-17) and is imported nowhere; the live cart uses Zustand's `cart-storage`. Delete it. `/product` duplicates `/categories` and is already noindexed with a TODO to redirect (`app/product/page.tsx:8-14`) — do the redirect.

**Auth token stored three ways.** The Zustand persist store, a raw `localStorage.token`, and fallbacks in `resolveAuthToken` (`lib/api.ts:30-47`). Consolidate on one, and consider moving to an httpOnly cookie, which would also enable the server-side route protection noted below.

**No server-side route protection.** `middleware.ts` handles analytics and rate limiting but despite its name protects nothing. `/account`, `/orders`, and `/wishlist` are gated by a client-side redirect in `components/account/AccountShell.tsx:41-45`, which flashes content before redirecting. An httpOnly cookie plus a middleware check fixes both.

**Hardcoded values.** The Google Analytics ID is inline at `app/layout.tsx:150`. Google OAuth falls back to the literal string `"dummy"` when the env var is missing (`app/login/page.tsx:253`), which fails confusingly instead of loudly. The merchant email has a hardcoded fallback at `internal/config/config.go:134`.

**`example.env` is not gitignored** while `.env` is (`.gitignore:21-24`). It contains credential-shaped values including Razorpay test keys and SMTP settings. Confirm nothing real has ever been committed there, and consider rotating anything that looks plausible.

**Typos in paths.** `components/hompage/` and `RealatedProducts.tsx`. Worth fixing while touching them.

**Chat errors leak provider detail.** `internal/handlers/chat.go:201` can return the upstream AI provider's error in a 500 body. Log it, return something generic.

## P3.5 No admin panel

**Severity: P3 · Effort: 8d**

**Status:** Not started, and the case for it is now stronger

No dashboard was built. Meanwhile the admin API surface roughly doubled: `internal/server/router.go` now has an admin group covering inventory adjustment and low-stock listing, review moderation, refund listing and creation, invoice emailing, the GST report export, shipment booking and pickup scheduling, and coupon CRUD. Every one of those is currently operated by calling the API by hand. The closing observation in this item — "the backend endpoints largely exist already, this is mostly frontend work" — is more true than when it was written. Review moderation and coupon creation in particular are routine operational tasks that should not require a terminal.

Admin capability is scattered: a `/product/add` page on the frontend, plus admin-gated API endpoints for product CRUD, order status, expected delivery, and support requests. There is no dashboard. Managing the store means calling the API directly or using the database.

As order volume grows this becomes the operational bottleneck. A focused admin surface covering order management with search and filters, inventory editing, product CRUD with image upload, review moderation, refund processing, and a basic sales dashboard would pay for itself. The backend endpoints largely exist already — this is mostly frontend work.

## P3.6 DPDP Act compliance

**Severity: P3 (rising) · Effort: 4d**

**Status:** Partially done — the data-principal rights are implemented server-side; the consent banner, which is what the November 2026 deadline is actually about, is not

India's DPDP Rules 2025 were notified in November 2025. Consent-manager obligations begin **13 November 2026** and substantive compliance is due **13 May 2027**.

`internal/handlers/privacy.go` is new, with `consent_records`, `addresses` and `back_in_stock_requests` tables. The design satisfies the two obligations that pull in opposite directions, which is the hard part of this item: Rule 8(3) requires retaining transactional data and processing logs for at least a year even after account deletion, while Section 8(7) requires erasure once the purpose is served. So `POST /privacy/erase` scrubs identifiers *now* and retains a minimised order row for `transactionalRetention` (365 days), after which `SweepExpiredData` removes it — driven by `StartRetentionSweeper` from `cmd/server/main.go`. Erasure refuses while an order is in transit, because the courier still needs the address, then scrubs account identifiers, deletes addresses, wishlist and back-in-stock rows, anonymises reviews, and minimises order contact fields while keeping the transaction record. `POST /consent` records consent against a versioned `NoticeVersion` (`"2026-01"`), and withdrawal is recorded as a **new row** rather than a mutation, so consent history is an audit trail rather than a current-state flag.

Current state versus requirements:

| Requirement | Status |
|---|---|
| Granular, purpose-specific consent | Partial — `POST /consent` records granular purposes against a notice version, but nothing in `apps/web` calls it: there is no consent banner and no capture at signup or checkout |
| Itemised privacy notice | Partial — unchanged. `/privacy-policy` exists; still needs data-category and purpose itemisation, and should now cite `NoticeVersion` so records and notice stay aligned |
| Easy consent withdrawal | Partial — withdrawal is a supported `POST /consent` record; no UI to trigger it |
| Right to access and export data | Implemented — `GET /privacy/export` |
| Right to erasure | Implemented — `POST /privacy/erase`, with the Rule 8(3) retention floor respected |
| Purpose-limited retention | Implemented — `transactionalRetention` of 365 days enforced by `SweepExpiredData` on a scheduled sweep |
| Processing logs retained ≥ 1 year | Implemented — the minimised order row and consent records are retained for the floor |
| Grievance redressal mechanism | Not implemented — still support email only; no grievance officer named anywhere in `apps/web` |
| Breach notification readiness | Not implemented — no runbook |

The frontend half is the gap, and it is the half with the near deadline. `middleware.ts` still writes `vid` and `sid` tracking cookies unconditionally, and Google Analytics still loads from `app/layout.tsx` with no consent gate — a grep for "consent" across `apps/web` returns nothing. Recording consent through an API that no page calls does not make the tracking lawful; the banner has to exist and has to actually gate the GA script and the cookie writes.

Note that Rule 8(3) requires retaining order data and processing logs for at least one year from the transaction *even if the user deletes their account* — so erasure and retention need to be designed together rather than as a blanket delete.

**Plan.** Add a consent banner with granular analytics and marketing toggles that actually gate the GA script and the tracking cookies. Add a consent record table with timestamps and versioning. Build data export and erasure endpoints that respect the one-year transactional retention floor. Write a documented retention policy with a scheduled sweep. Name a grievance officer on the site. Draft a breach response runbook.

## P3.7 Performance and platform

**Severity: P3 · Effort: 3d**

**Status:** Not started

Every item below is unchanged. A grep for `next/dynamic` across `app/`, `components/` and `lib/` still returns nothing, so the chatbot, the store locator map, Lottie and the Razorpay SDK are all still in the first-paint bundle. There is no `@next/bundle-analyzer` and no size budget in the new CI workflow. There is no `web-vitals` beacon. `HYPERDRIVE_URL` is still read but Hyperdrive is not in use. The search cache TTL is still three minutes, hardcoded at the `GetOrLoadRaw` call in `internal/handlers/products.go` rather than as a named constant alongside the others in `internal/cache/cache.go`, which is part of why it is easy to overlook.

The Cloudflare setup is already sensible: edge caching for `/_next/image` in `worker.ts:33-60`, KV incremental cache, a Durable Object revalidation queue, AVIF and WebP with a 30-day TTL, and `public/_headers` for static assets. Remaining opportunities:

- **No `next/dynamic` anywhere.** A grep returns nothing. The chatbot, the store locator map, Lottie, and the Razorpay SDK are all good candidates for lazy loading — every one of them is heavy and none is needed for first paint.
- **No bundle analysis.** Add `@next/bundle-analyzer` and set a size budget in CI.
- **No real Core Web Vitals monitoring.** Cloudflare Web Analytics or a `web-vitals` beacon into the existing Workers Analytics Engine pipeline would give you field data rather than lab data.
- **Consider Cloudflare Hyperdrive.** `config.go` already reads `HYPERDRIVE_URL`, so the groundwork is there; it would cut Postgres connection latency from the edge meaningfully.
- **Search cache TTL is short.** Three minutes (`internal/cache/cache.go:24-57`) against a catalog that changes rarely. Lengthen it and rely on the existing `invalidateCatalog()` on write.

---

# Suggested sequencing

The original twelve-week plan is recorded below with each phase's state. The work did not follow it week by week — most of the backend across all five phases landed together — so the phases are better read as scopes than as a schedule.

**Week 1 — stop the bleeding. Complete in code; two operational follow-ups outstanding.** All of P0 is implemented: the payment signature is enforced, the webhook secret is separate and required in production, webhook handling is idempotent and async, `GET /order` is locked down, the price-tampering paths are closed, and checkout is gated on a server-side OTP proof. The two actions in this phase that are not code have not been reported as done and should be: checking the Razorpay dashboard for the historical wall of webhook 401s, and reconciling every paid order against Razorpay to find any that were marked paid without a valid payment during the window when P0.1 was exploitable. The `check-user` enumeration oracle from P0.4 is also still open.

**Weeks 2-3 — foundations. Mostly complete; error tracking and handler tests are not.** Inventory (P1.1), order lifecycle transactions (P2.1), scoped auth middleware (P1.5), the readiness probe (P2.2) and CI with type-checking enabled (P2.6) are all done. Error tracking (P2.4) has not started. The handler tests this phase explicitly wanted were not written — the new tests cover helpers, not handlers — and the P0 fixes are no longer fresh, so this is the item most at risk of never getting done.

**Weeks 4-6 — commerce completeness. Backend complete; the customer-facing half is not.** Reviews (P1.2), refunds and cancellation (P1.3) and Shiprocket automation (P1.4) all work through the API. But this phase's stated goal was eliminating manual operations and support load, and that depends on the storefront: with no review form, no cancel button and no tracking page, the "where is my order" contacts this phase was meant to remove still arrive. Shipping the three UI surfaces is the highest-leverage work remaining.

**Weeks 7-9 — revenue. Half complete.** Coupons (P1.6) and GST invoicing (P1.7) are done, with a coupon field live on the checkout page. Abandoned-cart recovery, search improvements and the P3.1 conversion items have not started.

**Weeks 10-12 — scale and polish. Largely outstanding.** DPDP compliance (P3.6) is half done — the data-principal rights are implemented, the consent banner is not, and that half has the 13 November 2026 deadline, so it should move ahead of everything else in this phase. The admin panel (P3.5), performance work (P3.7), code organisation (P3.4) and the remaining test coverage (P3.3) have not started.

**What to do next**, given the above: the consent banner, then the storefront surfaces for the APIs that already exist (review form, cancel button, invoice link, address book, tracking page), then error tracking, then handler tests, then the admin panel. And rotate the credentials that passed through `example.env`, which is not a scheduling decision.

---

# Quick wins

Each of these was under an hour and independently shippable. Seven of the twelve are done; the five that remain are still under an hour each and are the cheapest outstanding work in this document.

| Change | Location | Status |
|---|---|---|
| Reject unsigned and bad-signature payments | `handlers/payments.go:249-254` | Done |
| Mount `FullAuthMiddleware` on the authenticated group | `server/router.go:156-173` | Done |
| Require `fulfillment_channel` so repricing can't be skipped | `handlers/fulfillment.go:295` | Done |
| Delete the legacy `CreateRazorpayOrder` route | `handlers/payments.go:135`, `server/router.go` | Done |
| Delete dead `cartItems.tsx` | `app/product/[slug]/cartItems.tsx` | Done |
| Add `app/global-error.tsx` | `apps/web/app/` | Done |
| Add a DB ping to a new `/readyz` | `handlers/health.go` | Done |
| Redirect `/product` → `/categories` | `app/product/page.tsx:13-14` | Not started — TODO still in place |
| Move the GA ID to an environment variable | `app/layout.tsx:150` | Not started — still inline at `:150` and `:158` |
| Add `example.env` to `.gitignore` | `.gitignore` | Not started — both `example.env` files are still tracked. See the note below before doing this |
| Fill in the `LocalBusiness` address and geo TODO | `lib/seo/jsonLd.ts:80-81` | Not started — needs the nursery's exact address and coordinates |
| Stop returning the AI provider error to clients | `handlers/chat.go:201` | Not started |

Two notes on that table. The `example.env` row is no longer the whole fix: `apps/go-backend/example.env` has since been rewritten as a clean template, so gitignoring it now would stop the template from reaching new contributors — deliberately keeping a sanitised template tracked is the better arrangement. What that row should become is "rotate the credentials that were committed to `example.env`", since gitignoring a file does nothing about git history, and "sanitise `apps/web/example.env`", which still holds credential-shaped values.

And `/readyz` existing is not the same as it being used — the orchestrator's readiness probe still needs pointing at it.

---

# Where the code is already good

Worth preserving as you refactor. The list below is as written at audit time and all of it still holds; the new code has followed the same patterns, which is why this section is worth keeping:

- **The fulfillment quoting engine** (`internal/fulfillment/`, `handlers/fulfillment.go`) is genuinely well designed — zone resolution, channel availability with reasons, server-authoritative repricing, and courier cost tracking for subsidy analysis. The `amount_mismatch` response shape is a good pattern to copy elsewhere.
- **The caching layer** (`internal/cache/cache.go`) does L1 plus Redis with singleflight deduplication, per-entity TTLs, and ETag support. Thoughtful work.
- **The Shiprocket client's resilience** — circuit breaker, token caching, and tolerant JSON unmarshalling via `flexFloat` and `flexInt` for an API that returns inconsistent types.
- **SEO architecture** (`lib/seo/`) is better organised than most production storefronts, and it is the one area with real test coverage.
- **Code comments throughout the Go backend** explain intent and trade-offs rather than restating the code. The comments are also what made several findings in this document easy to confirm — including three that the comments themselves flag as known gaps.
- **The internal documentation** under `internal/docs/` with an embedded OpenAPI spec and Swagger UI.

Two patterns the remediation added that are worth copying rather than reinventing. The first is putting a concurrency check inside a SQL `WHERE` clause and treating `RowsAffected` as the answer, so the database arbitrates rather than Go: the inventory reservation, the webhook dedup claim, the inventory release claim, the conditional coupon usage increment and the exactly-once paid transition in `markOrderPaid` are all the same shape. The second is writing a local record *before* calling a payment provider, so a provider timeout can never move money with no trace on our side — see `internal/handlers/refunds.go` and `bookShipment`'s persist-then-request-AWB ordering in `internal/handlers/shipments.go`.
