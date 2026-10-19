# Middleware & Security

## Global middleware chain (`internal/server/router.go`)

Applied to *every* request, in this exact order:

```
1. middleware.RequestID        — chi: tags each request with a unique ID
2. middleware.RealIP           — chi: rewrites RemoteAddr from trusted proxy headers
3. middlewares.SecurityHeaders — sets defensive response headers (below)
4. middleware.Recoverer        — chi: recovers panics into a 500 instead of crashing
5. middlewares.Prometheus      — records per-route latency/status metrics
6. middleware.Timeout(60s)     — chi: cancels the request context after 60s
7. middleware.Throttle(512)    — chi: caps in-flight requests at 512 (sheds load, not rate limiting per-client)
8. middleware.Compress(1)      — gzip at compression level 1 (cheap CPU, still shrinks JSON well)
9. QuietLogger / Logger        — access logging (see below)
10. cors.Handler(...)          — CORS
```

Ordering matters: `Recoverer` sits before the metrics/timing middleware so a
panicking handler still gets recorded/logged correctly rather than escaping
uncounted; `SecurityHeaders` runs early so headers are set even on requests
that error out downstream.

## Security headers (`internal/middlewares/security.go`)

`SecurityHeaders` sets, unconditionally:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `X-XSS-Protection: 0` (explicitly disabled — the legacy browser XSS
  auditor is deprecated/unreliable and can itself introduce vulnerabilities;
  `0` is the modern recommended value)
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains` — only
  when `r.TLS != nil` or `X-Forwarded-Proto: https` (i.e. only over an
  actual HTTPS connection, direct or behind a TLS-terminating proxy).

These are conservative defaults appropriate for a pure JSON API (no HTML
rendering, so no CSP is defined here — nothing to inject into).

## Request size limits

`MaxBytes(n)` (`security.go`) wraps the request body in
`http.MaxBytesReader`, applied to all mutating methods (skips GET/HEAD/
OPTIONS/DELETE). The `/api/v1` route group applies `MaxBytes(11 << 20)`
(11 MiB) globally — sized to comfortably fit the 10MB image-upload limit
enforced separately inside `UploadImage`, plus JSON overhead.

## Rate limiting (`internal/middlewares/ratelimit.go`)

Redis-backed **fixed-window** counter via a small Lua script (`INCR` + set
`EXPIRE` only on the first increment in the window — atomic, avoids a
race between check and increment):

```lua
local n = redis.call("INCR", KEYS[1])
if n == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
return n
```

- Sets `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`
  headers on every response once a limiter is active; on exceeding the
  limit, responds `429` with `Retry-After` and stops the chain.
- **`NamedIPRateLimiter(rdb, name, limit, window)`** — keys the counter as
  `rl:<name>:<clientIP>`, so different route groups get independent
  buckets even for the same caller. Fails open.
- **`StrictIPRateLimiter(rdb, name, limit, window)`** — the same thing with
  `FailClosed: true`.

### Fail open or fail closed

Every limiter used to fail **open**: if `config.Redis == nil` or the Lua call
errored, the request went through unlimited. That is the right default for a
catalogue read, but as a blanket policy it has a bad property — a single
Redis outage silently removes every limit in the system at once, which is
precisely the moment abuse becomes cheapest. Nothing alerts, because from the
outside the API is simply up and fast.

`RateLimitConfig.FailClosed` splits the decision per bucket. When Redis is
unreachable (or not configured at all) a fail-closed bucket falls back to
`localLimiter`, an in-process fixed-window counter guarded by a mutex, and
logs `[RATELIMIT] <name> bucket falling back to in-process counter`. The
fallback is deliberately crude: it is **per-process**, so with N replicas
behind the load balancer the effective limit is N times the configured one,
and the windows are not aligned across them. That is an honest downgrade
rather than a replacement — an attacker who can spread requests across every
replica gets N× the budget, which is still bounded, where failing open gives
them no bound at all. The map is keyed by client IP and opportunistically
pruned of expired entries once it passes 10,000 keys, so a long-lived process
under a wide spread of source addresses does not grow without limit.

Which buckets fail closed follows from what an unlimited request costs:

| Group | Limit | Mode | Routes | Why this mode |
|---|---|---|---|---|
| `api` | 250/min | fail open | all of `/api/v1` | Blanket ceiling. A Redis blip must not take the shop offline. |
| `auth` | 20/min | **fail closed** | login, admin login, signup, Google, password-reset OTP, phone OTP send/verify, Truecaller | Guards credentials, and each OTP send is a paid SMS. Unlimited login attempts during an outage is a free credential-stuffing window. |
| `checkout` | 20/min | **fail closed** | quote, email-OTP send/verify, create-order, validate-coupon | Creates Razorpay orders and reserves stock; unlimited calls can exhaust inventory reservations. |
| `plant` | 20/min | **fail closed** | plant identification and the Pl@ntNet catalog reads | Each identification spends the shared free daily quota (500/day). |
| `chat` | 30/min | **fail closed** | chat | Same: a paid AI provider per request. |
| `quotation` | 5/10min | fail open | bulk quotation enquiries | Writes a row and emails ops; annoying, not expensive. |
| `waitlist` | 5/10min | fail open | Dootha waiting list sign-up | As above. |

Note the knock-on effect on mounting: the fail-open limiters are wrapped in
`if h.Redis != nil` in `router.go` (with no Redis they would do nothing, so
there is no point in the middleware hop), while the `StrictIPRateLimiter`
groups are mounted unconditionally — with `Redis == nil` they still enforce
through the in-process counter, which is the entire point.

Catalogue and category reads carry only the `api` ceiling and fail open on
purpose. The worst case there is cache-bypassing read load on Postgres, which
is a capacity problem, not a money or account-security problem, and refusing
to serve the shop to protect against it is a worse outcome than serving it.

Phone-OTP send additionally layers **its own** Redis-backed throttle
(`internal/msg91/throttle.go` — per-number cooldown + daily cap, per-IP
hourly cap) on top of the generic `auth` IP limiter, since OTP abuse is
costly (SMS spend) in a way generic rate limiting alone doesn't fully
address. See [02-auth.md](./02-auth.md).

## Unauthenticated endpoints: provider webhooks

`POST /webhooks/razorpay` and `POST /webhooks/shiprocket` are mounted on the
root router in `router.go`, outside `/api/v1` and outside its rate limiters.
They carry no JWT — the caller is a provider, not a user — so the request
body itself is the only thing that can authenticate them, and they are
deliberately not throttled: rate-limiting a provider does not stop anything,
it just converts a delivery into a retry.

### Razorpay (`internal/handlers/webhooks.go`)

Three independent checks run before any side effect, in this order:

1. **Raw-body HMAC.** `verifyWebhookSignature` HMACs the exact bytes read
   off the wire against `RAZORPAY_WEBHOOK_SECRET` and compares in constant
   time, accepting hex or base64. The body must be read and verified before
   it is parsed, because re-serialising parsed JSON changes key order and
   whitespace and can therefore never reproduce the signed message. A
   mismatch is a `401` and increments
   `payment_signature_failures_total{stage="webhook"}` — a jump on that
   label is the signature of a misconfigured secret, which matters because
   the secret that signs webhook bodies is the dashboard webhook secret and
   **not** `RAZORPAY_KEY_SECRET`. Using the key secret here makes every
   delivery fail its check.
2. **Replay window.** A delivery whose `created_at` is older than
   `maxWebhookAge` (10 minutes) is acknowledged and dropped. Razorpay retries
   for up to 24 hours, but a genuine delivery always carries a recent
   timestamp; a much older one is either a captured request being replayed or
   a long-dead retry already reconciled by other means. Acknowledging rather
   than rejecting stops the provider retrying something we will never accept.
3. **Idempotency claim.** `claimWebhookEvent` inserts a `webhook_events` row
   keyed on the provider's `X-Razorpay-Event-Id` header, and the unique index
   on `event_id` is what makes the claim atomic — concurrent duplicate
   deliveries race on the insert, exactly one wins, and the losers return
   `200 {"duplicate": true}` without reprocessing. No application-level lock
   is involved. See
   [10-database-and-migrations.md](./10-database-and-migrations.md) for why
   that index is load-bearing. If the header is absent the key falls back to
   `derived:<event>:<created_at>` so dedup degrades rather than disappears.

Only then does the handler respond `200` and hand the work to a goroutine
bounded by `webhookProcessTimeout` (30s). Razorpay wants a 2xx within five
seconds and treats a timeout as a delivery failure, so doing the work inline
would push it into a retry cycle against work already in progress — the
duplicate deliveries the idempotency ledger then has to absorb. Because the
event is durably recorded before processing starts, a crash mid-processing
leaves a row in `received` for reconciliation instead of losing a payment.

### Shiprocket (`internal/handlers/shipments.go`)

Shiprocket does not sign its bodies; it sends a shared token in the
`x-api-key` header, so `ShiprocketWebhook` compares that against
`SHIPROCKET_WEBHOOK_TOKEN`. The important behaviour is what it does when the
token is **unconfigured**: it answers `503 shipment webhooks are not
configured` and refuses the request. Treating an empty expected value as
"skip the check" would turn an incomplete deployment into an open endpoint
for mutating order state — anyone could mark an order delivered. Deliveries
are de-duplicated on `shiprocket:<awb>:<status>` through the same
`webhook_events` claim, because Shiprocket resends scans and each
`(awb, status)` pair should move the order exactly once. The body is read
through an `io.LimitReader` capped at 1 MiB.

## Payment signature verification (`internal/handlers/payments.go`)

`VerifyPayment` (`POST /razorpay/verify`) loads the order **first** and
verifies the signature against the `razorpay_order_id` the server persisted,
never one supplied in the request body. A missing `razorpay_signature` is a
`400`; a failed check is a `400 {"error": "payment verification failed"}`
plus `payment_signature_failures_total{stage="verify"}`.

Verification fails closed, and the only thing that can relax it is
`skipSignatureChecks()` returning true, which happens solely when `APP_ENV`
is explicitly `development`, `dev` or `test`. Notably a **missing key secret
does not disable verification**. That was the dangerous version of this
logic: a production deploy missing one environment variable silently stopped
verifying payments and accepted anything, and nothing in the response or the
logs distinguished that from working correctly.

`verifyRazorpayHMAC(secret, message, signature)` takes the secret as a
parameter rather than reading config, because the two call sites use
deliberately different secrets over deliberately different messages —
`RAZORPAY_KEY_SECRET` over `"<order_id>|<payment_id>"` for the checkout
callback, `RAZORPAY_WEBHOOK_SECRET` over the raw body for webhooks. Making
the secret explicit at each call site is what keeps them from drifting back
together.

## Boot-time configuration guards (`internal/config/config.go`)

`config.Load()` returns an error, rather than a warning, when a
production-grade deployment is missing a secret that a security control
depends on. When `APP_ENV`/`GO_ENV` is `production` or `prod`:

- `JWT_SECRET` must be set and must not be the `dev-secret-change-me`
  default.
- `RAZORPAY_KEY_SECRET` must be non-empty — without it payment signature
  verification cannot run, and an unverifiable payment must never be
  accepted.
- `RAZORPAY_WEBHOOK_SECRET` must be non-empty, with an error message that
  spells out that this is the dashboard webhook secret and not the API key
  secret, since that confusion is the most likely way to get it wrong.

The reason to fail at startup is that the alternative failure is far worse
and far later: the service boots healthy, passes its probes, serves the
catalogue, and only misbehaves at the checkout of a real customer — or,
worse, does not misbehave at all and just stops verifying. A deploy that
cannot verify payments should never reach the load balancer. Every *other*
third-party credential in `Config` stays optional by design; the handlers
that need them return `503` rather than preventing the server from starting.

## Client IP resolution (`internal/middlewares/ip.go`)

`ClientIP(r)` prefers, in order: `CF-Connecting-IP` (Cloudflare) →
`True-Client-IP` → the connection's `RemoteAddr` (already rewritten by chi's
`RealIP` from standard forwarding headers upstream). This is the IP identity
used for rate limiting and for logging in merchant-notification emails
(`clientIP()` in `internal/handlers/auth.go` is a separate, simpler
`X-Forwarded-For`/`X-Real-IP` parser used specifically for notification
emails rather than security decisions).

## Access logging (`internal/middlewares/security.go`)

- **`QuietLogger(slow)`** (default) — logs **only** 5xx responses or
  requests slower than the threshold (1200ms in `router.go`). Skips
  `/healthz` and `/api/v1/healthz` entirely. Expected 4xx responses (auth,
  validation, rate limits) are silent. This is a deliberate cost
  optimization: full
  per-request access logs are expensive at scale and mostly noise for a
  healthy hot path; only the requests worth investigating get logged.
- Set `LOG_HTTP=1` (or `true`) to switch to chi's full `middleware.Logger`
  (every request) for local debugging.

## CORS

`cors.Handler` (go-chi/cors) allows `CORS_ORIGINS` (comma-separated env var,
defaults to the two local Next.js ports), the standard REST methods,
`Authorization`/`Content-Type`/`X-CSRF-Token`/`Origin`/`X-Requested-With`
headers, exposes rate-limit + caching headers to the browser, and allows
credentials with a 600s preflight cache.

## Liveness and readiness (`internal/handlers/health.go`)

Both probes are mounted on the root router, outside `/api/v1`, so they are
not subject to the body-size cap or any rate limiter. They answer different
questions and orchestrators should use them differently.

`GET /healthz` is **liveness**: it reports that the process is up and
serving and performs no dependency checks at all. That is a requirement, not
an omission. A liveness probe that touches a datastore will fail during a
database incident, the orchestrator will restart every pod, and a recoverable
dependency outage becomes a self-inflicted rolling restart that also drops
the in-process caches. Nothing here may depend on Postgres or Redis.

`GET /readyz` is **readiness**: whether this instance should receive traffic.
It checks dependencies under a `readinessTimeout` of 2 seconds, so a hung
database cannot hang the probe itself — an unanswered probe is treated as a
failure by most orchestrators anyway, just slowly and without telling anyone
why. The two dependencies are graded differently:

| Check | Failure | Response |
|---|---|---|
| Postgres (`sqlDB.PingContext`) | fatal | `503`, `"status": "down"` |
| Redis (`Ping`) | non-fatal | `200`, `"status": "degraded"` |
| Redis not configured | not a failure | `200`, `"redis": "not configured"` |
| Image service not configured | not a failure | `200`, `"images": "not configured"` |

Postgres is fatal because a worker that cannot query the database cannot
serve a request and should come out of rotation. Redis is not, because the
codebase treats it as optional throughout — caching falls back to the
in-process layer and the fail-closed rate-limit buckets fall back to
`localLimiter` — so an instance with no Redis is degraded but still useful,
and pulling every instance out of rotation over it would be an outage the
application was specifically built to avoid. A healthy response also reports
`postgres_conns` (in-use and idle counts) as a cheap pool-saturation signal.

## Metrics (`internal/middlewares/prometheus.go`, `internal/metrics/prometheus.go`)

Wraps every request (except `/metrics` and the two `/healthz` paths, to
avoid the scrape endpoint measuring itself and to keep the high-frequency
liveness probe out of the histograms — `/readyz` *is* measured, since its
latency is a useful dependency signal) and records duration into two
Prometheus
histograms (`http_server_requests_seconds`, `http_request_duration_seconds`)
plus a hand-rolled max-seen gauge per `(path, method, service, status)`
combination — used for a Grafana "API Performance" dashboard (see
`docker-compose.yml` in the repo root for the local Prometheus/Grafana
stack). The route pattern (`chi.RouteContext(ctx).RoutePattern()`, e.g.
`/products/{slug}`) is used as the label instead of the raw path, so metrics
aggregate correctly across different slugs/IDs instead of exploding into one
series per unique URL.

Alongside the HTTP metrics, `internal/metrics/prometheus.go` exposes a few
counters that exist specifically so a security or correctness failure is
visible rather than silent:

- `payment_signature_failures_total{stage}` — `stage="verify"` for the
  checkout callback, `stage="webhook"` for webhook bodies. A sustained jump
  on either is a mismatched secret, not an attack, and the label says which
  secret to look at.
- `payment_outcomes_total{result}`.
- `inventory_reservation_conflicts_total` — how often two shoppers raced for
  the last unit, which is also the signal that stock levels are stale.
