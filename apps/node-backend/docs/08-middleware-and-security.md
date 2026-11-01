# Middleware and security

Say this first: most security here is boring on purpose. Verify signatures before any side effect. Rate-limit the routes that spend money or SMS. Do not let a missing secret turn verification off.

## Stack

`internal/server/router.js`, outer to inner:

1. Request id (`X-Request-Id`, generated if absent) so logs and the client can name the same call.
2. Client IP from `internal/middlewares/ip.js`. Trust the proxy, then take the left-most forwarded address carefully. The rate-limit key is this IP.
3. Security headers (`internal/middlewares/security.js`): nosniff, frame denial, referrer policy. They apply to errors too.
4. Prometheus timing.
5. 60 second request timeout so a stuck handler does not hold the socket.
6. Throttle concurrent in-flight requests (512) so a burst cannot exhaust the pool.
7. Compression.
8. Logger. Quiet unless the call is slow, unless `LOG_HTTP=1`.
9. CORS from `CORS_ORIGINS`, credentials allowed, methods including the ones the app uses.

Then `/api/v1` parses JSON up to 11 MB. Webhooks use the raw body and a 2 MB cap, and they are registered before that parser so the HMAC bytes are intact.

## Rate limits

| Group | Limit | When Redis is down |
|---|---|---|
| `/api/v1` | 250 / min / IP | Request proceeds. Catalog must stay up |
| Auth | 20 / min / IP | Count in this process. SMS and password guessing stay bounded |
| Checkout | 20 / min / IP | Same, in-process |
| Chat | 30 / min / IP | Same |
| Plant identify | 20 / min / IP | Same. Each call can spend the Pl@ntNet daily quota |
| Quotations, waitlist | 5 / 10 min when Redis exists | If Redis is absent, the extra limiter is not mounted |

“Fail closed” in this code means: still enforce a limit locally. It does not mean reject every request because Redis is down. The catalog limiter is fail-open: a Redis error calls `next()`.

Alternative: one global limit. Then a product-page crawl blocks checkout, or a checkout limit is too loose for OTP.

## Payment signatures

Verify fails closed. No secret, no `skip`. The webhook compares the HMAC of the raw body. The browser verify compares the HMAC of `orderId|paymentId` with the key secret. Details of which events are handled are in [09-external-integrations.md](./09-external-integrations.md). The order state machine is in [05-orders-checkout-payments.md](./05-orders-checkout-payments.md).

## Authz, not just authn

A valid JWT is not enough. Scope and role are checked in the middleware from [02-auth.md](./02-auth.md). Handlers still check that an order belongs to `req.user` before returning it. The middleware does not know which order id was in the path.

## Health and metrics

`/healthz` liveness, no dependencies. `/readyz` Postgres. `/metrics` Prometheus. Do not put a JWT on `/metrics` if the scraper is private on the network. Do not expose it on the public internet without a network policy.

## Interview line

“I verify the webhook on the raw bytes, I rate-limit the routes that cost money, and a missing secret is a refusal, not a bypass.”
