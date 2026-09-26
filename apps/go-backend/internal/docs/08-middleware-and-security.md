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

- **Fails open**: if `config.Redis == nil` or the Lua call errors, the
  request is allowed through — rate limiting degrades gracefully rather than
  blocking traffic when Redis is unavailable (consistent with the rest of
  the app's Redis-optional philosophy).
- Sets `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`
  headers on every response once a limiter is active; on exceeding the
  limit, responds `429` with `Retry-After` and stops the chain.
- **`NamedIPRateLimiter(rdb, name, limit, window)`** — keys the counter as
  `rl:<name>:<clientIP>`, so different route groups get independent
  buckets even for the same caller.

Applied limits, per group in `router.go` (all only if `h.Redis != nil`):

| Group | Limit | Routes |
|---|---|---|
| `api` | 250/min | all of `/api/v1` |
| `auth` | 20/min | login, signup, Google, OTP send/verify, Truecaller |
| `checkout` | 20/min | email-OTP send/verify, create-order |
| `plant` | 20/min | plant identification |
| `chat` | 30/min | chat |

Phone-OTP send additionally layers **its own** Redis-backed throttle
(`internal/msg91/throttle.go` — per-number cooldown + daily cap, per-IP
hourly cap) on top of the generic `auth` IP limiter, since OTP abuse is
costly (SMS spend) in a way generic rate limiting alone doesn't fully
address. See [02-auth.md](./02-auth.md).

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
  `/healthz` entirely. This is a deliberate cost optimization: full
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

## Metrics (`internal/middlewares/prometheus.go`, `internal/metrics/prometheus.go`)

Wraps every request (except `/metrics` and `/healthz`, to avoid the scrape
endpoint measuring itself) and records duration into two Prometheus
histograms (`http_server_requests_seconds`, `http_request_duration_seconds`)
plus a hand-rolled max-seen gauge per `(path, method, service, status)`
combination — used for a Grafana "API Performance" dashboard (see
`docker-compose.yml` in the repo root for the local Prometheus/Grafana
stack). The route pattern (`chi.RouteContext(ctx).RoutePattern()`, e.g.
`/products/{slug}`) is used as the label instead of the raw path, so metrics
aggregate correctly across different slugs/IDs instead of exploding into one
series per unique URL.
