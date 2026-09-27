# Checkout, Payments & Orders

Payment processing is Razorpay-based (Indian payment gateway). There are two
order-creation endpoints for backward compatibility (see
[§ legacy endpoint](#the-legacy-razorpayorder-endpoint-internalhandlerspaymentsgo)),
but both share the same item/product validation, and both paid-order
transitions (client-verify and webhook) share the same finalize/notify
logic — see [SYSTEM-DESIGN.md §11](./SYSTEM-DESIGN.md#11-trade-offs--where-this-would-need-to-change).

## Route wiring (`internal/server/router.go`)

```
POST /api/v1/checkout/quote              → QuoteFulfillment   (rate-limited: "checkout" 20/min)
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

## Fulfillment rules (`internal/fulfillment`, `internal/handlers/fulfillment.go`)

Growman runs one Hyderabad store, so delivery is not one product but four
channels with very different economics, and checkout's job is to route each
order to the right one:

| Channel | Used for | Fee |
| --- | --- | --- |
| `store_pickup` | Anyone, always offered | none |
| `courier` | Small/medium plants, up to `CourierMaxUnits` (8), inside the retail radius | ₹59–₹179 by zone |
| `own_vehicle` | Large or bulky items, subtotal ≥ `OwnVehicleMinSubtotal` (₹2,500) | ₹299–₹799 by zone |
| `bulk_quote` | ≥10 plants, ≥₹15,000, XL stock, or beyond the retail radius | priced by sales |

Distance is banded into zones (`store_local` ≤10 km, `near` ≤20, `mid` ≤30,
`far` ≤50, `outside` beyond) rather than charged per kilometre, so a fee is
predictable and a few kilometres of geocoding error does not change the
price.

`RetailMaxZone` (`RETAIL_MAX_ZONE`, default `far` = the full 50 km radius)
caps self-serve delivery. Past it, neither courier nor vehicle is offered at
any price and the order is marked `BulkRequired`: a long-haul drop is a
custom job to be priced by hand, not something to guess a retail fee for.
The web checkout surfaces that as a highlighted **Custom Delivery** row
instead of a delivery fee.

`ZoneUnknown` is excluded from the retail range whatever the cap, because it
is the *absence* of a distance rather than a large one — quoting ₹179 for an
address that might be 20 km or 200 km away is a bet Growman loses.

Pincode resolution therefore has three tiers, which matters because only
~45 localities are mapped:

1. A mapped locality gets real coordinates and an exact band
   (`distanceSource: "pincode"`).
2. Any other **500xxx** pincode is Hyderabad city, so it is assumed inside
   the radius and priced at the `mid` band
   (`distanceSource: "pincode_prefix"`). Without this tier the majority of
   genuine Hyderabad customers would be pushed to a custom quote purely
   because their locality is missing from the table.
3. An unmapped **501/502** district pincode stays `ZoneUnknown` — those
   districts sprawl well past 50 km, so proximity cannot be assumed.

**Store pickup is always available**, at any distance and with no address at
all. Whether a drive is worth making is the customer's decision, and
refusing the option based on a pincode only removes a sale Growman would
have taken for free. Distance comes from browser coordinates when the customer allows
geolocation, otherwise from the pincode-centroid table in
`internal/fulfillment/pincode.go` measured against the store; an unmapped
pincode in the 500/501/502 series is serviceable but priced at the `far`
band, and anything else is `outside`.

`internal/fulfillment` is pure logic — no DB, no HTTP — so every threshold
lives in one `Policy` struct, overridable from config (`STORE_LATITUDE`,
`FREE_DELIVERY_MIN_SUBTOTAL`, `BULK_MIN_UNITS`, …; see `example.env`).
**The free-delivery waiver is off by default:** `FreeDeliveryMinSubtotal` of
0 disables it, because subsidising delivery before the real courier cost
per order is known is guesswork. Once there is order data, setting it (e.g.
999) waives the courier fee up to the `near` zone and marks the order
`DeliveryFeeWaived` so the subsidy stays measurable.

### Shiprocket (`internal/shiprocket`)

The courier leg is a hybrid: Shiprocket decides **whether** a pincode can
be delivered, Growman decides **what to charge** for it.

`Handler.courierQuote` calls Shiprocket's serviceability endpoint with the
store's `STORE_PINCODE` as origin, the customer's pincode, and an estimated
weight (`Policy.WeightKgBySizeClass` — potted-plant averages, since there
is no weight column yet), then picks the cheapest courier offered. The
result feeds `Policy.QuoteWith` as a `CourierQuote`, and three outcomes
matter:

- **Serviceable** — the customer pays the zone fee band as usual, and
  Shiprocket's rate is recorded as the order's `CourierCost` alongside the
  carrier it chose (`CourierService`). Nothing about the customer's price
  changes; this is purely the cost side, so the delivery subsidy is known
  at checkout instead of being keyed in later.
- **Definitively not serviceable** — the courier option becomes unavailable
  with reason `courier_not_serviceable`, leaving store pickup, own vehicle
  or a bulk quote.
- **Not checked** — no credentials, no `STORE_PINCODE`, a timeout, or an
  API error. `CourierQuote.Checked` stays false and the courier remains
  available on the static fee bands. A slow or broken third-party API must
  not be able to stop Growman taking orders, so only a definite "no" blocks
  a sale.

`CourierCost` and the carrier name are marked `json:"-"` on the quote: the
quote is serialised straight to the browser, and Growman's cost is margin
information. A test asserts they do not leak.

Lookups are cached in Redis for 6 hours per origin/destination/weight
bucket (rounded to 0.5 kg), because coverage changes on the order of days
while a customer editing their cart can trigger several quotes a minute.

Two things keep a sick Shiprocket from slowing checkout down. `quoteCart`
prices the cart against the rules first and only calls out when a courier
delivery is genuinely on the table, so a cart of large plants or an address
past the radius costs no round trip. And the client has a breaker: after
three consecutive failures it returns `ErrCircuitOpen` without calling out
for five minutes, then lets one probe through. Bad credentials or a dead
endpoint would otherwise cost *every* quote a login plus a 4-second
timeout. `ErrCircuitOpen` and `ErrNotConfigured` are expected steady
states, so neither is logged per quote.

**Authentication:** Shiprocket issues no static API key. Credentials are
exchanged at `POST /v1/external/auth/login` for a JWT valid 240 hours, so
`SHIPROCKET_EMAIL`/`SHIPROCKET_PASSWORD` must be those of a dedicated **API
user** created in the Shiprocket panel (Settings → API → Configure →
Create an API User) on an email that is *not* the dashboard login — up to
four are allowed, with per-module access. The token is cached in-process
for 9 days and discarded on a 401 so the next call re-logs in.
`SHIPROCKET_TOKEN` can supply a token directly, which avoids storing a
password but is not auto-renewed; when both are present the token is used
until rejected and the credentials then take over.

Only the read-only serviceability endpoint is used. Shipment creation, AWB
assignment and tracking are still manual in the Shiprocket dashboard.

Two endpoints use it:

- **`POST /checkout/quote`** (`QuoteFulfillment`) — read-only, called on
  every cart or address change. Returns each channel with its fee and, when
  unavailable, a machine-readable `reason` (`plant_too_large`,
  `too_many_plants`, `below_minimum_order`, `outside_delivery_radius`,
  `courier_not_serviceable`, …), plus a `recommended` channel. The web
  checkout renders only the available ones — a greyed row explaining that a
  plant is too large to courier is noise the shopper cannot act on — but the
  reasons stay in the response for support and debugging. Nearby customers
  are recommended `store_pickup` even though the courier remains available:
  a nudge, not a restriction, since a store visit costs nothing to serve and
  tends to sell more than the cart.
- **`POST /checkout/create-order`** — when the request carries a
  `fulfillmentChannel`, the quote is **re-derived** and the order refused
  with `409` unless that channel is still available
  (`channel_unavailable`) and `amount` equals subtotal + fee within ₹1
  (`amount_mismatch`); the current quote is returned so the client can
  re-present the options. Quoting and paying are separate requests, so the
  cart or address may change in between — re-deriving is what stops a
  client selecting a channel it is not entitled to or paying a fee it
  invented. `bulk_quote` is rejected outright here; it has no agreed price
  until sales sends one (`POST /quotations`).

Both paths price the cart from **database** product/size prices via
`resolveCart`, never the `price` field in the request. Note that
`buildOrderItems` still snapshots the client's per-line price onto each
`OrderItem`, so a tampered payload can still produce line items that don't
sum to `Order.Subtotal` — the total charged is safe, the per-line record is
not yet.

Requests with no `fulfillmentChannel` are accepted unchanged, recording
`amount` as the subtotal with no channel, so a client predating these rules
keeps working.

Plant size comes from `Product.SizeClass` (`small`/`medium`/`large`/`xl`)
and `Product.Bulky`, with nullable overrides on `ProductSize` — a 14-inch
pot of the same plant can need the van while the 6-inch ships by courier.
Unrecognised values normalise to `small`: a mis-tagged product then fails a
courier pickup, which ops notice, rather than silently becoming quote-only
and losing the order invisibly. Both are settable through the existing
admin product create/update payloads.

Each order records `FulfillmentChannel`, `FulfillmentZone`, `Subtotal`,
`DeliveryFee`, `DeliveryFeeWaived`, `DistanceKm`, `DistanceSource`,
`CourierProvider`, `CourierService` and `CourierCost`. The gap between the
cost and the fee is the delivery subsidy (`Order.DeliverySubsidy()`), which
is the number that tells you whether a free-delivery threshold is
affordable.

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
