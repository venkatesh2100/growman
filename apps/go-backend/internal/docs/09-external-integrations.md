# External Integrations

Every integration in this section is optional at boot — missing credentials
cause the relevant handler to respond `503 Service Unavailable` (or, for
signature checks, to skip verification in dev), never a startup crash. This
is consistent with `internal/config/config.go`, where all third-party keys
default to empty strings.

## Razorpay (payments)

Simple `net/http` calls with HTTP Basic Auth (`RAZORPAY_KEY_ID` :
`RAZORPAY_KEY_SECRET` base64-encoded) — no SDK dependency.
- **Order creation**: `POST https://api.razorpay.com/v1/orders` — see
  `h.createRazorpayOrder` in `internal/handlers/payments.go`, called from
  both checkout endpoints.
- **Signature verification**: HMAC-SHA256 over a message string, base64
  output, `hmac.Equal` constant-time comparison
  (`verifyRazorpayHMAC`) — reused for both the checkout-verify signature
  (`orderID|paymentID`) and the webhook body signature (raw JSON body).
- **Webhook**: `POST /webhooks/razorpay` — see
  [05-orders-checkout-payments.md](./05-orders-checkout-payments.md) for the
  full payment lifecycle.

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
- Internal merchant alerts (plain text, not the HTML shell) —
  `SendMerchantAlert`, used by `internal/handlers/notify.go` for new-signup
  and paid-order notifications sent to `MERCHANT_NOTIFY_EMAIL`, and for the
  "visitor browsed 10+ minutes" alert (`ReportLongBrowse`,
  deduplicated per session via a 24h Redis `SetNX`).

All of the above are fired in background goroutines from their calling
handlers — email sending never blocks the HTTP response.

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

Covered in [06-chat-and-ai.md](./06-chat-and-ai.md) — a straight proxy to
`my-api.plantnet.org/v2/identify/all`, requiring `PLANTNET_API_KEY`.

## AI providers (OpenAI / Gemini)

Covered in [06-chat-and-ai.md](./06-chat-and-ai.md) — selected via
`AI_PROVIDER`, with automatic fallback to whichever provider key is actually
present, and a fully-canned response path if neither is configured.
