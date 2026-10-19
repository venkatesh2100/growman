# Authentication & Identity

Auth is JWT-based (`github.com/golang-jwt/jwt/v5`, HS256, signed with
`JWT_SECRET`). Users can authenticate four different ways, all converging on
the same `models.User` table and the same JWT issuance path.

## JWT claims & scopes (`internal/auth/jwt.go`)

```go
type Claims struct {
    UserID uint
    Role   string
    Scope  string // "full" (default) or "onboarding"
    jwt.RegisteredClaims
}
```

Two scopes exist:
- **`full`** — normal, fully-authenticated user.
- **`onboarding`** — issued to a brand-new phone/Truecaller user who hasn't
  supplied a name yet. It can call `POST /api/v1/auth/profile/complete` and
  nothing else: every full-scope route rejects it with
  `403 complete your profile first`, and the onboarding route rejects a
  full-scope token with `403 invalid token scope`. That enforcement is
  route-level, in the middleware — see below.

Tokens are always issued with a 24-hour TTL (`appauth.GenerateToken` /
`GenerateTokenWithScope`, called with `24*time.Hour` everywhere). `ParseToken`
validates signature + algorithm (rejects anything but HS256) and defaults an
empty `Scope` claim to `full` for backward compatibility with older tokens.

## Middleware (`internal/auth/jwt.go`, `context.go`)

| Middleware | Requirement |
|---|---|
| `AuthMiddleware(secret)` | Valid JWT, any scope |
| `FullAuthMiddleware(secret)` | Valid JWT, must be `full` scope (blocks onboarding tokens) |
| `OnboardingAuthMiddleware(secret)` | Valid JWT, must be `onboarding` scope |
| `OptionalAuthMiddleware(secret)` | Nothing. Attaches `*Claims` if a valid token is present, proceeds anonymously otherwise |
| `AdminMiddleware(secret)` | Valid JWT + `role` is `admin` or `superadmin` (via `IsAdminRole`) |

The four mandatory ones are all `requireScope(secret, required)` with a
different `required` value, so they share one implementation: parse the
`Authorization: Bearer <token>` header, validate it, enforce the scope, and
stash `*Claims` in the request context (`SetUserContext`/`FromContext`). A
scope mismatch is a `403` — `complete your profile first` when a full-scope
route sees an onboarding token, `invalid token scope` the other way round.
Handlers pull the claims back out with `appauth.Require(w, r)`, which writes
a `401` and returns `ok=false` if somehow called without the middleware
(defensive — matters mainly in tests that invoke handlers directly).

`OptionalAuthMiddleware` is the one that does not reject anything. It exists
for endpoints that legitimately serve both a signed-in user and a guest
holding a capability token, where a missing or malformed `Authorization`
header must not be a `401` because the anonymous path is a valid one. The
handler, not the middleware, decides what the caller may see.

`AdminMiddleware` is built on `AuthMiddleware`, not `FullAuthMiddleware`, so
it accepts an admin-role token of either scope. In practice an
onboarding-scope token is only ever issued to a brand-new phone signup with
no name, which is not a row that carries an admin role.

### Which middleware guards which routes (`internal/server/router.go`)

| Guard | Routes |
|---|---|
| None (public) | Catalogue reads; all of `/auth/*` except `me`/`profile`; `/checkout/*`; `POST /razorpay/verify`; `GET /auth/check-user`; `POST /consent`; `POST /requested-products`; `POST /quotations`; `POST /dootha-waitlist`; `POST /products/{slug}/back-in-stock`; `POST /engagement/long-browse`; `POST /chat`; `POST /images/identify-plant`; `GET /plants/status`, `/plants/languages`, `/plants/projects`, `/plants/species`, `/plants/diseases`, `/plants/varieties`, `/plants/quota` |
| `OptionalAuthMiddleware` | `GET /order`, `GET /orders/{id}/invoice` |
| `OnboardingAuthMiddleware` | `POST /auth/profile/complete` — and nothing else |
| `FullAuthMiddleware` | `POST /products/{slug}/reviews`, plus the main authenticated group: `GET /auth/me`, `PUT /auth/profile`, `POST /auth/save-location`, `/orders` (list, status, expected-delivery, cancel), `/wishlist`, `/addresses`, `/privacy/export`, `/privacy/erase`, `/dashboard/map`, `GET /requested-products`, `GET /dootha-waitlist`, `/order-support-requests` |
| `AdminMiddleware` | `POST /images/upload`; product create/update/delete; `/inventory/*`; `GET /reviews` and `PATCH /reviews/{id}/status`; `/refunds` and `POST /orders/{id}/refund`; `POST /orders/{id}/invoice/email` and `GET /reports/gst`; `/orders/{id}/shipment*`; `/coupons` CRUD |
| HMAC / shared-secret body auth | `POST /webhooks/razorpay`, `POST /webhooks/shiprocket` — mounted outside `/api/v1`, no JWT at all (see [08-middleware-and-security.md](./08-middleware-and-security.md)) |

