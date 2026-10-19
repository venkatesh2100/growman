# Growman — Complete Guide

Interview preparation and the working map for adding features across the three apps that make up Growman.

| Codebase | Path | Role |
|---|---|---|
| Mobile | `/home/venky/growman-mobile` | Expo / React Native customer app (separate git repo) |
| API | `/home/venky/growman/apps/go-backend` | Go HTTP API. System of record for users, catalog, money, stock, care |
| Web | `/home/venky/growman/apps/web` | Next.js storefront, deployed to Cloudflare Workers |

There is also `apps/admin` (Next.js on port 3002): an internal dashboard for the same API. It is not a fourth product. Customers never see it.

The API already has subsystem essays in `apps/go-backend/internal/docs/`. Start with `SYSTEM-DESIGN.md` when you need the *why*. This guide is the map of all three clients, the packages, and the path you take when you add a feature.

---

## How to use this

**Interview, about 45 minutes.** Read sections 1–6, then 12. Skim 7–9 so you can name files when they ask “where does X live?”

**Adding a feature.** Read section 11 and follow the checklist. Open the matching domain file named in sections 7–9. Do not invent a new pattern.

**Deep dive on one backend topic.** Use the index at the end of section 7. Those docs are more precise than this guide on payments, auth scopes, caching, and DPDP.

---

## 1. What Growman is

Growman is an Indian plant nursery store (Hyderabad, public site `growman.live`) plus a plant-care companion.

Customers can:

- Browse and search a plant catalog (categories, subcategories, brands, tags, sizes).
- Keep a cart on the device, then check out as a guest or a logged-in user.
- Pay with Razorpay. The server re-prices the cart. The client never decides the total.
- Track orders, download a GST invoice, cancel, and retry a failed payment.
- Sign in with email and password, Google, Indian mobile OTP (MSG91), or Truecaller. All of those become one `User` row and one JWT.
- Ask **Dootha**, the plant-care chat, questions. Logged-in chat can see that user’s orders and wishlist.
- Identify a plant from a photo (Pl@ntNet).
- Keep “my plants”: watering, fertilizing, a care calendar, health notes.
- Request a missing plant, ask for a bulk quotation, join the Dootha waitlist.
- Export or erase personal data under the DPDP Act.

The business rules that must stay on the server: price, stock, coupons, tax, payment signatures, who is allowed to see an order.

---

## 2. Repositories and how they talk

```
 growman-mobile                         growman  (pnpm + Turborepo monorepo)
 Expo Router app                        ├── apps/web          Next.js 16  → Cloudflare (growman.live)
        │                               ├── apps/admin        Next.js 16  → port 3002
        │  HTTPS JSON                   ├── apps/go-backend   Go API      → :8080  (Cloud Run in prod)
        │  Authorization: Bearer JWT    ├── packages/ui, eslint-config, tailwind-config, typescript-config, lib
        └──────────────► /api/v1 ◄──────┘
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
          Postgres          Redis         Google Cloud Storage
          (GORM)         cache, OTP,      product images
                         rate limits
                              │
              Razorpay, Shiprocket, MSG91, Truecaller,
              Google Sign-In, SMTP, Discord, OpenAI/Gemini,
              Pl@ntNet, Cloudflare Analytics
```

| Piece | Local | Production |
|---|---|---|
| Web | `pnpm --filter web dev` → port **3001** | Cloudflare Worker `growman-web`, domain `growman.live`, via OpenNext |
| Admin | port **3002** | separate deploy, same API |
| API | `go run ./cmd/server` → port **8080**, prefix `/api/v1` | Cloud Run (see comments in `apps/web/lib/api.ts`) |
| Mobile | `npx expo start`, then a dev client | store builds; bundle id `com.venky2100.growman`, scheme `growman` |
| Postgres / Redis | repo-root `docker-compose.yml` | managed Postgres; Redis optional but required for strict rate limits and OTP in prod |

**There is no shared TypeScript package for API models.** Web `lib/types.ts` and mobile `lib/types.ts` manually mirror Go `json` tags in `internal/models/models.go`. If you add a field, update the struct and both clients.

**The cart is not a server table.** Web and mobile keep the cart in Zustand, persisted locally. Checkout posts the line items. The server looks up current price and stock and creates an `Order`. `CartSnapshot` only stores the last client cart so the business can nudge an abandoned cart. It is not the cart.

---

## 3. One request, end to end

A logged-in mobile or web call looks like this:

1. The screen calls a helper (`apiFetch` in `lib/api.ts` on both clients).
2. The helper prefixes the path with the API base (`…/api/v1`) and, if a token exists, sets `Authorization: Bearer <jwt>`.
3. chi in `internal/server/router.go` runs the global middleware, then the route-group middleware (body limit, rate limit, auth).
4. A method on `*handlers.Handler` runs. It talks to GORM, the cache, or an external HTTP API.
5. JSON goes back. Clients read `{ error }` / `{ reason }` on failure. There is no generated client.

Webhooks are the exception. Razorpay and Shiprocket POST to `/webhooks/razorpay` and `/webhooks/shiprocket`, **outside** `/api/v1`. They are authenticated with an HMAC body signature or `x-api-key`, never with a user JWT.

---

## 4. The five journeys you should be able to draw

### 4.1 Sign-in (four doors, one user)

| Door | Mobile | Web | API |
|---|---|---|---|
| Email + password | `app/(auth)/login.tsx` | `app/login/page.tsx` | `POST /auth/login` |
| Google | `components/GoogleLoginButton.tsx` | `app/login/GoogleLoginButton.tsx` | `POST /auth/google` |
| Phone OTP | `phone.tsx` → `otp.tsx` | not the primary web path | `POST /auth/otp/send`, `POST /auth/otp/verify` |
| Truecaller | `lib/truecaller.ts` (Android) | — | `POST /auth/truecaller` |
| New phone user finishes name/email | `complete-profile.tsx` | — | `POST /auth/profile/complete` |

JWT claims (`internal/auth/jwt.go`): `userId`, `role`, `scope`.

- `scope=full` — normal session. `FullAuthMiddleware`.
- `scope=onboarding` — phone/Truecaller user who has not finished their profile. `OnboardingAuthMiddleware` only lets them hit profile completion. They cannot place an order or read `/auth/me` as a full user.
- `role` `admin` or `superadmin` — `AdminMiddleware`.

Passwords are bcrypt (`golang.org/x/crypto`). Google ID tokens are verified with `google.golang.org/api`. Phone numbers are normalized in `internal/phoneutil`. OTP codes live in Redis (memory fallback) via `internal/services/otp.go`, and MSG91 sends the SMS (`internal/msg91`).

