# External Integrations

Almost every integration in this section is optional at boot — missing
credentials cause the relevant handler to respond `503 Service Unavailable`,
never a startup crash. This is consistent with
`internal/config/config.go`, where all third-party keys default to empty
strings.

The one exception is Razorpay's two secrets, which `config.Load()` requires
when `APP_ENV` is production. They are not optional because the thing they
enable is not a feature but a security control: a deploy that cannot verify
a payment signature must not start, let alone serve a checkout. See
[08-middleware-and-security.md](./08-middleware-and-security.md#boot-time-configuration-guards-internalconfigconfiggo).

## Razorpay (payments)

Simple `net/http` calls with HTTP Basic Auth (`RAZORPAY_KEY_ID` :
`RAZORPAY_KEY_SECRET` base64-encoded) — no SDK dependency.
- **Order creation**: `POST https://api.razorpay.com/v1/orders` — see
  `h.createRazorpayOrder` in `internal/handlers/payments.go`, called only
  from `POST /checkout/create-order`. There is no longer a second,
  client-amount-driven order endpoint.
- **Refunds**: `POST /v1/payments/{id}/refund` —
  `h.createRazorpayRefund` in `internal/handlers/refunds.go`, with
  `speed: "normal"` (instant refunds carry a fee for a difference the
  customer barely notices) and a deterministic `receipt` so Razorpay's own
  dedup stops a retry of the same logical refund issuing two.
- **Signature verification**: HMAC-SHA256 over a message string,
  `hmac.Equal` constant-time comparison, hex or base64 accepted
  (`verifyRazorpayHMAC`).

### Two secrets, and which one signs what

This is the single easiest thing to get wrong in this integration, and
getting it wrong is silent, so it is worth being explicit. Razorpay issues
two unrelated secrets and both are used here, over different messages:

| Secret | Where it comes from | Signs | Verified by |
|---|---|---|---|
| `RAZORPAY_KEY_SECRET` | The API key pair, alongside `RAZORPAY_KEY_ID` | The checkout callback: `HMAC-SHA256("<order_id>\|<payment_id>")` | `verifyRazorpaySignature` on `POST /razorpay/verify` |
| `RAZORPAY_WEBHOOK_SECRET` | Generated in the Razorpay dashboard when you create the webhook | The **raw webhook request body**, byte for byte | `verifyWebhookSignature` on `POST /webhooks/razorpay` |

The webhook handler used to verify against the key secret, which means
webhook signature verification could never have succeeded in production —
every delivery would have been rejected as a forgery. `verifyRazorpayHMAC`
therefore takes the secret as a **parameter** rather than reading it from
config: making the choice explicit at each call site is what keeps the two
from drifting back together. A jump in
`payment_signature_failures_total{stage="webhook"}` is the symptom of this
specific mix-up, and the `stage` label says which secret to look at.

The body must also be read and verified **before** it is parsed, because
re-serialising parsed JSON changes key order and whitespace and so can
never reproduce the signed bytes.

### Webhook events handled

`POST /webhooks/razorpay` subscribes to seven events. Anything else is
recorded on the `webhook_events` ledger and deliberately not processed, so
an accidental dashboard subscription cannot cause side effects:

| Event | Effect |
|---|---|
| `payment.captured`, `order.paid` | `markOrderPaid` — the same path as the client-driven verify call, so an order is confirmed, invoiced and notified exactly once whichever arrives first |
| `payment.failed` | Marks the order failed and releases its stock reservation, unless a later attempt already succeeded |
| `refund.created` | Records the refund as `pending` — Razorpay has accepted the instruction, but with `speed=normal` the money moves days later and can still fail, so nothing is credited yet. Also the path by which a refund issued from the Razorpay dashboard gets a local record |
| `refund.processed` | `applyRefundOutcome` credits the order's refunded total and derives its payment status. `processed` is final: no later event can un-settle it, which is what stops an out-of-order `refund.created` from setting up a second credit |
| `refund.failed` | Marks the refund failed for ops to retry; the order's refunded total is deliberately left untouched |
| `payment.dispute.created` | No automated action — raises an urgent internal support request and alerts the merchant, because Razorpay imposes a response deadline and a dispute needs a human |

Razorpay sends the event ID in the `x-razorpay-event-id` header, which is
what the idempotency claim is keyed on. The full lifecycle, the replay
window and the claim mechanics are in
[05-orders-checkout-payments.md](./05-orders-checkout-payments.md) and
[08-middleware-and-security.md](./08-middleware-and-security.md#unauthenticated-endpoints-provider-webhooks).

## Shiprocket (courier aggregator)

`internal/shiprocket/client.go` (auth, serviceability, circuit breaker) and
`internal/shiprocket/shipments.go` (booking and tracking). Handler-side
glue is `internal/handlers/shipments.go`.

**Authentication is unusual and worth knowing up front: Shiprocket issues
no static API key.** The credentials of a dedicated API user
(Settings → API → Configure → Create an API User, on an email *different*
from the dashboard login) are exchanged at `POST /auth/login` for a JWT
valid for ten days. `authToken` caches it and refreshes at nine days
rather than waiting for a 401 to arrive mid-checkout. A token can be
supplied directly as `SHIPROCKET_TOKEN` to avoid storing a password, at
the cost of replacing it by hand every ten days; `New` rejects anything
that does not look like a JWT (`eyJ` prefix) with an explanatory log line,
because an API key pasted into that variable can only ever earn a 401 and
would otherwise be retried on every single checkout quote.

The integration has two halves with deliberately different failure
behaviour:

- **Serviceability** (`CheckServiceability`) is read-only and sits in the
  customer's checkout path, so it fails **soft**: a 4-second budget, and a
  pincode no courier covers is a real answer (`Serviceable: false`) rather
  than an error. A circuit breaker trips after three consecutive failures
  and pauses lookups for five minutes, because a dead endpoint or a
  rejected password fails identically every time and would otherwise cost
  every quote a login round trip plus a timeout. Growman does not quote
  Shiprocket's rate to the customer — the customer-facing fee comes from
  the zone bands in `internal/fulfillment` — so the rate returned here is
  recorded as the order's *cost*, which is what makes the delivery subsidy
  measurable.
- **Booking** (`CreateOrder`, `GenerateAWB`, `RequestPickup`, `Track`)
  writes to a live logistics account and runs in an admin action or a
  background worker, not a request path. It gets a 25-second budget and
  does **not** fail soft: a booking that silently did not happen is worse
  than one that returns an error a human can see and retry. `post` also
  leaves the breaker alone, since a booking error is usually a validation
  problem with one order rather than a dead integration, and pausing all
  bookings over it would be the wrong response.

Order → AWB → pickup → tracking is the sequence.
`SHIPROCKET_PICKUP_LOCATION` must match a pickup address nickname
registered in the dashboard exactly or bookings are rejected; it defaults
to `Primary`. Status normally arrives by webhook; `RefreshShipmentTracking`
polls as a backstop for deliveries that never came. Full detail in
[05-orders-checkout-payments.md](./05-orders-checkout-payments.md).

### The tracking webhook

`POST /webhooks/shiprocket` is authenticated differently from the Razorpay
one because Shiprocket does not sign its bodies: it sends a shared token in
an `x-api-key` header, compared against `SHIPROCKET_WEBHOOK_TOKEN`. When
that variable is **unconfigured the endpoint answers `503` and refuses the
request**, rather than treating an empty expected value as "skip the
check" — this route mutates order state, so an incomplete deployment would
otherwise leave anyone able to mark an order delivered. Deliveries are
de-duplicated on `(awb, current_status)` through the same `webhook_events`
claim as Razorpay's, because Shiprocket resends scans and each pair should
move the order exactly once. The body is read through an `io.LimitReader`
capped at 1 MiB.

## MSG91 (phone OTP, India)

`internal/msg91/client.go` + `throttle.go`. Two independent API surfaces on
one `Client` struct:
- **Widget API** (`control.msg91.com/api/v5/widget/*`) —
  `sendOtpMobile`/`verifyOtp`/`retryOtp`/`verifyAccessToken`. Preferred mode;
  uses MSG91's own default SMS sender without a custom DLT template.
  `formatMsg91Error` special-cases the `"ipblocked"` response into an
  actionable message (whitelist the server's public IP in MSG91's Authkey →
  IP security settings) since that's a common self-hosted deployment gotcha.
- **REST OTP API** (`control.msg91.com/api/v5/otp`, `/otp/verify`) —
  template-based fallback requiring `MSG91_TEMPLATE_ID` (a DLT-approved SMS
  template).
- **Throttling** (`throttle.go`) is layered independently of the generic
  Redis IP rate limiter (see [08-middleware-and-security.md](./08-middleware-and-security.md)):
  a per-phone-number send cooldown (`OTP_COOLDOWN_SECONDS`, default 30s), a
  per-number daily send cap (`OTP_DAY_CAP`, default 20), and a per-IP hourly
  cap (`OTP_IP_HOUR_CAP`, default 40) — all env-tunable. Caps are skipped
  for channel retries (`isRetry=true`) so switching from SMS to WhatsApp/
  Voice doesn't burn the daily quota. A blocked probe's `INCR` is rolled back
  with `DECR` so denied attempts don't themselves eat into the cap.

Full auth-flow detail in [02-auth.md](./02-auth.md).

## Truecaller (Android one-tap phone verification)

`internal/truecaller/client.go` — OAuth 2.0 with PKCE against
`oauth-account-noneu.truecaller.com`. Two calls: `ExchangeCode` (auth code +
code verifier → access token) and `UserInfo` (access token → verified
profile with `phone_number`, `given_name`/`family_name`, `email`). Requires
only `TRUECALLER_CLIENT_ID` (Android client ID from Truecaller's developer
portal) — no client secret, per PKCE design.

## Google Sign-In

No dedicated client package — handled inline in
`internal/handlers/auth.go` using `google.golang.org/api/idtoken` for
server-side ID-token verification (mobile app path) and a direct call to
`https://www.googleapis.com/oauth2/v2/userinfo` for access-token verification
(web app path). Requires `GOOGLE_CLIENT_ID` (falls back to
`NEXT_PUBLIC_GOOGLE_CLIENT_ID` if unset — same web client ID is reused
across the Next.js frontend and this backend). See
[02-auth.md](./02-auth.md).

## SMTP email (`internal/services/email.go`)

Uses Go's standard `net/smtp` directly — no third-party mail library.
`EmailService.send` builds a raw multipart/alternative MIME message
(plain-text + HTML parts) and calls `smtp.SendMail` with `PlainAuth` against
`SMTP_HOST:SMTP_PORT` (defaults `smtp.gmail.com:587` — i.e. this is built
around Gmail's SMTP relay with an app password, though any SMTP host works).

Every email shares one HTML "shell" template (`emailShell`) — a
600px-wide, inline-styled table layout (necessary for broad email-client
compatibility) with a banner image, content slot, and footer (support email
+ Play Store link) — so all transactional emails look consistent without
duplicating markup. Email types sent:
- OTP (signup/checkout email verification) — `SendOTPEmail`
- Password reset OTP — `SendPasswordResetOTP`
- Account-created (after a soft-account payment signup) — `SendAccountCreatedEmail`
- Order confirmation (itemized table) — `SendOrderConfirmationEmail`
- Order shipped, with courier, AWB and tracking link — `SendOrderShippedEmail`
- Order cancelled, with whether a refund is on its way — `SendOrderCancelledEmail`
- GST tax invoice, the only one carrying a PDF attachment — `SendInvoiceEmail`
- Review request, sent ten days after delivery — `SendReviewRequestEmail`
- Back-in-stock notification for a restock subscriber — `SendBackInStockEmail`
- Abandoned-cart reminder — `SendAbandonedCartEmail`
- Internal merchant alerts (plain text, not the HTML shell) —
  `SendMerchantAlert`, used by `internal/handlers/notify.go` for new-signup
  and paid-order notifications sent to `MERCHANT_NOTIFY_EMAIL`, for payment
  disputes and completed data-erasure requests, and for the
  "visitor browsed 10+ minutes" alert (`ReportLongBrowse`,
  deduplicated per session via a 24h Redis `SetNX`).

The fulfillment emails are sent from the background workers rather than
from a request, which is why a `SendReviewRequestEmail` failure leaves
`review_requested_at` unset and a `SendBackInStockEmail` failure leaves
`notified_at` unset: the next pass retries rather than silently dropping
the notification.

Emails sent as a side effect of something else are fired in background
goroutines from their calling handlers, so email sending never blocks the
HTTP response — a payment succeeds even if its confirmation email fails.
`POST /orders/{id}/invoice/email` is the deliberate exception: sending the
invoice *is* the request, so a send failure is reported to the admin as a
`502` rather than swallowed.

## Cloudflare Analytics Engine (admin dashboard map)

`internal/handlers/dashboard.go`, `GET /api/v1/dashboard/map` (admin-only).
Queries Cloudflare's **Workers Analytics Engine SQL API**
(`api.cloudflare.com/client/v4/accounts/{id}/analytics_engine/sql`) with raw
SQL against a `wae_events_v2` table (populated by the Cloudflare Worker /
edge layer in front of this stack, not by this Go service itself) to build
request-count-by-country (`mapType=world`) or request-count-by-region-within-
India (`mapType=country&country=india`) for a heatmap UI. Requires
`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`; the world-map query
additionally no-ops (returns an empty list, not an error) if only the
account ID is missing, while the India query hard-errors — a slight
inconsistency worth noting if extending this handler.

## Pl@ntNet (plant identification)

`POST /api/v1/images/identify-plant` and the `GET /api/v1/plants/*` catalog
routes. Requires `PLANTNET_API_KEY`. The free plan is 500 identifications
per UTC day, shared by species, disease, and variety scans; see
[06-chat-and-ai.md](./06-chat-and-ai.md) for which calls spend a credit and
how `PLANTNET_RESERVE` keeps species identification available. Origin is
read from GBIF with the id Pl@ntNet already returned. Care text comes from
the RAG service and is cached per species.

## Dootha RAG

Chat and photo care sheets are answered by the Python service in `apps/ai`.
This process calls it with `RAG_SERVICE_URL` and `RAG_SHARED_SECRET`. Gemini
is used only inside that service, and only for comparisons. See
[06-chat-and-ai.md](./06-chat-and-ai.md) and [../../../../docs/rag.md](../../../../docs/rag.md).