The important property of that table is that the main authenticated group is
mounted under `FullAuthMiddleware`, not `AuthMiddleware`. The scoped
middlewares existed for a long time without being wired up: every
authenticated route used `AuthMiddleware`, which accepts a token of *any*
scope, so an onboarding token — issued to a phone signup that has not even
supplied a name yet — could list orders, cancel them, write to the wishlist
and read the DPDP data export. Scope was a claim nothing enforced. Mounting
`FullAuthMiddleware` on the group is what makes the `onboarding` scope mean
something, and mounting `OnboardingAuthMiddleware` on
`POST /auth/profile/complete` replaced a hand-rolled scope check that used to
live inside the handler.

A handful of routes inside the full-scope group are admin-only but are not
wrapped in `AdminMiddleware`, because the same handler serves both audiences
off one path: `ListOrders` returns the caller's own orders or every order
depending on `IsAdminRole(claims.Role)` and a `?scope=self` override, while
`UpdateOrderStatus` and `ListOrderSupportRequests` do their own
`IsAdminRole` check and return `403 admin access required`. Route-level
wrapping is preferred for anything that is unambiguously admin-only.

## Auth flows

### 1. Email + password (`internal/handlers/auth.go`)

- `POST /auth/signup` — validates name/email/phone/password (8–72 chars),
  rejects if email or phone already exists, bcrypt-hashes the password
  (`bcrypt.DefaultCost`), creates the user (`Provider: "local"`), fires a
  fire-and-forget merchant notification email, returns a JWT.
- `POST /auth/login` — `authenticateUser(identifier, password)` looks up by
  email (if the identifier contains `@`) or by phone (`phoneutil.LookupVariants`
  — tries 10-digit, `91`-prefixed, and `+91`-prefixed forms, since older rows
  may be stored in any of those formats), then `bcrypt.CompareHashAndPassword`.
  Sentinel errors (`errPasswordRequired`, `errInvalidCredentials`) become the
  `401` message directly.
- `POST /auth/admin/login` — same as login, plus `appauth.IsAdminRole` check
  before issuing a token.

### 2. Google Sign-In (`internal/handlers/auth.go`)

`POST /auth/google` (and `/auth/google-signup`, which is a plain alias —
`GoogleSignup` just calls `Google`) accepts either shape of Google token:
- **`id_token`** (JWT, 3 dot-separated parts) — verified server-side with
  `google.golang.org/api/idtoken` against `GOOGLE_CLIENT_ID`. This is what the
  mobile app (React Native Google Sign-In) sends.
- **`access_token`** — verified by calling Google's
  `https://www.googleapis.com/oauth2/v2/userinfo` endpoint directly. This is
  what the web app's `@react-oauth/google` `useGoogleLogin` hook sends.

