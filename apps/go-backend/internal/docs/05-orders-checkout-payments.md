# Checkout, Payments & Orders

Payment processing is Razorpay-based (Indian payment gateway). There is one
order-creation endpoint — `POST /checkout/create-order` — and both
paid-order transitions (client-verify and webhook) share the same
finalize/notify logic, so an order is confirmed, invoiced and emailed
exactly once however it gets there — see
[SYSTEM-DESIGN.md §11](./SYSTEM-DESIGN.md#11-trade-offs--where-this-would-need-to-change).

## Route wiring (`internal/server/router.go`)

```
POST /api/v1/checkout/quote              → QuoteFulfillment   (rate-limited: "checkout" 20/min, fail-closed)
POST /api/v1/checkout/send-email-otp     → SendEmailOTP       ("checkout" 20/min)
POST /api/v1/checkout/verify-email-otp   → VerifyEmailOTP     ("checkout" 20/min)
POST /api/v1/checkout/create-order       → CreateCheckoutOrder ("checkout" 20/min)
POST /api/v1/checkout/validate-coupon    → ValidateCoupon     ("checkout" 20/min)
POST /api/v1/razorpay/verify             → VerifyPayment
GET  /api/v1/order                       → GetOrder            (OptionalAuthMiddleware)
GET  /api/v1/orders/{id}/invoice         → GetOrderInvoice     (OptionalAuthMiddleware)
POST /webhooks/razorpay                  → RazorpayWebhook     (top-level, no /api/v1, no JWT)
POST /webhooks/shiprocket                → ShiprocketWebhook   (top-level, no /api/v1, no JWT)
POST /api/v1/products/{slug}/back-in-stock → CreateBackInStockRequest (public)

GET  /api/v1/orders                      → ListOrders          (private — full-scope JWT)
POST /api/v1/orders/{id}/cancel          → CancelOrder         (private — owner, or admin for any order)
GET/PATCH /api/v1/order-support-requests[/...]      → order support tickets (private/admin)

PATCH /api/v1/orders/{id}/status                    → UpdateOrderStatus   (admin)
PATCH /api/v1/orders/{id}/expected-delivery         → UpdateOrderExpectedDeliveryDate  (admin)
POST /api/v1/orders/{id}/refund          → CreateRefund        (admin)
GET  /api/v1/refunds                     → ListRefunds         (admin)
POST /api/v1/orders/{id}/invoice/email   → EmailOrderInvoice   (admin)
GET  /api/v1/reports/gst                 → ExportGSTReport     (admin)
POST /api/v1/orders/{id}/shipment        → CreateShipment      (admin)
POST /api/v1/orders/{id}/shipment/pickup → SchedulePickup      (admin)
POST /api/v1/inventory/adjust            → AdjustStock         (admin)
GET  /api/v1/inventory/low-stock         → ListLowStock        (admin)
GET/POST/PUT/DELETE /api/v1/coupons[/{id}]          → coupon CRUD (admin)
```

The private group runs under `FullAuthMiddleware`, not `AuthMiddleware`: a
token of any scope is not enough to read orders or cancel one, because a
half-registered phone signup carries no verified identity — see
[02-auth.md](./02-auth.md).

## Guest checkout flow (`internal/handlers/checkout.go`)

This is the flow the storefront uses for a normal purchase — it does **not**
require the buyer to have an account beforehand:

1. **`POST /checkout/send-email-otp`** — validates email format
   (`services.ValidateEmail`), rejects if a `User` already exists with that
   email (`409 user_exists` — existing users should log in and use their
   saved address instead), then generates + emails a 6-digit OTP via
   `services.OTPService`/`services.EmailService` with a 60s resend cooldown.
2. **`POST /checkout/verify-email-otp`** — verifies the OTP
   (bcrypt-compared, single-use — deleted on success) and then mints a
   **verification proof** via `OTPService.IssueVerificationProof`
   (`internal/services/otp.go`), returned as
   `{"verificationToken": "<64 hex>", "expiresIn": 900}`.
3. **`POST /checkout/create-order`** (`CreateCheckoutOrder`) — validates the
   address, proves the email, prices the cart, reserves the stock, applies
   any coupon, creates the Razorpay order, and commits the local `Order`.

### The verification proof, and why the OTP cannot be it

The OTP itself cannot be replayed to `create-order`: it is deleted when it
is verified, which is correct for a single-use code. Re-sending it to the
client to be presented again would turn a 6-digit number into a bearer
credential with a five-minute window and no binding to the verification
event. So verification mints a separate opaque token instead — 32 random
bytes hex-encoded, stored in Redis under `checkout:verified:<email>` with a
`VerificationProofTTL` of 15 minutes, bound to exactly one address,
compared in constant time, and *claimed* on use — the delete is conditional
on the key still holding that token, so of several concurrent requests only
one can hold the proof and one verification cannot place two orders. See
[02-auth.md](./02-auth.md#7-checkout-email-verification-guest-proof-token)
for why a plain delete after the comparison is not enough.

`CreateCheckoutOrder` consumes it with `ConsumeVerificationProof` for
unauthenticated callers; a missing, expired, mismatched or already-spent
token is a `403 email_not_verified`. A signed-in caller skips the whole
step — their JWT already attests to a verified account. Without the proof
the OTP gate would be advisory: anything could call the order endpoint
directly and write orders against an address it had never proved it
controlled.

### What `create-order` actually does

1. `CustomerCheckoutInfo.Validate()` — pincode `^[1-9][0-9]{5}$`, phone
   `^[6-9][0-9]{9}$`, email format.
2. The guest's verification proof is consumed (above).
3. `buildOrderItems` (`internal/handlers/payments.go`) batch-validates every
   line — each product and product-size exists, and any size belongs to its
   claimed product, all with one `WHERE id IN (...)` query rather than
   N+1 — and snapshots name, image key **and price** onto each `OrderItem`
   from the `products`/`product_sizes` rows. A size price overrides the
   product price, and the size label is appended to the snapshotted name.
   `OrderItemRequest.Price` is advisory client state and is never written:
   trusting it would let a caller put arbitrary prices into order history
   even though the order total is independently repriced.
4. `checkStockAvailability` (`internal/handlers/inventory.go`) checks every
   line up front, so the ordinary "someone bought the last one while you
   were typing your address" case produces a clear `409 out_of_stock`
   naming the offending lines instead of a reservation conflict deeper in.
5. `resolveOrderFulfillment` (`internal/handlers/fulfillment.go`) re-derives
   the delivery quote and pins `Amount` to the server's own
   subtotal + fee — see
   [§ fulfillment rules](#fulfillment-rules-internalfulfillment-internalhandlersfulfillmentgo).
6. `applyCheckoutCoupon` evaluates any `couponCode` against the server-side
   subtotal and subtracts the discount it is willing to honour. Order
   matters: the amount has already been pinned to the server's arithmetic by
   step 5, so subtracting here keeps the charged figure entirely
   server-derived.
7. The Razorpay order is created from that amount in paise
   (`int(amount*100+0.5)`), and a `PublicToken` is minted (`newOrderToken`,
   32 random bytes hex-encoded).
8. The `Order` row, its `OrderItem`s, the stock reservation and the coupon
   redemption all commit in **one transaction**. An order that exists
   without its reservation would oversell; a reservation without an order
   would leak stock; a redemption without an order would burn a customer's
   single-use code for nothing.

The order lands with `PaymentStatus: "created"` and `Status: "pending"`, and
the response carries `publicToken` — the handle the post-payment success
page uses to read the order back without being signed in.

### Error responses from `POST /checkout/create-order`

Everything here uses the standard `{"error": "..."}` shape
(`pkg/httpjson`). The machine-readable codes below are the ones the web
checkout branches on; the remaining failures are plain human-readable
messages for a payload the UI should never have sent.

| Status | `error` | Meaning |
| --- | --- | --- |
| 400 | `fulfillment_channel_required` | No delivery option chosen. Also carries `reason`. |
| 403 | `email_not_verified` | Guest's proof token missing, expired, mismatched or already spent |
| 409 | `out_of_stock` | Not enough stock. Carries `items` (the offending lines with `requested`/`available`) from the pre-flight check, or `reason` when the reservation itself lost the race |
| 409 | `channel_unavailable` | Chosen channel can't serve this cart or address. Carries `reason` and the current `quote` |
| 409 | `amount_mismatch` | Server repriced the cart. Carries `expectedAmount` and the current `quote` |
| 422 | `coupon_rejected` | Carries `reason` — invalid, expired, fully redeemed, not applicable to this cart, below the minimum, already used by this customer, or would take the order under ₹1 |

The plain-message failures are: `400 invalid request body`, the three
address-format messages (`invalid pincode format`, `invalid phone number
format`, `invalid email format`), `400 amount must be greater than 0`,
`400 cart is empty`, `400 too many items in cart` (over `maxCartLines`,
100), `400 invalid item quantity` (outside 1…`maxLineQuantity`, 1000),
`400 product with ID %d not found`, `400 product size with ID %d not found
for product %d`, `400 unknown fulfillment channel`, `400 bulk orders are
quoted by sales, not paid at checkout`, and `500` for a database, Razorpay
or Redis failure.

Both `out_of_stock` shapes exist deliberately: the pre-flight check can
name every short line at once, while a reservation that loses the race
inside the transaction knows only which line it lost on.

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

### Shiprocket serviceability (`internal/shiprocket`)

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

Two checkout endpoints use the serviceability lookup:

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
- **`POST /checkout/create-order`** — the quote is **re-derived** and the
  order refused with `409` unless the chosen channel is still available
  (`channel_unavailable`) and `amount` equals subtotal + fee within ₹1
  (`amountTolerance`, `amount_mismatch`); the current quote is returned so
  the client can re-present the options. Once they agree to within
  rounding, the *server's* figure is charged, not the client's. Quoting and
  paying are separate requests, so the cart or address may change in
  between — re-deriving is what stops a client selecting a channel it is
  not entitled to or paying a fee it invented. `bulk_quote` is rejected
  outright here; it has no agreed price until sales sends one
  (`POST /quotations`).

**`fulfillmentChannel` is required**, and deliberately so.
`resolveOrderFulfillment` is the only thing that reprices a cart against
the database, so treating an absent channel as "no delivery decision to
check" and accepting the client's `amount` verbatim would make the entire
repricing check skippable by omitting one field. There is no legitimate
order without a channel, so omitting it is a `400
fulfillment_channel_required`.

Both the quote and the order path price the cart from **database**
product/size prices (`resolveCart` for the fee and channel decision,
`buildOrderItems` for the line snapshots), never the `price` field in the
request, so neither the total charged nor the per-line order record can be
influenced by a tampered payload.

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

## The removed `/razorpay/order` endpoint

`POST /razorpay/order` (`CreateRazorpayOrder`) no longer exists, along with
its `CreateOrderRequest` and `CustomerInfo` types. It created a Razorpay
order from a **client-supplied amount** with no cart validation, no
repricing and no structured address — which meant the price of a cart was
whatever the caller said it was. It survived as long as it did only for
backward compatibility with an older frontend.

`POST /checkout/create-order` is the single order-creation endpoint. It
does everything the removed one did, with the amount derived from database
prices.

## The two Razorpay secrets (`internal/config/config.go`)

This is the configuration mistake most likely to break payments, so it is
worth being blunt about: **`RAZORPAY_KEY_SECRET` and
`RAZORPAY_WEBHOOK_SECRET` are different values and are not
interchangeable.**

| Secret | Where it comes from | What it signs |
| --- | --- | --- |
| `RAZORPAY_KEY_SECRET` | The API key pair, alongside `RAZORPAY_KEY_ID` | The checkout callback signature, `HMAC-SHA256("<order_id>\|<payment_id>")`. Also the HTTP Basic password for the order and refund APIs. |
| `RAZORPAY_WEBHOOK_SECRET` | Generated in the Razorpay dashboard when the webhook is created | The **raw webhook body**, sent as `X-Razorpay-Signature` |

Configuring the key secret as the webhook secret is the classic mistake
here, and it fails in a way that hides itself. Because the two values are
unrelated, the signature can never match, so **every webhook delivery is
rejected with a `401`** — and payments still appear to work, because the
browser-driven `POST /razorpay/verify` call confirms the order on the happy
path. What breaks is every payment where the customer closed the tab before
the redirect, or whose callback failed: those are exactly the ones the
webhook exists to catch, and they sit in `created` forever.

`metrics.RecordPaymentSignatureFailure` (`internal/metrics/prometheus.go`)
exists for exactly this: a jump in
`payment_signature_failures_total{stage="webhook"}` with no corresponding
jump on `stage="verify"` is the signature of a mismatched webhook secret,
not of an attack.

Both secrets are checked at boot. When `APP_ENV` is production,
`config.Load()` returns an error if either is empty rather than letting the
service start and discover the problem at a customer's checkout.

## Payment verification (`internal/handlers/payments.go`)

`POST /razorpay/verify` (`VerifyPayment`) is the client-driven half of the
paid transition:

1. Requires `razorpay_payment_id`, plus either our own `orderId` or
   `razorpay_order_id`.
2. **Loads the order first.** This ordering is the point: the signature is
   then verified against the `razorpay_order_id` *we* persisted at creation
   time, not the one the browser posted. Verifying the posted order ID
   against a signature over the same posted order ID proves nothing — a
   caller could supply any pair and have it check out against itself.
   `orderId` is preferred for the lookup for the same reason: every value in
   the browser callback is attacker-controlled.
3. **Verifies, and fails closed.** A missing `razorpay_signature` is a
   `400`. A failed check is a `400 payment verification failed` and
   increments `payment_signature_failures_total{stage="verify"}`; the order
   is *not* marked paid. Razorpay's guidance is explicit that a failed
   signature means do not fulfil and do not retry.
4. Calls the shared `markOrderPaid(ctx, &order, paymentID)`.
5. `notifyOrderPaid(order, firstTimePaid)` sends the order-confirmation
   email and merchant alert, but only on the first transition.

Verification can be skipped only when `APP_ENV` is explicitly
`development`, `dev` or `test` (`skipSignatureChecks`). A **missing key
secret does not disable verification** — that is the tempting shortcut and
the dangerous one, because a production deploy with a typo in the
environment would then silently stop verifying payments while continuing to
accept them. `config.Load` refuses to start in production without the
secret for the same reason.

`verifyRazorpayHMAC(secret, message, signature)` is the shared primitive
behind both signature checks. The secret is a **parameter** rather than
read from config inside the function, precisely because the two checks use
different secrets over different messages — a helper that reaches into
config for one of them is a helper that will eventually be called for the
other. Razorpay documents hex encoding and some SDKs emit base64, so both
are accepted, each compared in constant time.

### `markOrderPaid`

`markOrderPaid` is the single paid-transition writer, shared by
`VerifyPayment` and the webhook. Everything runs in one transaction, so an
order is never left marked paid without its payment row, its committed
stock or its invoice number:

- The transition is a **conditional UPDATE**
  (`WHERE id = ? AND payment_status <> 'paid'`) rather than a
  read-then-save. `RowsAffected` tells the caller whether *this* call is
  the one that moved the order, which is what makes notification dispatch
  exactly-once when the webhook and the verify call race.
- The `Payment` row is an **upsert** on `razorpay_payment_id`, so a
  replayed payment cannot trip the unique index.
- Only the first transition calls `commitOrderInventory` and
  `assignInvoiceNumber`, so a replay cannot double-commit stock or burn an
  invoice number.
- Soft-account creation (`CreateSoftAccount`, `checkout.go`) is deliberately
  **outside** the transaction: it is a convenience — a random, never-shown
  16-byte hex password with `EmailVerified: true`, so a guest's order ends
  up attached to a `User` they can claim via "forgot password" — and a
  failure to create it must not roll back a real payment.

## Order lookup (`GET /order`)

`GetOrder` serves one order, with `Items` preloaded; product details are
already snapshotted onto each `OrderItem`, so no further joins are needed.
Access is by one of two means, and **never by bare ID**:

- **`?token=<64 hex chars>`** — the order's `PublicToken`, an opaque handle
  minted once by `POST /checkout/create-order` and returned in its
  response. It is unguessable, so it authorises on its own, but it is
  scoped to exactly one order. This is how the post-payment success page
  works for a guest who has no account at all. Tokens shorter than 32
  characters are rejected as malformed before the query runs.
- **`?id=<n>` plus a JWT** whose user owns the order. Admins may read any
  order; everyone else gets `AND user_id = ?` appended.

Order IDs are sequential integers, so serving an order on an ID alone would
make the entire order table enumerable — customer name, phone, email and
delivery address, one increment at a time.

**Absent and not-yours return an identical `404 order not found`**, so the
response cannot be used to probe which order IDs exist. An `?id=` with no
token is a `401`; no parameter at all is a `400`.

The route is mounted under `OptionalAuthMiddleware`
(`internal/auth/jwt.go`), which attaches claims when a valid token is
present and proceeds anonymously otherwise. That is what lets one route
serve both signed-in owners and token-bearing guests.
`GET /orders/{id}/invoice` is mounted the same way and applies the same
rule.

## Webhooks (`internal/handlers/webhooks.go`)

`POST /webhooks/razorpay` is mounted **outside** `/api/v1` with no JWT and
no rate limiter — throttling a provider only converts a delivery into a
retry. Its only authentication is the `X-Razorpay-Signature` header.

The pipeline is deliberately ordered:

1. **Read the raw body and verify against it.** The signature covers the
   exact bytes sent, so verification has to happen before any parsing:
   re-serialising parsed JSON changes key order and whitespace and can never
   match. A missing signature is a `400`; a bad one is a `401` and
   increments `payment_signature_failures_total{stage="webhook"}`.
   Verification uses `RAZORPAY_WEBHOOK_SECRET` — see
   [§ the two secrets](#the-two-razorpay-secrets-internalconfigconfiggo).
2. **Replay window.** Razorpay stamps `created_at` on every event and
   retries for up to 24 hours, but a genuine delivery always carries a
   recent timestamp. Anything older than `maxWebhookAge` (10 minutes) is
   acknowledged with `{"skipped": "stale"}` and dropped — either a replay
   attempt or a long-dead retry already reconciled by other means.
3. **Claim the event.** `claimWebhookEvent` inserts a row into
   `webhook_events` keyed by the `x-razorpay-event-id` header (Razorpay's
   documented duplicate-detection handle; a `derived:<event>:<created_at>`
   key is used if the header is absent, so dedup degrades to approximate
   rather than disappearing). The **unique index on
   `event_id` is what makes the claim atomic**: concurrent duplicate
   deliveries race on the insert, exactly one wins, and side effects
   therefore run exactly once with no application-level lock. The insert is
   deliberately not an upsert — the conflict *is* the signal. A duplicate
   gets a `200 {"duplicate": true}` so Razorpay stops retrying; a failure to
   record gets a `500`, because an event we could not record is an event we
   cannot promise to process.
4. **Respond `200`, then process.** Razorpay requires a 2xx within **5
   seconds** and treats a timeout as a delivery failure, which would send it
   into a 24-hour retry cycle against work already underway. Processing
   happens in a goroutine bounded by `webhookProcessTimeout` (30s) so a
   stuck handler cannot leak goroutines. The event is already durably
   recorded, so a crash mid-processing leaves a row for reconciliation
   rather than losing the payment.

`webhook_events` rows carry `status` (`received` → `processed`/`failed`),
the raw payload and any error. Rows left in `received` or `failed` are the
manual-reconciliation queue.

Handled events (`processRazorpayEvent`):

| Event | Handler | Effect |
| --- | --- | --- |
| `payment.captured` | `handlePaymentCaptured` | Marks the order paid via `markOrderPaid`/`notifyOrderPaid` |
| `order.paid` | `handlePaymentCaptured` | Same path; carries an order entity where `payment.captured` may only carry the payment's `order_id` |
| `payment.failed` | `handlePaymentFailed` | Marks the order failed and releases its stock reservation |
| `refund.created` | `handleRefundCreated` | Records the refund as `pending`, **without** crediting the order |
| `refund.processed` | `handleRefundProcessed` | Credits `orders.refunded_amount` and derives the order's payment status |
| `refund.failed` | `handleRefundFailed` | Marks the refund failed for retry; the order's refunded total is left untouched |
| `payment.dispute.created` | `handleDisputeCreated` | Raises an urgent `payment_dispute` support request and alerts the merchant |

Anything else is recorded and intentionally not processed.

Two deliberate choices in the handlers:

- `handlePaymentCaptured` calls the **same** `markOrderPaid`/
  `notifyOrderPaid` pair as `VerifyPayment`. The client-driven verify call
  and the async server-to-server webhook can independently race to confirm
  the same payment, and sharing these two functions is what guarantees only
  one of them ever sends the confirmation email.
- If an order cannot be found by `razorpay_order_id`, the handler logs and
  returns `nil` rather than an error — Razorpay would otherwise retry for 24
  hours for an order this service is never going to recognise.
- `handlePaymentFailed` returns early if the order is already `paid`.
  Razorpay allows several attempts within one order and events can arrive
  out of order, so a later success must win over an earlier failure.

`POST /webhooks/shiprocket` (`internal/handlers/shipments.go`) authenticates
differently, because Shiprocket sends a shared token rather than an HMAC: an
`x-api-key` header compared against `SHIPROCKET_WEBHOOK_TOKEN`. When that
token is unconfigured the endpoint **refuses the request** with a `503`
instead of accepting unauthenticated order-state mutations — an
unauthenticated writer of order status is worse than no webhook at all.

## Inventory (`internal/handlers/inventory.go`)

Stock is held from **order creation**, not from payment. For a nursery that
is the right trade: the window is minutes, and a customer who has reached
the payment screen should not lose the plant to someone still browsing. The
alternative — reserving at payment — lets two shoppers both reach checkout
for the last item, and one of them finds out after paying.

The lifecycle is **reserve → commit or release**:

- `reserveOrderInventory` runs inside the order-creation transaction,
  before the customer is sent to Razorpay.
- `commitOrderInventory` runs on the paid transition. The units were
  already deducted at reservation, so this only clears
  `orders.inventory_released` to keep the abandoned-order sweep from
  clawing them back.
- `releaseOrderInventory` returns the units when the order fails, is
  cancelled, or is swept as abandoned.

Stock lives on `products.stock`, or on `product_sizes.stock` for products
that have sizes. A product with `track_inventory = false` is always
available — made-to-order items, or effectively unlimited ones like seeds —
and reservation skips it rather than driving its stock negative.
`products.low_stock_threshold` drives the admin low-stock report.

### The race-safety primitive

The check and the decrement are a **single conditional UPDATE**, so the
database arbitrates rather than the application:

```sql
UPDATE products SET stock = stock - ?, updated_at = NOW()
WHERE id = ? AND (track_inventory = false OR stock >= ?)
```

`RowsAffected == 0` means someone else took the units first. The handler
turns that into `errOutOfStock`, the caller rolls the whole transaction
back, and checkout answers a structured `409 out_of_stock` instead of a
`500`. `metrics.RecordInventoryConflict` increments
`inventory_reservation_conflicts_total` so a product that is constantly
losing races is visible rather than merely frustrating.

Release is guarded the same way. `releaseOrderInventory` **claims** the
release first with `WHERE id = ? AND inventory_released = false`, and only
credits stock if it won that claim. Without it, a replayed
`payment.failed` event — or the sweep racing a webhook — could credit the
same units twice and inflate stock out of nothing.

### Abandoned orders

`SweepAbandonedOrders` returns stock from orders still unpaid after
`abandonedOrderTTL` (30 minutes). Razorpay checkout sessions are good for
roughly 15 minutes; the extra margin leaves room for a slow bank redirect.
It processes up to 200 orders per pass, marks each `status: "abandoned"`,
and deliberately leaves `payment_status` alone so a genuinely late payment
can still arrive. Note that `commitOrderInventory` only clears the release
flag — it does not re-deduct — so an order paid after its sweep is marked
paid without a fresh reservation; the low-stock report is the backstop for
that rare case.

Releasing stock may also make someone's wait worthwhile, so a successful
sweep calls `notifyBackInStock`.

Three endpoints round this out:

- `POST /products/{slug}/back-in-stock` (public) — subscribes an email to a
  restock notification, which doubles as a demand signal for what to
  propagate next. A repeat sign-up reuses the existing row. Sends are
  best-effort and leave `notified_at` unset on failure, so the next sweep
  retries rather than silently dropping the notification.
- `POST /inventory/adjust` (admin) — corrects stock after a physical count,
  a delivery or breakage. Takes exactly one of `stock` (absolute) or `delta`
  (relative); a delta is clamped at zero with `GREATEST(stock + ?, 0)` so a
  bad adjustment cannot leave negative stock.
- `GET /inventory/low-stock` (admin) — items at or below
  `low_stock_threshold`, across both products and sizes.

## Coupons (`internal/handlers/coupons.go`)

A coupon is only ever **evaluated** server-side. The client sends a code;
the server returns the discount it is willing to honour, and the same
evaluation runs again at order creation. The client's claimed discount is
never an input — the same property the fulfillment quote already has.

`evaluateCoupon` checks, in order: the code exists, the coupon is active,
the validity window (`starts_at`/`expires_at`) is open, and the global
`usage_limit` is not exhausted. Then it scopes the cart —
`eligibleSubtotal` sums only the lines matching `category_ids`/`product_ids`
— **before** testing `min_subtotal`, so a category-scoped coupon is judged
on the part of the cart it actually applies to rather than on a total it has
no claim over. Per-user limits and `first_order_only` are checked against
the user ID when signed in and against the email otherwise, because a guest
checkout still needs those limits to mean something.

Three discount types: `percentage` (optionally capped by `max_discount`),
`fixed`, and `free_shipping` (which waives `DeliveryFee` instead of
reducing the goods subtotal). A discount is never allowed to exceed the
eligible subtotal, so a code can never turn an order into a payout. Each
refusal carries customer-facing copy in `reason`, returned as a `422
coupon_rejected`.

`recordCouponRedemption` runs inside the order transaction and increments
`usage_count` **conditionally** (`WHERE id = ? AND usage_count < ?`), so two
simultaneous checkouts cannot push a global cap past its limit; the loser
gets `coupon_rejected` and the whole order rolls back. A
`coupon_redemptions` row records who used it, for how much, on which order.

The per-user and `first_order_only` limits need more than that, because
they are *counts* rather than a single column, and a count is not
self-enforcing: two concurrent checkouts of the same code each see that the
other has not redeemed yet, and both insert. So `recordCouponRedemption`
first takes the coupon row `FOR UPDATE` and then re-runs `checkCouponUsage`
against the transaction. That serialises every redemption of a given code
against the one row they all have in common — and it is the same row the
conditional `usage_count` update already contends on, so the lock costs
nothing that was not already being paid. Re-reading the coupon under the
lock also means the limits enforced are the current ones, not whatever the
preview loaded.

`applyCheckoutCoupon` also refuses a code that would take the payable amount
below ₹1: Razorpay rejects orders under that, and a genuinely free order
needs a different flow than a payment.

`POST /checkout/validate-coupon` is the public preview the checkout page
uses to show a discount before payment. It returns the evaluated
`discount`, the `subtotal` and the `newTotal`, all computed from database
prices. Admin CRUD lives at `/coupons`; `usage_count` is not editable
through it, and deletion is a soft delete so past orders stay explicable.

## Cancellation and refunds (`internal/handlers/refunds.go`)

A refund is **recorded locally before it is requested from Razorpay**. A
provider timeout can then never leave money moved with no record of it: the
local row starts `pending`, and the `refund.processed`/`refund.failed`
webhooks are the authoritative source that advances it. The synchronous API
response is used only to capture the provider's refund ID.

`POST /orders/{id}/cancel` is the customer-facing path (owner only;
admins may cancel any order). `Order.IsCancellable()` allows statuses
`pending`, `paid`, `confirmed` and `processing`, and refuses once an AWB has
been assigned or the parcel has shipped — once a plant is with a courier,
cancellation is a return, which is a different conversation
(`409 not_cancellable`).

The cancellation and the restock commit in one transaction, and only then
is the refund requested. The ordering is the point: a cancelled-but-
unrefunded order is recoverable, while a refunded-but-still-open one is
not. Cancelled stock is always returned, since nothing shipped. If the
refund call then fails, the order **stays cancelled** and
`raiseRefundSupportRequest` raises an urgent ticket; the response carries
`refund: "pending_manual"`. Failing the customer's cancellation because a
provider was briefly unreachable would be the wrong answer.

`applyRefundOutcome` is the single writer of terminal refund state, shared
by the synchronous response and the webhooks. It is idempotent — a replayed
event whose status already matches does nothing — and it creates a local
row for refunds issued **directly from the Razorpay dashboard**, which
arrive only as webhooks and would otherwise be invisible to reporting.

Two rules keep the credit honest. Only `processed` credits the order:
`refund.created` means Razorpay accepted the instruction, but with
`speed=normal` the money moves days later and the attempt can still fail,
so crediting on creation would leave a later `refund.failed` showing money
returned that never left. And `processed` is **final** — once a refund has
settled, no later event can move it back to `pending` or `failed`. Razorpay
delivers at least once and in no guaranteed order, so a `refund.created`
can arrive *after* the `refund.processed` it precedes; without that rule it
would reset the row, and the next delivery of `refund.processed` would
credit the order a second time. An attempt to un-settle a refund is logged
for reconciliation rather than silently applied.

The
order's refunded total is credited in one statement, so concurrent partial
refunds cannot lose an increment, and the payment status is derived from
the new total in the same expression:

```sql
UPDATE orders
SET refunded_amount = LEAST(refunded_amount + ?, amount),
    payment_status = CASE
        WHEN refunded_amount + ? >= amount - 0.01 THEN 'refunded'
        ELSE 'partially_refunded'
    END
WHERE id = ?
```

Admin refunds (`POST /orders/{id}/refund`) take an optional `amount` (zero
or omitted means the full remaining balance), a `reason` from a fixed set
(`customer_cancelled`, `damaged`, `wrong_item`, `out_of_stock`,
`delivery_failed`, `other` — a free set would make reporting meaningless),
and an explicit `restock` flag. Restocking is **off by default**: a plant
refunded as damaged is usually not resellable. Provider calls use
`speed: "normal"` rather than `optimum`, because instant refunds carry a fee
for a difference the customer barely notices, and a deterministic `receipt`
so a retry of the same logical refund cannot issue two. `GET /refunds` is
the admin reconciliation list.

## GST invoicing (`internal/handlers/invoicing.go`, `internal/services/invoice_pdf.go`)

Indian catalogue prices are **GST-inclusive** — that is what consumers
expect to see on a shelf and on a website, and changing it would make every
displayed price wrong. Tax is therefore **extracted** from the line total,
never added to it. For an inclusive line total `P` at rate `r`:

```
taxable = P / (1 + r/100)
tax     = P - taxable
```

Adding `r%` on top of a price that already contains it would overcharge
every customer and misstate every return. `computeOrderTax` also keeps a
`byRate` split, because each GST rate is reported separately in a GSTR
filing.

`DefaultGSTRate` is **0**. Live plants are nil-rated under GST and nursery
stock is predominantly live plants, so zero is the safe fallback for rows
that predate the column: it can never silently overcharge. Pots, soil,
tools and fertiliser are not nil-rated, so the rate is per-product
(`products.gst_rate`, with `hsn_code` alongside it).

Invoice numbers look like `GRW/2026-27/000123` and are namespaced by Indian
financial year (April–March, `financialYear()`), which is how GST returns
are organised. `assignInvoiceNumber` allocates the next ordinal in the
series and computes the tax split at the same time, so an invoice always
has one. It runs **inside `markOrderPaid`'s transaction**, so the sequence
cannot skip on a rolled-back payment — a gap in an invoice series is a
question an auditor will ask.

- `GET /orders/{id}/invoice` returns the PDF, authorised exactly like
  `GET /order` (public token, or owner/admin). An invoice is only available
  once the order is paid or has been refunded; an order carrying no invoice
  number is back-filled on first request.
- `POST /orders/{id}/invoice/email` (admin) emails it, for reissues.
- `GET /reports/gst` (admin) returns a month's invoices with per-invoice
  taxable value, tax, total and refunded amount, plus totals, for
  reconciliation against a GSTR filing.

Orders carry `taxable_value`, `tax_amount`, `invoice_number` and
`invoice_date`. Money arithmetic goes through `round2`, which uses
`math.Round` rather than `int64(v*100+0.5)`: the latter truncates toward
zero and so rounds negative values the wrong way, understating credit notes
and refund adjustments.

## Shipping and tracking (`internal/handlers/shipments.go`, `internal/shiprocket`)

A paid courier order becomes a real shipment in three provider calls:
create the order, assign an AWB, request a pickup. `CreateShipment`
(admin) does the first two together, because an order without an AWB is not
trackable and therefore not useful; pickup is separate so ops can batch it.
An order that already has an AWB is returned as-is rather than double-booked.

`bookShipment` refuses an order that is not paid, is cancelled, or whose
channel is not `courier`. It **persists `shipment_id` before requesting the
AWB**: if AWB assignment fails, ops can retry it without creating a second
provider order and paying for two shipments of one parcel. On success the
order gets `awb_number`, `courier_service`, `tracking_url`,
`status: "shipped"` and `shipped_at`, and the customer is emailed their
tracking details.

Status then arrives by **webhook** (`POST /webhooks/shiprocket`) rather than
by polling. Polling an aggregator on behalf of every open order is slow and
rate-limited, while the webhook is near-real-time and free. Deliveries are
de-duplicated on `(awb, current_status)` through the same
`claimWebhookEvent` ledger as the Razorpay events — Shiprocket resends
scans, and each pair should only move the order once — and are acknowledged
before being processed in the background, as above. `applyShipmentStatus`
maps a courier status onto the order: delivered sets `delivered_at`,
shipped sets `shipped_at`, and intermediate scans (pending, pickup
scheduled, RTO initiated) are recorded on the ledger but deliberately do
not move order state. An AWB with no matching order is logged and dropped —
it is either not ours or was booked outside the app, and neither is worth
retrying.

`RefreshShipmentTracking` polls open shipments as a backstop for webhooks
that never arrive, capped at 50 orders per pass and oldest first.
`SchedulePickup` (admin) requests collection for an already-booked shipment
and stamps `pickup_booked_at`.

Orders carry `shipment_id`, `awb_number`, `tracking_url`, `shipped_at`,
`delivered_at`, `pickup_booked_at` and `review_requested_at`.
`SHIPROCKET_PICKUP_LOCATION` names the pickup address nickname configured in
the Shiprocket panel, defaulting to `Primary`. Line weights are currently
estimated at 1 kg per unit (`estimateLineWeight`) — a plant in a 6-inch pot
is close enough to a kilo that this beats sending zero, but a real weight
column would be better.

## Background workers (`cmd/server/main.go`)

Three workers start **before** the listener and share a context cancelled on
`SIGINT`/`SIGTERM`, so shutdown stops them before the connection pool
closes — a worker still holding a query against a closing pool is a noisy,
avoidable crash on every deploy.

| Worker | Interval | What it does to orders |
| --- | --- | --- |
| `StartInventorySweeper` | 5 minutes | Releases stock from orders unpaid past `abandonedOrderTTL`, marks them `abandoned`, and notifies back-in-stock subscribers |
| `StartShipmentWorker` | 15 minutes | Books shipments for paid courier orders with no AWB, refreshes tracking, and sends review requests 10 days after delivery |
| `StartRetentionSweeper` | 24 hours | Enforces DPDP retention: removes minimised order rows once `transactionalRetention` (365 days) has elapsed — see [SYSTEM-DESIGN.md](./SYSTEM-DESIGN.md) |

`StartShipmentWorker` returns immediately when Shiprocket is not configured,
so a deployment without courier credentials simply has no shipment
automation rather than a ticker logging failures every 15 minutes.

## Order listing & admin management (`internal/handlers/orders.go`)

`GET /orders` (`ListOrders`, full-scope JWT required): a regular user sees
only their own orders (`user_id = ?`); `admin`/`superadmin` roles see all orders by
default, unless the request explicitly passes `scope=self`. Supports
`status`, `orderId`, `search` (matches customer name/phone/email,
case-insensitive `LIKE`), and standard pagination. Results (data + total
count, as two separate cache entries) are cached — see
[04-caching.md](./04-caching.md).

`PATCH /orders/{id}/status` and `PATCH /orders/{id}/expected-delivery`
are admin-only (`claims.Role` checked inline, not via router-level
`AdminMiddleware`). Status updates go through an allow-list (`pending`,
`confirmed`, `shipped`, `out_for_delivery`, `delivered`, `cancelled`,
`failed`, `paid`) and additionally sync `payment_status` for some
transitions (`delivered`/`paid` → `payment_status: paid`;
`failed`/`cancelled` → `payment_status` mirrors status). Both handlers
invalidate the `orders:*` cache pattern and return the updated order with
`Items`/`User` preloaded and image URLs resolved. The `abandoned` status set
by the inventory sweep is not in the allow-list — it is a system
transition, not one an admin sets by hand.

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
- Two system paths raise tickets of their own: a Razorpay dispute webhook
  (`payment_dispute`, `urgent`, source `razorpay_webhook`), and an
  auto-refund that failed after a cancellation (`refund`, `urgent`, source
  `system`). Both are things that must not be lost in a log file.
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

## Dootha Care waiting list (`internal/handlers/dootha_waitlist.go`)

Pre-launch interest in the Dootha Care device (`models.DoothaWaitlist`),
collected by the first-visit popup on the web homepage:
- `POST /dootha-waitlist` — public, rate limited to 5 per IP per 10 minutes
  and honeypotted on `website`. Name and a 10-digit mobile number are
  required; email and delivery area are optional. A user ID is attached when
  a valid JWT happens to be present, as with requested products.
- The mobile number is the identity: a repeat sign-up updates the existing
  row and increments `signups` rather than inserting a duplicate.
- Each sign-up is emailed to `WAITLIST_EMAIL` (default
  `growman.live@gmail.com`, falling back to `MERCHANT_NOTIFY_EMAIL`) in a
  goroutine, so a mail failure never fails the request — the row is already
  saved.
- `GET /dootha-waitlist` — admin-only listing, newest first.
