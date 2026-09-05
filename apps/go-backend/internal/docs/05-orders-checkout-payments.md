# Checkout, Payments & Orders

Payment processing is Razorpay-based (Indian payment gateway). There are two
order-creation endpoints for backward compatibility (see
[§ legacy endpoint](#the-legacy-razorpayorder-endpoint-internalhandlerspaymentsgo)),
but both share the same item/product validation, and both paid-order
transitions (client-verify and webhook) share the same finalize/notify
logic — see [SYSTEM-DESIGN.md §11](./SYSTEM-DESIGN.md#11-trade-offs--where-this-would-need-to-change).

## Route wiring (`internal/server/router.go`)

```
POST /api/v1/checkout/send-email-otp     → SendEmailOTP       (rate-limited: "checkout" 20/min)
POST /api/v1/checkout/verify-email-otp   → VerifyEmailOTP
POST /api/v1/checkout/create-order       → CreateCheckoutOrder
POST /api/v1/razorpay/order              → CreateRazorpayOrder     (legacy/simple variant)
POST /api/v1/razorpay/verify             → VerifyPayment
GET  /api/v1/order                       → GetOrder
POST /webhooks/razorpay                  → RazorpayWebhook      (top-level, no /api/v1, no JWT)
GET  /api/v1/orders                      → ListOrders   (private — JWT required)
PATCH /api/v1/orders/{id}/status                    → UpdateOrderStatus   (admin)
PATCH /api/v1/orders/{id}/expected-delivery-date    → UpdateOrderExpectedDeliveryDate  (admin)
GET/PATCH /api/v1/order-support-requests[/...]      → order support tickets (private/admin)
```

## Guest checkout flow (`internal/handlers/checkout.go`)

This is the flow the storefront actually uses for a normal purchase — it
does **not** require the buyer to have an account beforehand:

1. **`POST /checkout/send-email-otp`** — validates email format
   (`services.ValidateEmail`), rejects if a `User` already exists with that
   email (`409 user_exists` — existing users should log in and use their
   saved address instead), then generates + emails a 6-digit OTP via
   `services.OTPService`/`services.EmailService` with a 60s resend cooldown.
2. **`POST /checkout/verify-email-otp`** — verifies the OTP
   (bcrypt-compared, single-use — deleted on success).
3. **`POST /checkout/create-order`** (`CreateCheckoutOrder`) — validates
   `CustomerCheckoutInfo` (pincode `^[1-9][0-9]{5}$`, phone
   `^[6-9][0-9]{9}$`, email format), then calls `buildOrderItems`
   (`internal/handlers/payments.go`) to batch-validate every line item —
   every product and product-size exists, and any size belongs to its
   claimed product, each checked with one `WHERE id IN (...)` query rather
   than N+1 — and snapshot product name + image key onto each `OrderItem`
   (so the order record is self-contained even if the product is later
   edited/deleted). It then converts the rupee amount to paise
   (`amount * 100`), creates the order in Razorpay
   (`h.createRazorpayOrder`), and persists a local `Order` + `OrderItem`s
   row with `PaymentStatus: "created"`, `Status: "pending"`.

Note: `CreateCheckoutOrder` does **not** itself re-check the email-OTP was
verified for *this* request — OTP verification and order creation are
separate, trusted-by-sequence steps driven by the frontend flow, not
cryptographically linked.

## The legacy `/razorpay/order` endpoint (`internal/handlers/payments.go`)

`CreateRazorpayOrder` is a lighter-weight sibling of `CreateCheckoutOrder`,
kept for backward compatibility: same Razorpay order creation call and the
same `buildOrderItems` item validation, but a single free-form address
string instead of a structured, format-validated shipping address. Both
endpoints are live in the router; `CreateCheckoutOrder` (the OTP-gated one)
is what `checkout/create-order` uses and is the one actively exercised by
the current frontend checkout.

## Payment verification (`internal/handlers/payments.go`)

`POST /razorpay/verify` (`VerifyPayment`):
1. Requires `razorpay_order_id` + `razorpay_payment_id`.
2. If a `razorpay_signature` was sent and the app isn't in
   dev/test/no-secret mode, verifies it via HMAC-SHA256
   (`verifyRazorpaySignature` → shared `verifyRazorpayHMAC` primitive) over
   `orderID|paymentID`. **Note:** a signature mismatch is currently only
   **logged**, not rejected — the handler proceeds to mark the order paid
   regardless. This means signature verification is effectively advisory
   right now, not enforced (unlike the webhook's signature check below,
   which does reject).
3. Looks up the local `Order` by `razorpay_order_id`, then calls the shared
   `markOrderPaid(&order, paymentID)`, which: flips `PaymentStatus`/`Status`
   to `"paid"`, inserts a `Payment` row (`Status: "captured"`), and
   best-effort creates/links a **soft account** (`CreateSoftAccount`,
   `checkout.go`) if the order has a customer email and no matching `User`
   exists yet — a random, never-shown 16-byte hex password
   (`EmailVerified: true`; the customer uses "forgot password" to set a
   real one). `markOrderPaid` returns whether this call made the order's
   *first* transition to paid.
4. `notifyOrderPaid(order, firstTimePaid)` sends the order-confirmation
   email and merchant alert — but only on that first transition, so calling
   verify twice (or racing with the webhook below) never double-sends.

## Webhook (`internal/handlers/webhooks.go`)

`POST /webhooks/razorpay` is mounted **outside** `/api/v1` with no JWT — its
only authentication is the `X-Razorpay-Signature` header, verified via the
same `verifyRazorpayHMAC` helper over the **raw request body** (this one
*does* reject on mismatch, `401`). Handles the `payment.captured` event;
`handlePaymentCaptured` extracts the order/payment IDs from the payload and
then calls the **same** `markOrderPaid`/`notifyOrderPaid` pair `VerifyPayment`
uses above — the client-driven verify call and the async server-to-server
webhook can independently race to confirm the same payment, and sharing
these two functions is what guarantees only one of them ever sends the
confirmation email. If the order can't be found by `razorpay_order_id`, the
webhook logs and returns success anyway (`return nil`) rather than erroring —
Razorpay would otherwise retry indefinitely for an order it doesn't
recognize.

## Order listing & admin management (`internal/handlers/orders.go`)

`GET /orders` (`ListOrders`, JWT required): a regular user sees only their
own orders (`user_id = ?`); `admin`/`superadmin` roles see all orders by
default, unless the request explicitly passes `scope=self`. Supports
`status`, `orderId`, `search` (matches customer name/phone/email,
case-insensitive `LIKE`), and standard pagination. Results (data + total
count, as two separate cache entries) are cached — see
[04-caching.md](./04-caching.md).

`PATCH /orders/{id}/status` and `PATCH /orders/{id}/expected-delivery-date`
are admin-only (`claims.Role` checked inline, not via router-level
`AdminMiddleware`). Status updates go through an allow-list (`pending`,
`confirmed`, `shipped`, `out_for_delivery`, `delivered`, `cancelled`,
`failed`, `paid`) and additionally sync `payment_status` for some
transitions (`delivered`/`paid` → `payment_status: paid`;
`failed`/`cancelled` → `payment_status` mirrors status). Both handlers
invalidate the `orders:*` cache pattern and return the updated order with
`Items`/`User` preloaded and image URLs resolved.

## Order support tickets (`internal/handlers/order_support.go`)

A lightweight ticketing system, fed almost entirely by the chat assistant
(see [06-chat-and-ai.md](./06-chat-and-ai.md)) rather than a dedicated UI
form:

- `detectOrderSupportIntent(msg)` / `classifyOrderIssueType(msg)` — keyword
  heuristics used by the chat handler to decide "this message is an
  escalation" and to bucket it (`refund`, `tracking`, `delivery_delay`,
  `order_support`).
- `handleOrderSupportChat` builds an `OrderSupportRequest` row, snapshotting
  order status/payment/amount/items/expected-delivery at ticket-creation
  time (so the ticket remains meaningful even if the order later changes).
  If the same logged-in user already has an open (`status: pending`) ticket
  for the same order, it **reuses** that ticket instead of creating a
  duplicate.
- `GET /order-support-requests` / `PATCH /order-support-requests/{id}/status`
  — admin-only listing and status transition (`pending`/`in_progress`/
  `resolved`) with optional admin notes.

## Requested products (`internal/handlers/requested_products.go`)

A separate, simpler "demand signal" table (`models.RequestedProduct`) for
when a customer asks for something not in the catalog:
- `POST /requested-products` — public, optionally attaches the requester's
  user ID if a valid JWT happens to be present (`appauth.FromContext`, not
  `Require` — auth is optional here).
- `GET /requested-products` — admin-only listing.
- Also auto-created by the chat handler (`maybeAutoCreateRequestedProduct`,
  `Source: "chatbot_auto"`) when a user's message strongly implies they
  couldn't find a product — see [06-chat-and-ai.md](./06-chat-and-ai.md).