Both clients store the JWT in Zustand, persisted to local storage (`auth-storage`). It is not an httpOnly cookie. That is a deliberate parity choice with mobile. The trade-off: an XSS bug on the web can read the token. Route protection is client-side; the API is what actually rejects a missing or wrong token.

### 4.2 Browse

1. Client asks `GET /products`, `/products/featured`, `/categories`, `/products/search`, `/products/{slug}`.
2. Handlers in `products.go`, `categories.go`, `catalog.go` read Postgres through `internal/cache`.
3. Cache is two tiers: an in-process L1 (about 2 minutes, 4096 keys) and Redis L2, plus `singleflight` so a stampede on one key becomes one database query.
4. Product rows store an **image key**, not a public URL. Handlers resolve the key with `IMAGE_BASE_URL` (GCS). See `internal/docs/07-images-and-storage.md`.

Web catalog pages are React Server Components with `revalidate = 600` (10 minutes). The product page itself uses `cache: "no-store"` so price and stock are not served stale. Mobile keeps a 10-minute in-memory catalog cache in `lib/catalog.ts`.

### 4.3 Checkout and payment (the interview centerpiece)

```
Cart on device
    │  POST /checkout/quote          delivery fee, zone, pickup vs courier
    │  POST /checkout/validate-coupon
    │  guest: POST /checkout/send-email-otp + verify-email-otp
    ▼
POST /checkout/create-order
    │  server re-prices every line
    │  reserves stock (inventory.go)     two shoppers cannot buy the last plant
    │  creates Order + OrderItems + Razorpay order
    ▼
Razorpay checkout UI (web script / react-native-razorpay)
    │
    ├── POST /razorpay/verify          client callback, HMAC, fails closed
    └── POST /webhooks/razorpay        provider callback, separate secret, idempotent
              │
              ▼
        payment captured → stock committed
        unpaid 30 min    → inventory sweeper releases the reservation
        paid             → shipment worker books Shiprocket, AWB, tracking webhook
        invoice          → GST PDF (go-pdf/fpdf), Indian financial year (April–March)
```

Files: `checkout.go`, `payments.go`, `webhooks.go`, `inventory.go`, `coupons.go`, `fulfillment.go`, `invoicing.go`, `shipments.go`, `internal/shiprocket`, `internal/fulfillment`.