`isJWT()` (dot-count heuristic) picks which path to take. Either way it
resolves to a `GoogleUserInfo{Email, Name, VerifiedEmail, ...}`, then:
existing user by email → update `Provider`/`EmailVerified`/`Name` if needed;
no existing user → create one (`Provider: "google"`, no password, no phone).
Always issues a full-scope JWT (Google users always have a name from Google,
so there's no onboarding step).

### 3. Phone OTP via MSG91 (`internal/handlers/auth.go`, `internal/msg91/`)

Two MSG91 integration modes, chosen automatically based on which env vars are
set:

- **Widget mode** (preferred) — `MSG91_WIDGET_ID` + `MSG91_TOKEN_AUTH` set.
  Uses MSG91's default SMS sender, no custom DLT template needed.
- **Template mode** (fallback) — `MSG91_AUTH_KEY` + `MSG91_TEMPLATE_ID` set.
  Uses MSG91's REST OTP API with a pre-approved DLT template.

Flow:
1. `POST /auth/otp/send` (`SendPhoneOTP`) — normalizes the number
   (`phoneutil.TenDigitIN`, requires a valid 10-digit Indian mobile starting
   6–9), runs it through `msg91.Throttle.Allow` (Redis-backed: 30s cooldown
   between sends, `OTP_DAY_CAP` per-number daily cap default 20,
   `OTP_IP_HOUR_CAP` per-IP hourly cap default 40 — daily/IP caps are skipped
   on retries so switching channel doesn't burn the cap), then calls MSG91.
   - Widget mode also supports **retries on a different channel** (SMS/Voice/
     WhatsApp) via `reqId` + `channel`/`retryChannel` in the request body
     (`parseRetryChannel` accepts either a number or numeric string).
   - If MSG91's widget reports the number as already/invisibly verified, the
     handler skips straight to issuing a token (via `findOrCreateByPhone` +
     `respondPhoneAuth`) instead of requiring a separate verify call.
2. `POST /auth/otp/verify` (`VerifyPhoneOTP`) — verifies the OTP (widget
   `WidgetVerifyOTP` if a `reqId` was returned, else the REST
   `client.VerifyOTP`), then `findOrCreateByPhone` + `respondPhoneAuth`.
3. `POST /auth/otp/widget/verify` (`VerifyWidgetOTP`) — alternate path for
   apps using MSG91's own client-side `DefaultWidget` SDK
   (`@msg91comm/sendotp-react-native`): the client verifies OTP itself and
   hands the backend an **access-token**, which is verified server-side via
   `MSG91_AUTH_KEY` + MSG91's `verifyAccessToken` endpoint before trusting the
   returned phone number.

`findOrCreateByPhone` (shared by phone-OTP and Truecaller): looks up by any
phone variant; if found, updates `PhoneVerifiedAt`, backfills phone/name/email
if missing, and **never overwrites an existing password** (phone/Truecaller
accounts stay passwordless — `PasswordHash` is left `nil`). If not found,
creates a new user with `Provider` set to `"phone"` or `"truecaller"`.

`respondPhoneAuth` decides scope: if the user has no name yet, issue an
**onboarding**-scope token and set `isNewUser: true` in the response so the
client knows to show a "complete your profile" screen; otherwise full scope.
`isNewAccount` (separately) reflects whether the DB row was just inserted —
these are deliberately different flags (a Truecaller signup with a name is
`isNewAccount: true` but `isNewUser: false`, since it can skip onboarding).

### 4. Truecaller (`internal/handlers/auth.go`, `internal/truecaller/client.go`)

`POST /auth/truecaller` — Android-only OAuth-with-PKCE flow: the client sends
an `authorizationCode` + `codeVerifier`, the backend exchanges it for an
access token (`truecaller.Client.ExchangeCode`, `POST` to
`oauth-account-noneu.truecaller.com/v1/token`) and fetches the profile
(`UserInfo`, `/v1/userinfo`). The verified `phone_number` and full name
(`GivenName + FamilyName`) feed the same `findOrCreateByPhone` path as OTP
login, with `Provider: "truecaller"`. A returned name means the user skips
onboarding entirely.

### 5. Completing onboarding

`POST /auth/profile/complete` (`CompletePhoneProfile`, requires onboarding
scope) — sets `Name` (required) and optionally `Email` (validated, checked
for uniqueness against other users), then re-issues a **full**-scope token.
This is the only route an onboarding-scope token can call.

### 6. Password reset (email OTP)

Three-step flow backed by `services.OTPService` (Redis + in-memory fallback,
`internal/services/otp.go`) and `services.EmailService` (SMTP,
`internal/services/email.go`):

1. `POST /auth/forgot-password/send-otp` — looks up the user by email but
   **always returns the same "if an account exists…" message** whether or not
   it does, to avoid account enumeration. Enforces a 60s resend cooldown
   (`otpService.CanResendPasswordResetOTP`), generates a 6-digit OTP
   (`bcrypt`-hashed before storage, 5-minute TTL), emails it.
2. `POST /auth/forgot-password/verify-otp` — checks the OTP and, on success,
   sets a short-lived "verified" marker in Redis so the final reset step can
   still proceed even if the OTP key itself has raced/expired.
3. `POST /auth/forgot-password/reset` — `ConsumePasswordResetOTP` re-validates
   (preferring the "verified" marker, falling back to re-checking the OTP),
   then updates the bcrypt password hash.

### 7. Checkout email verification (guest proof token)

The checkout flow (see [05-orders-checkout-payments.md](./05-orders-checkout-payments.md))
has its own, separate email-OTP pair (`send-email-otp` / `verify-email-otp`)
used to verify a guest's email before creating a Razorpay order — it does not
create or touch a `User` row, and it issues no JWT. What it issues instead is
a **verification proof token**, because `POST /checkout/create-order` has to
be able to tell that the address it is about to write onto an order actually
passed the OTP check. Without that, the OTP step is advisory: a client can
skip it and post straight to the order endpoint with any address.

`POST /checkout/verify-email-otp` therefore returns
`{"verificationToken": "<64 hex chars>", "expiresIn": 900}` alongside its
success message, minted by `OTPService.IssueVerificationProof`
(`internal/services/otp.go`). The token is 32 random bytes from `crypto/rand`,
hex-encoded, stored in Redis under `checkout:verified:<normalised-email>`
with a TTL of `VerificationProofTTL` (15 minutes — long enough to fill in an
address and reach the payment screen, short enough that a leaked token is
near-useless). `CreateCheckoutOrder` presents it to
`ConsumeVerificationProof`, which returns false for a missing, expired,
mismatched or already-spent token and answers the caller with
`403 {"error": "email_not_verified"}`.

Three properties make it a proof rather than just another secret:

- **Bound to one email.** The token is the *value* at a key derived from the
  address, so a token minted for one address cannot authorise an order for
  another — the lookup simply misses.
- **Single use, and *claimed* rather than merely deleted.** A
  read-compare-then-delete sequence would leave a window in which two
  concurrent `create-order` requests both read the proof, both match, and
  both proceed — one verification, two orders, which is the thing the token
  exists to prevent. So the delete is conditional on the key still holding
  that token (a Lua `GET`-compare-`DEL` on Redis, a load-and-delete on the
  in-memory fallback), and only the caller it succeeds for holds the proof.
  One verification buys exactly one order even under a double-clicked pay
  button.
- **Compared in constant time** (`crypto/subtle.ConstantTimeCompare`). It is
  a credential, and a timing oracle on it would be as good as leaking it.
  The comparison runs before the claim and a mismatch stops there, leaving
  the stored proof untouched — so a wrong guess, or a stray retry, cannot
  burn a legitimate shopper's proof and lock them out of their own
  checkout. The claim's own comparison is not constant-time, but by then
  the token has already been established as correct and there is no secret
  left to leak.

The OTP itself cannot serve this purpose, which is why a second token exists
at all. The OTP is deleted when it is verified — correctly, because it is
single-use — so there is nothing left for the order endpoint to re-check.
Re-sending the OTP to the client to be replayed at order creation would turn
it into a bearer credential with no binding to the verification event: it
would prove only that the caller knows six digits, not that those digits
were ever accepted for that address. A separate opaque token keeps the OTP
single-use while giving checkout something it can verify.

`CreateCheckoutOrder` only demands the proof from callers it sees as
unauthenticated (`appauth.FromContext` returning no claims); a signed-in
customer is already verified by their JWT. This is why the `/checkout/*`
group mounts `OptionalAuthMiddleware` rather than nothing: guests must be
able to check out, but without the middleware the claims would never reach
the context and a signed-in customer would be made to verify an address
their account already proves. `ValidateCoupon` depends on the same claims
for per-customer usage caps.

`POST /consent` (`internal/handlers/privacy.go`) is mounted the same way.
It has to be reachable before sign-in, because the consent banner fires on
first visit, but it reads `appauth.FromContext` to attach a `UserID` when
the caller does have a session — otherwise a logged-in customer's consent
record would be keyed by email alone and would not join to their account.

## Profile & account endpoints

All under the `FullAuthMiddleware` group in `router.go`, so an onboarding
token cannot read or edit a profile it has not finished creating:
- `GET /auth/me` — returns the current user's public fields (selects only
  needed columns).
- `PUT /auth/profile` — partial update (`UpdateProfileRequest`, only
  non-empty fields are applied); checks phone uniqueness before saving.
- `POST /auth/save-location` — stores address + lat/lng (used by the
  location-based dashboard/checkout prefill).
- `GET /auth/check-user` — public (no auth), used by the frontend to
  decide "log in" vs "sign up" before the user picks a method.

## Notable design choices

- **Phone number storage is inconsistent by design/history** — rows may be
  10-digit, `91`-prefixed, or `+91`-prefixed. Every phone lookup goes through
  `phoneutil.LookupVariants`/`TenDigitIN` rather than assuming one format.
- **Redis is required for phone OTP** (`SendPhoneOTP` returns `503` if
  `h.Redis == nil`) because the throttle needs atomic counters — this is the
  one auth path that hard-depends on Redis rather than degrading.
- **No account enumeration** on password reset; **generic "invalid
  credentials"** on login regardless of whether the email/phone or the
  password was wrong.
- **Scope is enforced where the route is mounted, not inside handlers.** A
  scope check that lives in a handler protects exactly the one handler that
  remembers to do it, and the failure mode is silent: a new route added to
  the group simply inherits no check. Putting `FullAuthMiddleware` on the
  group inverts that, so the default for anything added later is the strict
  one.
- **Capability tokens are bound and single-use.** Both opaque tokens the
  system hands out — the checkout verification proof and `Order.PublicToken`
  — authorise exactly one thing: one email's next order, one order's lookup.
  Neither is a session, and neither widens with the holder's identity.
