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
  supplied a name yet. Can only call `POST /api/v1/auth/profile/complete`;
  every other authenticated route is blocked with `403 invalid token scope` /
  `403 complete your profile first`.

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
| `AdminMiddleware(secret)` | Valid JWT + `role` is `admin` or `superadmin` (via `IsAdminRole`) |

All of them parse the `Authorization: Bearer <token>` header, validate it,
and stash `*Claims` in the request context (`SetUserContext`/`FromContext`).
Handlers pull it back out with `appauth.Require(w, r)`, which writes a `401`
and returns `ok=false` if somehow called without the middleware (defensive —
matters mainly in tests that invoke handlers directly).

`router.go` currently uses only `AuthMiddleware` (any scope) for the private
route group — individual handlers that need full scope (like
`CompletePhoneProfile` checking for onboarding scope, or admin-only checks
inline) enforce that themselves rather than via `FullAuthMiddleware`/
`AdminMiddleware` route wrapping, except for the product-mutation and
image-upload routes which do use `appauth.AdminMiddleware` directly in the
router.

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

The checkout flow (see [05-orders-checkout-payments.md](./05-orders-checkout-payments.md))
has its own, separate email-OTP pair (`send-email-otp` / `verify-email-otp`)
used to verify a guest's email before creating a Razorpay order — it does not
create or touch a `User` row.

## Profile & account endpoints

All under the JWT-protected group in `router.go`:
- `GET /auth/me` — returns the current user's public fields (selects only
  needed columns).
- `PUT /auth/profile` — partial update (`UpdateProfileRequest`, only
  non-empty fields are applied); checks phone uniqueness before saving.
- `POST /auth/save-location` — stores address + lat/lng (used by the
  location-based dashboard/checkout prefill).
- `GET /auth/check-user-exists` — public (no auth), used by the frontend to
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