Say this out loud: **the client sends what it wants to buy; the server decides what it costs and whether the stock exists.** Coupon math, GST, and the Razorpay amount are server-side. Signature verification uses two different secrets (checkout verify vs webhook) and refuses to run in production if either secret is missing. `config.Load()` will not boot production without `JWT_SECRET`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`.

Workers, same process, cancelled on SIGINT/SIGTERM:

| Worker | Interval | Job |
|---|---|---|
| `StartInventorySweeper` | 5 min | Release stock reserved by orders unpaid for 30 min |
| `StartShipmentWorker` | 15 min | Book pending shipments, refresh tracking, ask for a review after delivery |
| `StartRetentionSweeper` | daily | DPDP retention: drop minimised personal data after the one-year floor |

### 4.4 After the purchase

- Orders: `GET /orders`, cancel, invoice download, reorder, retry payment, delivery rating.
- Wishlist: `GET/POST /wishlist`, `DELETE /wishlist/:id`.
- Reviews: `POST /products/{slug}/reviews`, moderated, verified-purchase flag. Admin approves. Product rating is denormalized back onto the product.
- My plants: `/me/plants` CRUD, water, fertilize, health log, care calendar, import from past orders. Season copy comes from `internal/care` (no database).
- Dootha: `POST /chat`. Provider is Gemini or OpenAI (`AI_PROVIDER`). History is `GET /me/chat`.

### 4.5 Privacy

`POST /consent` records a consent choice. `GET` export and `POST` erase live under `/privacy`. Erasure is not “delete the order row today”: DPDP gives a right to erasure and also a retention floor for transactional records. The design reconciles those in `SYSTEM-DESIGN.md` section 11. The retention sweeper is what actually ages data out.

---

## 5. Shared rules (do not break these when you add a feature)

1. **Money and stock change only in the API**, inside the existing order/inventory flow. Do not decrement stock from the client.
2. **A new route picks an existing auth middleware.** Public, `OptionalAuth`, `FullAuth`, `OnboardingAuth`, or `Admin`. The table is in `internal/docs/02-auth.md`.
3. **JSON field names match the Go `json` tags.** Both clients copy them by hand.
4. **Images are keys.** Persist the key. Resolve a URL at the edge of a response.
5. **Redis is optional in dev and mandatory for the strict limiters.** Auth, checkout, plant-ID, and chat use fail-closed rate limits. If you add a route that can send SMS, charge money, or call a paid API, put it in that class.
6. **Webhooks stay outside `/api/v1`.**
7. **Guest checkout is a real path.** `OptionalAuth` plus an email-OTP proof. Do not assume `userId` is present.
8. **Catalog reads go through the cache helper** and must be invalidated on admin writes. Account data uses `ServePrivate` or no cache.

---

## 6. Frameworks at a glance

| Layer | Mobile | Web | API |
|---|---|---|---|
| Language | TypeScript 5.9, strict | TypeScript 5.9 | Go 1.26 |
| UI | React 19.1, React Native 0.81 | React 19.2 | — |
| App framework | Expo SDK 54, Expo Router 6, dev client | Next.js 16 App Router | chi v5 |
| Styling | NativeWind 4, Tailwind 3 | Tailwind 4 | — |
| State | Zustand 5 + AsyncStorage | Zustand 5 + localStorage | — |
| Server state | `apiFetch` + a few in-memory caches | RSC + `fetch` `revalidate` / `no-store` | GORM + `cache.Helper` |
| Auth token | JWT in Zustand | JWT in Zustand | HS256 JWT,  scopes |
| Payments UI | `react-native-razorpay` | Razorpay Checkout.js | Razorpay REST, no SDK |
| Deploy | EAS / Gradle release bundle | OpenNext → Cloudflare Workers | Cloud Run |
| Tests | ESLint only | Node test runner on `lib/**/*.test.ts` (SEO) | `go test ./...` |

Monorepo tooling (web + admin + packages, not the mobile repo): **pnpm 10** workspaces, **Turborepo 2**. Shared configs live in `packages/eslint-config`, `packages/tailwind-config`, `packages/typescript-config`, `packages/ui`.

---

## 7. The API (`apps/go-backend`)

Module path: `github.com/venkatesh2100/growman/apps/go-backend`.

### 7.1 Why it is shaped this way

One process. One `handlers.Handler` struct holds the database, config, Redis, image service, and Shiprocket client. Every endpoint is a method on that struct. There is no repository layer and no separate worker service.

That is intentional. The codebase is one deployable with a read-heavy catalog and a small set of careful writes. An extra “clean architecture” layer would add files without a second caller. Handlers call GORM directly. Reusable bits are plain functions (`query.go`, `internal/cache`, `internal/auth`).

Read `internal/docs/SYSTEM-DESIGN.md` section 13 for the point at which that choice should change (a second writer, a second service that needs the same rules).

### 7.2 Direct Go dependencies

| Module | Why it is here |
|---|---|
| `github.com/go-chi/chi/v5` | Router |
| `github.com/go-chi/cors` | CORS allow-list |
| `gorm.io/gorm` + `gorm.io/driver/postgres` | ORM. Models are the schema |
| `github.com/go-redis/redis/v8` | Cache L2, rate limits, OTP |
| `github.com/golang-jwt/jwt/v5` | HS256 tokens |
| `golang.org/x/crypto` | bcrypt |
| `google.golang.org/api` | Google ID-token verify |
| `cloud.google.com/go/storage` | Product images in GCS |
| `golang.org/x/image` | Resize / encode before upload |
| `github.com/go-pdf/fpdf` | GST invoice and quotation PDFs |
| `github.com/prometheus/client_golang` | `/metrics` |
| `golang.org/x/sync` | `singleflight` in the cache |
| `github.com/joho/godotenv` | Local `.env` |

Razorpay, Shiprocket, MSG91, Truecaller, Discord, Pl@ntNet, OpenAI, and Gemini are plain `net/http` clients. There is no SDK for them in `go.mod`.

### 7.3 Layout

```
cmd/server/main.go          boot: config, db, redis, images, handler, migrate, workers, listen
cmd/migrate/main.go         AutoMigrate and exit
cmd/optimize-images/main.go image maintenance
internal/server/router.go   the only route table
internal/handlers/*.go      business logic + the three workers
internal/models/models.go   every table
internal/auth               JWT + middleware
internal/cache              L1 + Redis + singleflight
internal/config             env
internal/db                 Postgres + Redis connect
internal/middlewares        security headers, rate limit, IP, logging, metrics
internal/services           email, OTP, Discord, invoice PDF, quotation PDF
internal/services/storage   GCS ImageService
internal/shiprocket         courier
internal/plantnet           Pl@ntNet client + daily quota policy
internal/care               season advice, no DB
internal/fulfillment        zones and fees
internal/msg91, truecaller, phoneutil
pkg/httpjson, pkg/pagination
migrations/*.sql            extra SQL AutoMigrate cannot express
seed/                       sample data when SEED_ON_STARTUP
```

Newer packages the older layout docs mention lightly: `internal/plantnet`, `internal/care`, `services/discord.go`, and the `/me/plants` handlers.

### 7.4 Boot

`cmd/server/main.go` does this in order:

1. `config.Load()` — production refuses to start without the three secrets above.
2. `db.Connect` — `DATABASE_URL` or `HYPERDRIVE_URL`. Required.
3. `db.ConnectRedis` — nil is allowed. Strict rate limits then fail closed.
4. Image service only if `IMAGE_BASE_URL` is set. Implementation is GCS (`GCS_BUCKET_NAME`, `GCS_PROJECT_ID`, `GCS_CREDENTIALS_JSON`).
5. `handlers.New(...)`.
6. `AutoMigrate` when `AUTO_MIGRATE` is on (default in dev). Then `EnsureSearchIndexes` (pg_trgm, partial indexes).
7. Seed, if asked.
8. Start the three workers on one cancel context.
9. `server.NewRouter` and `http.Server` with timeouts. SIGINT/SIGTERM cancels workers, then `Shutdown`.

### 7.5 Middleware

Global, in order: `RequestID` → `RealIP` → `SecurityHeaders` → `Recoverer` → Prometheus → 60s timeout → throttle 512 → gzip → logger → CORS.

`/api/v1` adds a body cap (11 MB) and an IP rate limit (250/min). Auth, checkout, plant identify, and chat add stricter **fail-closed** limits. Quotation and waitlist limits **fail open** if Redis is down, because losing a lead is better than rejecting every visitor when Redis blips.

Probes: `GET /healthz` (process is up, no dependencies), `GET /readyz` (Postgres and Redis). Orchestrators should route on `readyz`. Metrics: `GET /metrics`. API docs: mounted from `internal/docs` (Swagger / ReDoc).

### 7.6 Data model

All tables embed `Base`: `ID`, `CreatedAt`, `UpdatedAt`, `DeletedAt` (soft delete). `Handler.AutoMigrate` in `internal/handlers/handler.go` is the list of what actually ships.

| Model | What it is |
|---|---|
| `User` | One person. Email and phone unique. `Provider` is local, google, or phone. Role, location, referral code |
| `Category` → `Subcategory` → `Product` | Catalog tree |
| `Brand` | Optional on a product |
| `Product` | Price, MRP, stock, `TrackInventory`, denormalized rating, `Sizes`, attributes. `ImageKey`, not a URL |
| `ProductSize` | Per-size price, stock, image |
| `Review` | Unique per user+product. Status pending/approved. `VerifiedPurchase` |
| `Order` → `OrderItem` | Razorpay ids, public token for guests, fulfillment, tax, coupon, AWB, inventory flags |
| `Payment` | One row per Razorpay payment id |
| `Refund`, `WebhookEvent` | Money movement and “already handled this event” |
| `Coupon`, `CouponRedemption` | Server-side discounts |
| `Wishlist` | Unique user+product |
| `Address` | Saved addresses |
| `ConsentRecord` | DPDP |
| `OwnedPlant`, `PlantHealthLog` | My plants |
| `NotificationPreference`, `AppNotification` | Inbox |
| `SavedItem` | Save for later (separate from wishlist) |
| `StoreCredit`, `CreditEntry` | Referral / credit ledger |
| `SavedPaymentMethod` | UPI / card labels the user stored. Not raw card PANs |
| `RecentView`, `CartSnapshot`, `ChatTurn` | Engagement and chat memory |
| `QuoteRequest` | Bulk quotation |
| `RequestedProduct`, `DoothaWaitlist`, `OrderSupportRequest`, `BackInStockRequest` | Leads and alerts |

There is no `Cart` model.

### 7.7 Route map (the groups, not every line)

The full table is `internal/server/router.go`. Grouped:

| Group | Middleware | Examples |
|---|---|---|
| Probes, metrics, docs, webhooks | none of the JWT stack | `/healthz`, `/readyz`, `/metrics`, `/webhooks/*` |
| Auth | strict IP limit | `/auth/login`, `/auth/signup`, `/auth/google`, `/auth/otp/*`, `/auth/truecaller`, forgot-password |
| Session | full auth | `GET /auth/me`, `PUT /auth/profile`, `POST /auth/save-location` |
| Onboarding | onboarding scope | `POST /auth/profile/complete` |
| Catalog | public, cached | `/products`, `/categories`, `/brands`, `/tags`, `/catalog`, `/care/season` |
| Reviews write | full auth | `POST /products/{slug}/reviews` |
| Checkout | strict IP + optional auth | `/checkout/quote`, `create-order`, `validate-coupon`, email OTP |
| Payment verify | strict | `POST /razorpay/verify` |
| Orders, guest-capable | optional auth + public token | `GET /order`, invoice |
| Account | full auth | `/orders`, `/wishlist`, `/addresses`, `/privacy/*`, `/me/plants`, `/me/saved`, payment methods, referral, chat history, reorder |
| Leads | looser IP limit | `POST /quotations`, `/dootha-waitlist`, `/requested-products`, `/consent` |
| Plant ID | strict, quota | `POST /images/identify-plant` and the Pl@ntNet catalog routes |
| Chat | strict | `POST /chat` |
| Admin | admin role | product CRUD, inventory, review moderation, refunds, coupons, shipment pickup, GST report |

### 7.8 Handler files (where to edit)

| You are changing… | Open |
|---|---|
| Login, OTP, Google, Truecaller | `handlers/auth.go`, `internal/auth`, `internal/msg91`, `internal/truecaller` |
| Catalog, search, filters | `products.go`, `categories.go`, `brands.go`, `catalog.go`, `query.go` |
| Price, delivery fee, coupons | `checkout.go`, `fulfillment.go`, `coupons.go`, `internal/fulfillment` |
| Razorpay | `payments.go`, `webhooks.go` |
| Stock | `inventory.go` |
| Orders, cancel, reorder | `orders.go` |
| Shiprocket | `shipments.go`, `internal/shiprocket` |
| Invoice PDF | `invoicing.go`, `services/invoice_pdf.go` |
| Reviews | `reviews.go` |
| Wishlist | `wishlist.go` |
| Addresses | `addresses.go` |
| Dootha | `chat.go`, `order_support.go` |
| My plants | `my_plants.go`, `customer_features.go`, `internal/care` |
| Photo ID | `plants.go`, `plants_image.go`, `plants_catalog.go`, `plants_care.go`, `internal/plantnet` |
| Privacy | `privacy.go` |
| Notifications | `app_notifications.go`, `inbox.go` |
| Bulk quotes | `quotation.go`, `services/quotation*.go` |
| Waitlist / demand | `dootha_waitlist.go`, `requested_products.go` |
| Images | `images.go`, `image_helpers.go`, `services/storage` |
| Ops alerts | `notify.go`, `services/discord.go`, `services/email.go` |
| Admin map | `dashboard.go` (Cloudflare Analytics) |

### 7.9 Env names you will be asked about

No values belong in this doc. Names only.

- Process: `GO_PORT`, `GO_ENV` / `APP_ENV`, `AUTO_MIGRATE`, `SEED_ON_STARTUP`, `LOG_HTTP`
- Data: `DATABASE_URL`, `HYPERDRIVE_URL`, `REDIS_URL`, pool sizes
- Auth: `JWT_SECRET`, `CORS_ORIGINS`, `GOOGLE_CLIENT_ID`
- Money: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
- Mail and ops: `SMTP_*`, `MERCHANT_NOTIFY_EMAIL`, `DISCORD_WEBHOOK_URL`, `QUOTATION_EMAIL`
- Images: `IMAGE_BASE_URL`, `GCS_BUCKET_NAME`, `GCS_PROJECT_ID`, `GCS_CREDENTIALS_JSON`
- AI: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `AI_PROVIDER`, `PLANTNET_API_KEY`, `PLANTNET_PROJECT`, `PLANTNET_RESERVE`
- Phone: `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`, `MSG91_WIDGET_ID`, `MSG91_TOKEN_AUTH`, `TRUECALLER_CLIENT_ID`
- Delivery: `STORE_LATITUDE`, `STORE_LONGITUDE`, `STORE_PINCODE`, `COURIER_PROVIDER`, `SHIPROCKET_*`, fee thresholds
- Admin map: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_ACCOUNT_ID`

Template: `apps/go-backend/example.env`.

### 7.10 Tests

```bash
cd apps/go-backend
go test ./...
go test ./internal/handlers/ -run TestName
```

Tests that exist today sit beside the package: payments, inventory, invoicing, fulfillment, plant scan/image, JWT, rate limit, security headers, cache, care season, Pl@ntNet, Shiprocket client, Discord, OTP proof, quotation, image optimize, docs handler. New money or stock behavior needs a test in that style. Most are table-driven `httptest` with a fake or a skipped integration.

### 7.11 Where the deep docs are

| Question | Doc |
|---|---|
| Why the system looks like this | `internal/docs/SYSTEM-DESIGN.md` |
| Boot, config guardrails, workers | `01-architecture.md` |
| Which middleware a route needs | `02-auth.md` |
| Search and catalog | `03-catalog-and-search.md` |
| Cache keys and invalidation | `04-caching.md` |
| Checkout, stock, refunds, GST, shipping | `05-orders-checkout-payments.md` |
| Dootha and account chat | `06-chat-and-ai.md` |
| Image keys | `07-images-and-storage.md` |
| Rate limits, webhook auth, metrics | `08-middleware-and-security.md` |
| Razorpay, Shiprocket, MSG91, the rest | `09-external-integrations.md` |
| AutoMigrate vs SQL files | `10-database-and-migrations.md` |
| Swagger | `11-api-reference-docs.md` |

---

## 8. The web app (`apps/web`)

Customer storefront. Package name `web`. Next.js **App Router only** (no `pages/`).

### 8.1 Dependencies

| Package | Role |
|---|---|
| `next` 16 | Framework. `output: "standalone"` in `next.config.ts` |
| `react` 19 | UI |
| `@opennextjs/cloudflare` | Builds the Worker. Scripts: `preview`, `deploy` |
| `wrangler` | Cloudflare CLI. `cf-typegen` writes `cloudflare-env.d.ts` |
| `tailwindcss` 4 + `@tailwindcss/postcss` | Styling. Preset from `@repo/tailwind-config` |
| `zustand` | `lib/store/authStore.ts`, `lib/store/cartStore.ts` |
| `@react-oauth/google` | Google button. Access token goes to `POST /auth/google` |
| `@marsidev/react-turnstile` | Cloudflare Turnstile on sensitive forms |
| `framer-motion` | Motion |
| `lucide-react`, `react-icons` | Icons |
| `sonner` | Toasts, wrapped by `lib/toast.tsx` |
| `lottie-react` | Illustrations |
| `@repo/ui` | Shared UI from the monorepo |

Dev: ESLint 9 via `@repo/eslint-config`, TypeScript 5.9 via `@repo/typescript-config`.

Scripts that matter: `dev` (port 3001), `lint`, `check-types`, `test`, `deploy`.

### 8.2 Deployment

`wrangler.jsonc` names the worker `growman-web`, entry `worker.ts`, custom domain `growman.live`. Bindings include a rate-limit KV, the OpenNext incremental-cache KV, Analytics Engine, Cloudflare Images, and a Durable Object queue for cache revalidation.

`open-next.config.ts` uses a regional long-lived incremental cache and `enableCacheInterception`.

`worker.ts` wraps the OpenNext worker and edge-caches `/_next/image`.

`middleware.ts` is **not** an auth gate. On the Cloudflare runtime it rate-limits with KV, drops obvious bots, and writes analytics (`vid` / `sid` cookies). In `next dev` those bindings are absent and that work no-ops.

Security headers (HSTS, nosniff, frame ancestors, COOP, camera/mic/geo policy) are set in `next.config.ts`.

### 8.3 How a page gets data

| Kind of page | Pattern | Example |
|---|---|---|
| SEO catalog | Async Server Component. `getApiUrl()` server branch. `next: { revalidate: 600 }` or route `export const revalidate` | `/`, `/shop`, `/categories/...`, sitemap |
| Product detail | Server Component + client islands (`AddCart`, reviews form). Product fetch is `cache()` + `no-store` so metadata and body share one fresh request | `app/product/[slug]/page.tsx` |
| Account, cart, checkout | `"use client"`. Bearer token from Zustand | `/cart`, `/checkout`, `/orders`, `/account` |

`lib/api.ts`:

- Browser base URL: `NEXT_PUBLIC_GO_API_URL` or `NEXT_PUBLIC_API_URL` or `http://localhost:8080/api/v1`.
- Server base URL: `GO_API_URL`, then the public vars, then localhost.
- `apiFetch` sets JSON headers and the bearer token.
- `readJson<T>` is a cast, not a schema validator. Wrong JSON becomes a runtime surprise, which is why field names must match Go.

### 8.4 Routes

| URL | File | Notes |
|---|---|---|
| `/` | `app/page.tsx` | Hero, featured, categories. `revalidate = 600` |
| `/shop` | `app/shop/page.tsx` | Filters, pagination |
| `/categories`, `/categories/[categorySlug]`, `.../[subcategorySlug]` | category PLPs | `generateStaticParams` on the category level |
| `/product/[slug]` | PDP | JSON-LD, reviews, size selector |
| `/product/add` | staff-ish create form | authenticated writes |
| `/search` | client search + “request this plant” | |
| `/cart` | Zustand cart | |
| `/checkout` | quote, coupon, OTP, Razorpay | |
| `/order-success` | confirmation | |
| `/orders` | history, cancel, invoice | |
| `/wishlist` | server wishlist | |
| `/account`, `/account/addresses`, `/account/privacy` | profile, address CRUD (max 10), export/erase | |
| `/login`, `/signup`, `/forgot-password` | auth | |
| `/bulk` | quotation builder | `POST /quotations` |
| `/gifting` | gifting collections | |
| `/blog`, `/blog/[slug]` | static posts in `lib/seo/blog.ts` | |
| `/about`, `/help-center`, `/privacy-policy`, `/terms`, `/delete-account` | content | |
| `app/sitemap.ts`, `app/robots.ts` | SEO | robots disallows cart, checkout, account, login |

Loading UI: `loading.tsx` on shop, orders, wishlist, account, category. Errors: root `error.tsx`, `global-error.tsx`, plus cart/checkout/orders.

### 8.5 Feature → files

| Feature | Start here |
|---|---|
| Home | `components/hompage/homeHero.tsx`, `navbar.tsx`, `plantSection.tsx` |
| Catalog UI | `components/productspage/*`, `lib/data.ts`, `lib/shopFilters.ts`, `lib/seo/catalog.ts` |
| PDP | `app/product/[slug]/page.tsx`, `productClient.tsx`, `AddCart.tsx`, `ProductTabs.tsx`, `ProductReviews.tsx` |
| Cart | `lib/store/cartStore.ts`, `lib/cart.ts`, `app/cart/page.tsx` |
| Checkout | `app/checkout/page.tsx`, `lib/fulfillment.ts` |
| Orders | `app/orders/page.tsx`, `components/account/CancelOrderDialog.tsx`, `InvoiceDownloadButton.tsx` |
| Addresses | `lib/addresses.ts`, `components/account/AddressFormDialog.tsx` |
| Reviews | `lib/reviews.ts` |
| Chat | `components/chatbot/PlantChatbot.tsx` |
| Privacy | `lib/consent.ts`, `components/privacy/*` |
| Quotations | `app/bulk`, `lib/quotation.ts` |
| Waitlist | `components/dootha/DoothaWaitlistPopup.tsx` |
| Pickup | `components/store/StorePickupDialog.tsx` |
| PWA | `public/sw.js`, `public/manifest.json`, `components/pwa/*` (registered in production) |
| SEO | `lib/seo/site.ts`, `metadata.ts`, `jsonLd.ts` |

### 8.6 Caching layers (say these in order)

1. Next `revalidate` / `no-store` on the fetch.
2. OpenNext incremental cache in KV, plus the regional Cache API.
3. Durable Object queue that revalidates on a timer.
4. Cloudflare Images and the worker cache for transforms.
5. The service worker and the static asset bucket.

Price and stock skip layer 1 on the PDP on purpose.

### 8.7 Commands

```bash
cd /home/venky/growman
pnpm install
pnpm --filter web dev          # http://localhost:3001
pnpm --filter web lint
pnpm --filter web check-types
pnpm --filter web test         # lib/seo/seo.test.ts
```

Env template: `apps/web/example.env`. Browser-visible values must be `NEXT_PUBLIC_*`. The Razorpay **secret** never goes in this app.

---

## 9. The mobile app (`/home/venky/growman-mobile`)

Package name `growman`, version 2.0.0. Entry `expo-router/entry`. This repo is **not** inside the pnpm workspace. It is a sibling checkout that speaks the same API.

New Architecture is on (`newArchEnabled`). Typed routes and the React compiler experiment are enabled in app config. Native modules (Google Sign-In, Razorpay, Truecaller, SMS autofill) mean you run a **dev client**, not Expo Go.

### 9.1 Dependencies

| Package | Role |
|---|---|
| `expo` ~54 | SDK |
| `react-native` 0.81.5, `react` 19.1 | Runtime |
| `expo-router` 6 | File routes under `app/` |
| `expo-dev-client` | Custom native binary |
| `nativewind` 4, `tailwindcss` 3 | `className` styling |
| `zustand` 5, `@react-native-async-storage/async-storage` | State that survives restarts |
| `@react-navigation/native`, `bottom-tabs` | Used by Expo Router |
| `react-native-reanimated` 4, `react-native-worklets`, `react-native-gesture-handler` | Motion. Root is wrapped in `GestureHandlerRootView` |
| `@react-native-google-signin/google-signin` | Google |
| `@msg91comm/sendotp-react-native` | MSG91 widget client in `lib/msg91Widget.ts`. The screens the user actually sees call the **backend** OTP routes |
| `@pushpendersingh/react-native-otp-verify` | Android SMS autofill |
| `@shayrn/react-native-android-phone-number-hint` | Phone number hint |
| `expo-truecaller` | One-tap on Android when `TRUECALLER_ANDROID_CLIENT_ID` is set |
| `react-native-razorpay` | Checkout and payment retry |
| `expo-image-picker` | Plant scan, chat photo, search |
| `expo-location` | Address locate |
| `expo-notifications` | Local care reminders. Channel name `care`. Tap opens `/my-plants/:id` |
| `expo-file-system`, `expo-sharing` | Invoice and data-export download |
| `expo-speech`, `expo-speech-recognition` | Voice search |
| `@expo-google-fonts/fraunces`, `manrope` | Display and body. Loaded before splash hides |
| `lottie-react-native` | `assets/Girl.json` |

Lint: `eslint-config-expo`. There is no Jest suite in this repo.

### 9.2 Navigation

```
app/index.tsx                 waits until auth store has hydrated, then
                              Redirect → /(tabs)/home  or  /(auth)
app/_layout.tsx               fonts, gesture root, Toast, Alert, ConsentBanner
app/(tabs)/_layout.tsx        Home, Shop, Cart, Dootha, Account
app/(auth)/_layout.tsx        welcome, phone, otp, login, signup, forgot password
app/<feature>.tsx             stack screens pushed on top (checkout, product, …)
```

The Dootha tab does not open a screen. `tabPress` calls `openChatbot()` and `components/Chatbot.tsx` draws the sheet. `app/(tabs)/chat.tsx` is a placeholder.

### 9.3 Screens

| Route file | What the user does |
|---|---|
| `(tabs)/home.tsx` | Featured plants, shortcuts, scan entry |
| `(tabs)/shop.tsx` | Browse by category and tag |
| `(tabs)/cart.tsx` | Local cart |
| `(tabs)/account.tsx` | Profile hub, logout |
| `(auth)/index.tsx` | Welcome: Google, Truecaller, phone |
| `(auth)/phone.tsx`, `otp.tsx` | OTP |
| `(auth)/complete-profile.tsx` | Name and email after a new phone user |
| `(auth)/login.tsx`, `forgot-password.tsx` | Email password |
| `(auth)/signup/*` | Email signup steps. Draft held in `lib/signupDraftContext.tsx` |
| `product/[id].tsx` | PDP. Accepts id or slug |
| `category/[slug].tsx`, `categories.tsx` | Listing |
| `checkout.tsx`, `order-success.tsx`, `orders.tsx` | Pay and track |
| `wishlist.tsx`, `saved.tsx` | Wishlist vs save-for-later |
| `saved-addresses.tsx`, `payment-methods.tsx` | Profile commerce data |
| `notifications.tsx` | In-app inbox |
| `my-plants/index.tsx`, `[id].tsx`, `edit.tsx`, `calendar.tsx` | Owned plants |
| `care-guides/index.tsx`, `[slug].tsx` | Static articles from `lib/careGuides.ts` |
| `plant-finder.tsx` | Light / pets / climate filters |
| `request-plant.tsx`, `bulk.tsx`, `gifting.tsx` | Demand and B2B |
| `your-data.tsx`, `delete-account.tsx`, `privacy-policy.tsx`, `terms.tsx` | Legal and DPDP |
| `about.tsx`, `support.tsx`, `help-center.tsx` | Content |

### 9.4 State

| Store | Persisted | Holds |
|---|---|---|
| `store/authStore.ts` | token only, key `auth-storage` | `token`, `isAuthenticated`, `hasHydrated` |
| `store/cartStore.ts` | the whole cart, key `cart-storage` | line items, qty helpers |
| `store/userStore.ts` | `localLocation` only | user profile loaded from `GET /auth/me` |
| `store/searchStore.ts` | no | search modal open + pending query |

`setToken` kicks `userStore.loadUser()`. `lib/api.ts` `resolveAuthToken()` reads Zustand first, then AsyncStorage, so a request fired before hydration still finds the token.

Other keys: consent (`growman-consent`), waitlist dismissal, quotation contact.

### 9.5 API and config

`config/env.ts` reads `EXPO_PUBLIC_*` values: API URL, Google client ids, Razorpay key id, MSG91 widget ids, Truecaller client id. Physical devices cannot use `localhost`; set `EXPO_PUBLIC_API_URL` to the machine LAN address or the Cloud Run URL.

`apiFetch` in `lib/api.ts` is the primitive. Domain helpers should live in `lib/<feature>.ts` and parse errors locally. `lib/api.ts` is already the auth and a few catalog calls; do not keep growing it.

| Module | Talks to |
|---|---|
| `lib/api.ts` | auth primitives, some product reads |
| `lib/catalog.ts` | products, categories, collections. 10 min memory cache |
| `lib/fulfillment.ts` | `/checkout/quote` |
| `lib/features.ts` | saved items, offers, recent, plant filter, reorder, active order |
| `lib/plantCare.ts` | `/me/plants`, calendar, notification inbox |
| `lib/careReminders.ts` | local notification schedule |
| `lib/chatApi.ts` | `/chat`, `/me/chat` |
| `lib/quotation.ts` | `/quotations` |
| `lib/doothaWaitlist.ts` | `/dootha-waitlist` |
| `lib/consent.ts` | `/consent`, export, erase |
| `lib/downloads.ts` | authorized file share (invoice, export) |
| `lib/business.ts` | nursery constants (name, city, support) |

Cart sync `POST /me/cart-signals` is analytics. The cart on disk is the cart.

### 9.6 UI conventions

- Colors and type: `lib/ui.ts`. Primary green used by the tab bar is `#059669`. Font classes are `font-display` (Fraunces) and `font-sans-*` (Manrope). Do not add `font-bold` on top of those; the family is already a weight.
- Screen chrome: `components/ScreenHeader.tsx`.
- Sheets: `components/BottomSheet.tsx`. Primary buttons: `components/ActionButton.tsx`.
- Forms: `FormInput`, `FormError`, `SelectField`.
- Feedback: `toast()` from `components/Toast.tsx`, and `Alert`.
- Loading: `components/skeletons/*` for lists, `components/Loading.tsx` for a full screen.
- Product pieces stay in `components/product/`.

`app.config.js` injects the Truecaller Android client id and release signing from env. Plugins in `app.json` include router, splash, location, Google Sign-In, speech recognition, Truecaller, and notifications.

### 9.7 Commands

```bash
cd /home/venky/growman-mobile
npm install
npx expo start
npm run android          # dev client
npm run lint
```

---

## 10. Admin (`apps/admin`)

Next.js 16 on port 3002. Same monorepo packages, Zustand, Tailwind 4. It calls the admin routes (`AdminMiddleware`) for catalog edits, order operations, and the request map (d3 + topojson). Turnstile is on the login. If a feature is staff-only, the screen goes here, the route goes under the admin group, and the customer apps do not get a button.

---

## 11. Adding a feature

Work in this order. Skipping the API and “just doing it on the client” is how price and privacy bugs land.

### 11.1 Decide what kind of feature it is

| Kind | Server work | Client work |
|---|---|---|
| Static content (a guide, an FAQ, a marketing page) | none | Web `app/<route>/page.tsx` and/or mobile `app/<route>.tsx`. Add sitemap + metadata on web |
| Read of existing data | maybe a query param on an existing handler | A helper and a screen |
| New account data | model, AutoMigrate, handler, route, auth middleware | Both clients if both should show it |
| Money, stock, coupons, invoices | extend checkout / inventory / payments. Add a Go test | Display the server response. Do not recompute it |
| Paid third party (SMS, AI, PlantNet) | strict rate limit, quota, fail closed | Show a clear error when the quota or the key is missing |
| Staff only | admin middleware | `apps/admin` only |

### 11.2 API checklist

1. If there is new persisted data, add the struct to `internal/models/models.go` with `json` and `gorm` tags. Embed `Base`.
2. Add `&models.YourType{}` to `AutoMigrate` in `internal/handlers/handler.go`. Add a SQL file under `migrations/` only when AutoMigrate cannot express the index or backfill.
3. Write `YourFeature` methods on `*Handler` in a new `handlers/<name>.go` or the closest existing file. Take the user from `appauth.Require` (or optional auth). Respond with `pkg/httpjson`.
4. Register the route in `internal/server/router.go` inside the right group. This is the step people forget, and the step that picks the security posture.
5. New env vars: field on `config.Config`, `Load`, and `example.env`. Document the name. Never commit a value.
6. If the response is a public catalog payload, cache it and invalidate it in the admin write path. If it contains a user’s data, do not use the public cache.
7. `go test ./...` plus a focused test if the feature touches stock, money, auth scope, or a webhook.

### 11.3 Web checklist

1. `app/<segment>/page.tsx`. Server Component if it is public and indexable. `"use client"` if it needs the token, the cart, or event handlers.
2. Metadata from `lib/seo/metadata.ts`. Public pages join `STATIC_PATHS` in `app/sitemap.ts`. Private pages use `createNoindexMetadata` and `robots.ts`.
3. Thin API functions in `lib/<feature>.ts` using `apiFetch` / `readApiError`. Types next to that file or in `lib/types.ts`, matching Go tags.
4. Logged-out users go to `/login?redirect=...`.
5. `loading.tsx` and `error.tsx` if the page is a transaction (checkout-shaped).
6. `pnpm --filter web lint` and `check-types`.

### 11.4 Mobile checklist

1. `app/<name>.tsx` (or `app/<name>/[id].tsx`). Default-export the screen. Use `ScreenHeader` and NativeWind.
2. Navigate with `router.push('/<name>')` from home or account.
3. API helper in `lib/<name>.ts`, not a new fetch wrapper.
4. Zustand only when two screens share the data or it must survive a restart. Otherwise `useState` and refetch on focus.
5. Gate on `useAuthStore().isAuthenticated` and send the user to `/(auth)` when the API will 401.
6. Empty, error, and loading states. Toast on a failed mutation.
7. `npm run lint`.

### 11.5 Worked example: “request a nursery visit”

A lead form. No stock, no payment. Same shape as quotations.

**API**

- Model `VisitRequest` with name, phone, city, preferred date, note, status. Embed `Base`.
- `AutoMigrate` it.
- `handlers/visits.go`: `CreateVisit` decodes JSON, validates phone with `phoneutil`, inserts, and calls the existing notify helper so Discord/email fire the way quotations do.
- Route: `POST /visits` next to `POST /quotations`, same IP limiter, **no JWT required** (a guest can ask). If you later add “my visits”, that list is `GET /me/visits` inside the full-auth group.
- Optional: `PATCH /visits/{id}` under `AdminMiddleware` to mark it done.

**Web**

- `app/visit/page.tsx` as a client form, or a server page with a client form child.
- `lib/visits.ts` → `apiFetch('/visits', { method: 'POST', body })`.
- Link it from the footer and from `/about`.
- `noindex` if you do not want it in Google; otherwise metadata + sitemap.

**Mobile**

- `app/visit.tsx`.
- `lib/visits.ts` with the same JSON body.
- A row on `account.tsx` or `about.tsx`: `router.push('/visit')`.
- Prefill name and phone from `userStore` when logged in. Still allow submit when logged out.

**Admin**

- A list page that `GET`s the admin route and patches status. Skip it until someone actually works the queue.

**What you do not do**

- Do not store the visit only in AsyncStorage.
- Do not send the email from the phone.
- Do not put the handler on the checkout router group “because it is a POST”.

### 11.6 Worked example: a field on an existing screen

Adding “gift message” to checkout is a column, not a new resource.

1. `Order.GiftMessage` in `models.go`, tag `json:"giftMessage"`, size-limited (`varchar(200)`).
2. AutoMigrate picks the column up.
3. `CreateCheckoutOrder` copies it off the request after trimming and length check. It does not affect price.
4. Invoice PDF prints it if non-empty.
5. Web checkout and mobile checkout add the input and include `giftMessage` in the create-order body.
6. Order list on both clients shows it. Types updated in both `lib/types.ts` files.

Touch the create-order test so an over-long message is rejected and a normal one is stored.

### 11.7 Review questions before you open a PR

- Who can call this if they are logged out, onboarding-only, or a different user?
- Can they set their own price, role, or user id in the body?
- What happens when Redis is nil?
- What happens when the external provider times out?
- Did catalog cache get invalidated, or did you cache something private?
- Do web and mobile send the same JSON?
- Is there a loading, empty, and error state on each screen you added?

---

## 12. Interview answers

Say these in your own words. The detail under each is what you expand if they push.

**What is the system?**  
Three clients, one Go API. Web is Next.js on Cloudflare, mobile is Expo, admin is a second Next app. Postgres is the source of truth. Redis is cache, OTP, and rate limits. Images are in GCS. Payments are Razorpay. Shipping is Shiprocket.

**Why Go and not Node for the API?**  
The API is the part that must get stock and money right under concurrency, with a small memory footprint and a single binary. The product UI wants React. Splitting them lets each side use the ecosystem it needs (Razorpay’s browser SDK, Expo native modules, GORM, chi).

**Why is there no service layer?**  
One process, one caller. Handlers are the service. A repository interface would be mocked in tests we mostly write as HTTP tests. The moment a second deployable needs the same stock rules, those rules should move out of the handler. That moment has not arrived.

**How does auth work?**  
Every method becomes one `User`. The API returns an HS256 JWT with `userId`, `role`, and `scope`. Full vs onboarding stops a half-registered phone user from hitting account routes. Admin is a role check, not a second user table. Clients keep the token in Zustand. The API re-checks it on every call. Web middleware does analytics, not authorization.

**How do you stop two people buying the last plant?**  
`create-order` reserves stock in a transaction before Razorpay opens. Capture commits the reservation. Cancel, failure, or the 5-minute sweeper (30 minutes unpaid) releases it. The unique key on webhook events stops a retried Razorpay event from committing twice. The same “do it once” idea is used for coupon redemption and refunds.

**Why can’t the app send the price?**  
The device cart is a convenience cache. It can be stale, modified, or old. `create-order` loads the product (and size) rows and computes subtotal, coupon, delivery, and GST. Razorpay is opened for that computed amount. Verify and the webhook both check the signature, with different secrets.

**How is the catalog fast?**  
Reads dominate. Two-tier cache plus singleflight. Web also revalidates HTML for 10 minutes at the edge, but the product page opts out so stock is live. Admin writes must invalidate the keys; otherwise the cache is a bug.

**What if Redis is down?**  
Catalog cache misses fall through to Postgres. OTP and the fail-closed limiters reject rather than silently allow password guessing or unpaid PlantNet calls. Fail-open limiters (leads) still accept the write. The process stays up. `readyz` goes red so a load balancer can stop sending traffic if you want that.

**Why Cloudflare for the site and Cloud Run for the API?**  
The site is read-mostly HTML, images, and edge caching. Workers + OpenNext fit that. The API has a long-lived Postgres pool, background tickers, and webhook handlers that must not be frozen between requests. A container is the simpler place for that.

**How does mobile differ from web?**  
Same API and same JWT shape. Mobile adds phone OTP, Truecaller, SMS autofill, a local notification schedule for plant care, and a camera flow for Pl@ntNet. Navigation is Expo Router file routes instead of the App Router. Styling is NativeWind (Tailwind 3) instead of Tailwind 4. There is no server-side render and no edge cache; the catalog cache is in memory for 10 minutes.

**What is Dootha?**  
The chat assistant. `POST /chat` classifies intent, answers care questions, can attach products, and, when the JWT is present, can read that user’s orders and wishlist. The provider is configurable (Gemini by default, for cost). It is a sheet on mobile (the tab only opens it) and `PlantChatbot` on web. It does not place orders by itself.

**How do you handle Indian specifics?**  
Razorpay, MSG91, phone normalization, GST-inclusive invoices numbered on the April–March year, Shiprocket pincodes, delivery zones from the nursery’s own coordinates, ₹ formatting on the clients.

**DPDP?**  
Consent is stored. Export and erasure are authenticated endpoints. Erasure does not throw away the accounting record inside the retention floor; a daily sweeper minimises personal data after that floor. Details: `SYSTEM-DESIGN.md` section 11.

**How would you add feature X?**  
Section 11. Model if needed, handler method, one line in `router.go` with the right middleware, then a thin client helper and a screen on each app that should show it. Money features get a Go test and do not trust the client total.

**What would you change at 10× traffic?**  
API replicas are already stateless behind a load balancer; the L1 cache is per process and that is fine because Redis is the shared tier. Next pressure points: Postgres read replica for catalog, moving the sweepers to a single leader so N replicas do not all book the same shipment, and a real migration tool once AutoMigrate on boot is too risky. Not microservices.

**What is weak today, honestly?**  
Web and mobile duplicate types with no schema check. Auth tokens are readable to JavaScript. Mobile has no automated tests. AutoMigrate on boot is convenient and dangerous if a bad struct ships. The `Handler` struct will keep growing; that is acceptable until a second service needs the same rules.

---

## 13. Local startup

```bash
# Postgres, Redis, Prometheus, Grafana
cd /home/venky/growman
docker compose up -d

# API
cd apps/go-backend
cp example.env .env          # then set DATABASE_URL and JWT_SECRET
go run ./cmd/server          # :8080  AUTO_MIGRATE on by default in dev

# Web
cd /home/venky/growman
pnpm install
pnpm --filter web dev        # :3001

# Mobile (other repo)
cd /home/venky/growman-mobile
npm install
# set EXPO_PUBLIC_API_URL to http://<your-lan-ip>:8080/api/v1
npx expo start
```

Dev payment verification can be skipped only when `APP_ENV` is development. Production refuses to boot without the Razorpay secrets. Do not point a release build at a dev database.

---

## 14. File index (open these first)

| Task | First file |
|---|---|
| Understand a request | `apps/go-backend/internal/server/router.go` |
| Boot and workers | `apps/go-backend/cmd/server/main.go` |
| Tables | `apps/go-backend/internal/models/models.go` |
| JWT | `apps/go-backend/internal/auth/jwt.go` |
| Web data fetching | `apps/web/lib/api.ts` |
| Web routes | `apps/web/app/` |
| Mobile data fetching | `growman-mobile/lib/api.ts` |
| Mobile routes | `growman-mobile/app/` |
| Mobile token | `growman-mobile/store/authStore.ts` |
| Cart (either client) | `*/store/cartStore.ts` or `lib/store/cartStore.ts` |
| Why | `apps/go-backend/internal/docs/SYSTEM-DESIGN.md` |
