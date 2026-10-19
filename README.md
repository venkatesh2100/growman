# Growman - E-Commerce Platform

A full-stack e-commerce platform for plant and gardening products, built with a modern tech stack. This is a monorepo containing both the frontend (Next.js) and backend (Go) applications.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Development Setup](#development-setup)
- [Docker Setup](#docker-setup)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [Documentation](#documentation)

## Overview

Growman is a complete e-commerce solution featuring:

- **Frontend**: Modern Next.js 16 application with React 19, TypeScript, and Tailwind CSS
- **Backend**: High-performance Go API with PostgreSQL and Redis
- **Features**:
  - Product catalog with categories and subcategories
  - User authentication (email/password, Google OAuth, phone OTP, Truecaller)
  - Shopping cart and checkout, with guest checkout gated on a verified email
  - Payment processing (Razorpay), with signature verification on both the
    checkout callback and the webhook
  - Inventory: stock is reserved at order creation, committed on payment, and
    released if the order is abandoned, so the last plant cannot be sold twice
  - Coupons and discounts (percentage, fixed, free shipping), with the discount
    evaluated server-side
  - Order management, customer-initiated cancellation, and refunds
  - GST tax invoices as PDFs, numbered per Indian financial year, plus a
    GSTR-ready CSV export
  - Courier fulfillment through Shiprocket: shipment booking, AWB generation,
    pickup scheduling and tracking updates by webhook
  - Product reviews with verified-purchase detection and admin moderation
  - DPDP Act 2023 support: consent records, data export, and erasure that
    respects the one-year transactional retention floor
  - Email notifications (OTP, order confirmation, shipped, cancelled, invoice,
    review request, back-in-stock)
  - Progressive Web App (PWA) support
  - Rate limiting and caching

## Architecture

```
┌─────────────────┐
│   Frontend      │
│   (Next.js)     │
│   Port: 3001    │
└────────┬────────┘
         │ HTTP/REST API
         │
┌────────▼────────┐
│   Backend       │
│   (Go/Chi)      │
│   Port: 8080    │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
┌───▼───┐ ┌──▼────┐
│PostgreSQL│ │ Redis │
│  :5432  │ │ :6379 │
└────────┘ └───────┘
```

### Component Interaction

1. **Frontend** (Next.js) makes API calls to **Backend** (Go API)
2. **Backend** handles:
   - Authentication (JWT tokens, scoped so a half-registered signup cannot
     reach full-account endpoints)
   - Business logic
   - Database operations (PostgreSQL via GORM)
   - Caching and rate limiting (Redis)
   - Payment processing (Razorpay webhooks)
   - Courier fulfillment (Shiprocket order creation, AWB, tracking webhook)
3. **Database** stores:
   - Users, products, categories, orders
   - Product inventory and pricing
   - Reviews, coupons, refunds, invoices, shipments, consent records
4. **Redis** provides:
   - Rate limiting (per IP)
   - OTP storage and the short-lived checkout email-verification proof
   - Caching (optional)
   - Orders & wishlist

### Background Workers

The server starts three workers before it begins listening. They share a
context that is cancelled on `SIGINT`/`SIGTERM`, so a shutdown stops them
before the connection pool closes. Each runs on its own ticker, so the first
pass happens one interval after boot rather than immediately.

| Worker | Interval | Responsibility |
|---|---|---|
| `StartInventorySweeper` | 5 minutes | Returns reserved stock from orders left unpaid for 30 minutes |
| `StartShipmentWorker` | 15 minutes | Books pending shipments, refreshes tracking as a backstop for missed webhooks, sends post-delivery review requests |
| `StartRetentionSweeper` | daily | Enforces DPDP purpose-limited retention by removing minimised order rows past the one-year floor |

They are wired up in `apps/go-backend/cmd/server/main.go`.

## Tech Stack

### Frontend (`apps/web`)
- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **UI**: React 19, Tailwind CSS 4
- **State Management**: Zustand
- **Authentication**: JWT tokens, Google OAuth
- **Payments**: Razorpay SDK
- **Deployment**: Cloudflare Pages/Workers, Vercel

### Backend (`apps/go-backend`)
- **Language**: Go 1.24+
- **Router**: Chi
- **ORM**: GORM
- **Database**: PostgreSQL 16+
- **Cache**: Redis 7+
- **Authentication**: JWT (golang-jwt/jwt)
- **Payments**: Razorpay API
- **Email**: SMTP (Gmail/other providers)

### Infrastructure
- **Monorepo**: Turborepo
- **Package Manager**: pnpm
- **Containerization**: Docker & Docker Compose
- **Database**: PostgreSQL
- **Cache**: Redis

### Shared Packages
- `@repo/ui`: Shared React components
- `@repo/eslint-config`: ESLint configurations
- `@repo/typescript-config`: TypeScript configurations
- `@repo/tailwind-config`: Tailwind CSS configuration

## Project Structure

```
growman/
├── apps/
│   ├── web/                    # Frontend Next.js application
│   │   ├── app/                # Next.js App Router pages
│   │   ├── components/         # React components
│   │   ├── lib/                # Utilities, stores, API client
│   │   └── public/             # Static assets
│   │
│   ├── go-backend/             # Backend Go API
│   │   ├── cmd/                # Application entry points
│   │   ├── internal/           # Internal application code
│   │   │   ├── handlers/      # HTTP handlers
│   │   │   ├── models/         # Database models
│   │   │   ├── services/       # Business logic
│   │   │   └── server/         # Router setup
│   │   └── pkg/                # Public packages
│   │
│   └── docs/                   # Documentation site (optional)
│
├── packages/
│   ├── ui/                     # Shared UI components
│   ├── eslint-config/          # ESLint configurations
│   ├── typescript-config/      # TypeScript configurations
│   └── tailwind-config/        # Tailwind CSS configuration
│
├── docker-compose.yml          # Docker Compose configuration
├── turbo.json                  # Turborepo configuration
├── pnpm-workspace.yaml         # pnpm workspace configuration
└── package.json                # Root package.json
```

## Quick Start

### Prerequisites

- **Node.js** 18+ and **pnpm** 10.19.0
- **Go** 1.24+
- **Docker** and **Docker Compose** (for databases)
- **Git**

### 1. Clone the Repository

```bash
git clone <repository-url>
cd growman
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Set Up Environment Variables

**Backend**:
```bash
cd apps/go-backend
cp example.env .env
# Edit .env with your configuration
```

**Frontend**:
```bash
cd apps/web
cp example.env .env.local
# Edit .env.local with your configuration
```

### 4. Start Infrastructure (PostgreSQL & Redis)

```bash
# From project root
docker-compose up -d postgres redis
```

### 5. Start Backend

```bash
cd apps/go-backend
pnpm dev
```

The backend will start on `http://localhost:8080`

### 6. Start Frontend

```bash
# From project root (new terminal)
pnpm dev
```

Or from frontend directory:
```bash
cd apps/web
pnpm dev
```

The frontend will start on `http://localhost:3001`

### 7. Verify Setup

- Backend health: `curl http://localhost:8080/healthz`
- Frontend: Open `http://localhost:3001` in browser

## Development Setup

### Full Development Environment

1. **Start all services**:
   ```bash
   # Terminal 1: Infrastructure
   docker-compose up -d
   
   # Terminal 2: Backend
   cd apps/go-backend
   pnpm dev
   
   # Terminal 3: Frontend
   cd apps/web
   pnpm dev
   ```

2. **Or use Turborepo** (runs all apps):
   ```bash
   # From root
   pnpm dev
   ```

### Environment Variables

#### Backend (`apps/go-backend/.env`)

`apps/go-backend/example.env` is the authoritative list. It is a commented
template with every supported variable, and it explains what each one does
and what breaks when it is wrong — read it rather than relying on the subset
below. It is tracked in git deliberately so new contributors get the
template, which means **nothing real may ever be written into it**; put real
values in `.env`, which is gitignored.

The minimum for local development:

```env
GO_PORT=:8080
GO_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/growman?sslmode=disable
JWT_SECRET=your-secret-key-change-in-production
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
REDIS_URL=redis://localhost:6379
AUTO_MIGRATE=true
SEED_ON_STARTUP=false
RAZORPAY_KEY_ID=rzp_test_xxxxx
RAZORPAY_KEY_SECRET=your-razorpay-secret
RAZORPAY_WEBHOOK_SECRET=your-dashboard-webhook-secret
SMTP_EMAIL=your-email@gmail.com
SMTP_PASSWORD=your-app-password
IMAGE_BASE_URL=https://your-image-host/
```

With `GO_ENV=development` the Razorpay signature check is skipped, so local
checkout works without real keys. That bypass is gated solely on `GO_ENV`
being `development`, `dev` or `test` — an empty secret does **not** disable
verification, because a misconfigured production deploy silently accepting
unsigned payments is exactly the failure mode worth preventing.

**The two Razorpay secrets are different values and are not
interchangeable.** This catches people out, so it is worth being explicit:

| Variable | Where it comes from | What it signs |
|---|---|---|
| `RAZORPAY_KEY_SECRET` | Razorpay dashboard, Settings → API Keys | The checkout callback: `HMAC-SHA256("<order_id>\|<payment_id>")` |
| `RAZORPAY_WEBHOOK_SECRET` | Chosen by you when you create the webhook under Settings → Webhooks | The raw webhook request body |

Putting the key secret in both places makes every webhook delivery fail its
signature check, and it fails quietly, because the happy path still works
through the checkout callback. Razorpay then retries with backoff for 24
hours and disables the endpoint. Watch the
`payment_signature_failures_total{stage="webhook"}` metric after changing
either value.

Two further variables are needed for the courier flow.
`SHIPROCKET_PICKUP_LOCATION` must match the nickname of a pickup address
exactly as it appears in the Shiprocket panel under Settings → Pickup
Addresses, because Shiprocket rejects a booking whose pickup location does
not match one by name. `SHIPROCKET_WEBHOOK_TOKEN` is the shared secret
Shiprocket sends in the `x-api-key` header on status updates; leave it blank
and `POST /webhooks/shiprocket` refuses every request rather than trusting
unauthenticated status changes.

#### Frontend (`apps/web/.env.local`)

```env
NEXT_PUBLIC_API_URL=http://localhost:8080/api/v1
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxxxx
```

### Database Setup

The backend automatically runs migrations on startup if `AUTO_MIGRATE=true`.

To seed sample data:
```env
SEED_ON_STARTUP=true
```

### Available Scripts

**Root level**:
```bash
pnpm dev          # Start all apps in development mode
pnpm build        # Build all apps
pnpm lint         # Lint all apps
pnpm check-types  # Type check all apps
```

**Backend** (`apps/go-backend`):
```bash
pnpm dev          # Run development server
pnpm build        # Build binary
pnpm start        # Run production server
```

**Frontend** (`apps/web`):
```bash
pnpm dev          # Start development server
pnpm build        # Build for production
pnpm start        # Start production server
pnpm lint         # Run ESLint
pnpm check-types  # Type check
pnpm test         # Run unit tests
```

### Continuous Integration

`.github/workflows/ci.yml` runs on every pull request and on pushes to
`main`, and is the workflow that should gate a merge. Deployment lives in a
separate `cd.yml`. CI runs two jobs:

- **Go backend**: `go mod verify`, a `gofmt` check, `go vet`, `go build`, and
  `go test -race`. The race detector is not optional here — the webhook
  deduplication claim, the inventory reservation and the cache's singleflight
  all depend on correct synchronisation.
- **Next.js web**: `check-types`, `lint`, `test`, then `build`.

Run these locally before pushing. `pnpm --filter web check-types` is the one
most worth remembering, because `next.config.ts` now sets
`typescript.ignoreBuildErrors: false`: a type error fails the production
build outright rather than shipping and surfacing as a runtime crash in a
customer's browser. The type check also reports every error at once, where
the build stops at the first module.

## Docker Setup

### Using Docker Compose (Recommended)

Start all services:
```bash
docker-compose up -d
```

This starts:
- PostgreSQL (port 5432)
- Redis (port 6379)
- Backend API (port 8080)

Stop all services:
```bash
docker-compose down
```

View logs:
```bash
docker-compose logs -f
```

### Individual Docker Containers

**Backend**:
```bash
cd apps/go-backend
docker build -t growman-backend .
docker run -p 8080:8080 \
  -e DATABASE_URL=postgresql://... \
  -e JWT_SECRET=... \
  growman-backend
```

**Frontend**:
```bash
cd apps/web
docker build -t growman-web .
docker run -p 3001:3001 \
  -e NEXT_PUBLIC_API_URL=http://backend:8080/api/v1 \
  growman-web
```

## Deployment

### Backend Deployment

**Cloud Run (Google Cloud)**:
```bash
cd apps/go-backend
gcloud builds submit --tag gcr.io/PROJECT_ID/growman-backend
gcloud run deploy growman-backend \
  --image gcr.io/PROJECT_ID/growman-backend \
  --platform managed
```

**Docker**:
```bash
docker build -t growman-backend -f apps/go-backend/Dockerfile .
docker push your-registry/growman-backend
```

### Frontend Deployment

**Cloudflare Pages**:
```bash
cd apps/web
pnpm build
pnpm deploy
```

**Vercel**:
- Connect repository to Vercel
- Set environment variables
- Deploy automatically on push

**Docker**:
```bash
docker build -t growman-web -f apps/web/Dockerfile .
docker push your-registry/growman-web
```

### Environment Variables for Production

Ensure all required environment variables are set in your deployment platform:

**Backend** — the service refuses to boot in production without the first
four. `config.Load()` checks them at startup rather than letting the
service come up and fail later at checkout:

- `JWT_SECRET` (strong and random; the default is rejected in production)
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET` (the dashboard webhook secret, not the key secret)
- `DATABASE_URL` or `HYPERDRIVE_URL`

Also required for correct operation, though not enforced at boot:

- `GO_ENV=production` — this is what enables the checks above and disables
  the non-production signature bypass
- `CORS_ORIGINS` (your frontend domain)
- `RAZORPAY_KEY_ID`
- `SMTP_EMAIL` and `SMTP_PASSWORD`
- `IMAGE_BASE_URL`
- `SHIPROCKET_EMAIL` and `SHIPROCKET_PASSWORD`, plus
  `SHIPROCKET_PICKUP_LOCATION` and `SHIPROCKET_WEBHOOK_TOKEN`, if you are
  using courier fulfillment. Without them the backend still quotes on fee
  bands but cannot book a shipment
- `REDIS_URL` — technically optional, since the cache, rate limiter and OTP
  store all fall back to in-process memory. In production with more than one
  replica you want it anyway: the fallback rate limiter is per-process, so N
  replicas means N times the configured limit

**Frontend**:
- `NEXT_PUBLIC_API_URL` (your backend URL)
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
- `NEXT_PUBLIC_RAZORPAY_KEY_ID`

### Health and readiness probes

Point your orchestrator's **liveness** probe at `GET /healthz` and its
**readiness** probe at `GET /readyz`. They are deliberately different:
`/healthz` is a static response that proves the process is up and
intentionally touches no datastore, while `/readyz` pings Postgres and Redis
under a two-second timeout. A Postgres failure returns `503` with status
`down`; a Redis failure reports `degraded` but still returns `200`, because
the code tolerates a missing Redis throughout and pulling a replica out of
rotation over a cache outage would do more harm than good.

## Contributing

### Getting Started

1. **Fork the repository**
2. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make your changes**
   - Follow code style guidelines
   - Write/update tests if applicable
   - Update documentation

4. **Test your changes** — run what CI runs, so a failure surfaces locally
   rather than on the pull request:
   ```bash
   # Backend
   cd apps/go-backend
   gofmt -l .          # must print nothing
   go vet ./...
   go test -race ./...

   # Frontend
   cd apps/web
   pnpm check-types    # the build fails on type errors, so this is not optional
   pnpm lint
   pnpm test
   ```

5. **Commit and push**:
   ```bash
   git commit -m "feat: add your feature"
   git push origin feature/your-feature-name
   ```

6. **Create a Pull Request**

### Code Style

- **Go**: Follow standard Go formatting (`gofmt`)
- **TypeScript/React**: Follow ESLint and Prettier rules
- **Commits**: Use conventional commit messages
- **Documentation**: Update README files for new features

### Project-Specific Guidelines

- **Backend**: Keep handlers thin, business logic in services
- **Frontend**: Use TypeScript, functional components, Zustand for state
- **API**: Follow RESTful conventions, use consistent response formats
- **Database**: Use migrations for schema changes

## Documentation

Start with **[docs/COMPLETE-GUIDE.md](docs/COMPLETE-GUIDE.md)** for interview prep and the checklist for adding a feature across the API, the web app, and the mobile app. The backend essays under `apps/go-backend/internal/docs/` are the deep reference for payments, auth, caching, and privacy.

### Detailed Documentation

- **[Frontend README](apps/web/README.md)** - Complete frontend documentation
  - Setup and development
  - Component structure
  - State management
  - API integration
  - Deployment guide

- **[Backend README](apps/go-backend/README.md)** - Complete backend documentation
  - API endpoints
  - Database schema
  - Authentication flow
  - Deployment guide
  - Contributing guidelines

### Key Concepts

**Authentication Flow**:
1. User logs in via frontend
2. Frontend sends credentials to backend
3. Backend validates and returns JWT token
4. Frontend stores token and includes in API requests
5. Backend validates token on protected routes

**Checkout Flow**:
1. User adds items to cart (frontend state)
2. User proceeds to checkout and chooses a fulfillment channel. This is
   required: the server reprices the cart from the database per channel and
   charges its own figure, so omitting the channel would skip repricing
3. Guests verify their email by OTP. `POST /checkout/verify-email-otp`
   returns a short-lived, single-use `verificationToken` bound to that one
   address, which `create-order` then requires — so the OTP step cannot be
   skipped by calling the API directly. Signed-in customers skip this
4. User enters a shipping address, and optionally a coupon code, which the
   server validates and prices itself
5. `POST /checkout/create-order` reserves stock, redeems the coupon, creates
   the local order and the Razorpay order — all in one transaction — and
   returns a `publicToken` for guest order lookup
6. User completes payment
7. Payment is confirmed on whichever path arrives first. Both verify an
   HMAC signature and both are safe to run twice: the browser callback hits
   `POST /razorpay/verify` (signed with the key secret), and the Razorpay
   webhook hits `POST /webhooks/razorpay` (signed with the webhook secret,
   over the raw body). The paid transition is claimed with a conditional
   update, so whichever arrives second is a no-op and the customer gets
   exactly one confirmation email
8. On payment: stock is committed and a GST invoice number is assigned,
   both inside the same transaction, so the invoice sequence cannot skip on
   a rolled-back payment. Courier-channel orders are then picked up by
   `StartShipmentWorker` on its next pass, which books the shipment and
   generates the AWB — booking is not inline, so a Shiprocket outage cannot
   fail a payment confirmation

Note that `POST /razorpay/order` no longer exists. It created a Razorpay
order from a client-supplied amount with no cart validation;
`POST /checkout/create-order` is the only way to create an order.

**Data Flow**:
- Frontend → API Client (`lib/api.ts`) → Backend → Database
- Backend → Redis (caching, rate limiting, OTP storage)
- Backend → SMTP (email notifications)

## Troubleshooting

### Common Issues

**Port conflicts**:
- Backend default: 8080
- Frontend default: 3001
- PostgreSQL: 5432
- Redis: 6379

**Database connection errors**:
- Verify PostgreSQL is running: `docker ps`
- Check `DATABASE_URL` format
- Ensure database exists

**CORS errors**:
- Verify `CORS_ORIGINS` includes frontend URL
- Check frontend `NEXT_PUBLIC_API_URL` is correct

**Authentication issues**:
- Verify `JWT_SECRET` is set
- Check token is included in requests
- Verify token hasn't expired
- A `403` on an endpoint you expect to work may be a scope problem rather
  than an expiry one. Phone and Truecaller signups that have not completed
  a profile hold `scope=onboarding` tokens, which may only call
  `POST /auth/profile/complete`

**Every Razorpay webhook returns 401**:
- Almost always `RAZORPAY_WEBHOOK_SECRET` holding the API key secret
  instead of the webhook secret you set in the dashboard. See the two-secret
  table under Environment Variables
- Confirm with `payment_signature_failures_total{stage="webhook"}` on
  `/metrics`, and with the delivery log in the Razorpay dashboard
- This fails quietly, because the checkout callback keeps confirming
  payments on its own. Check it explicitly after any change to either secret

**Checkout returns 400 or 403**:
- `fulfillment_channel_required` — the request omitted the channel, which
  the server needs in order to reprice the cart
- `email_not_verified` — a guest's `verificationToken` is missing, expired
  (15 minutes) or already spent. Each token is single-use and bound to one
  email address
- `amount_mismatch` (409) — the server repriced the cart and disagreed. The
  response carries the new `quote`; show it to the customer
- `out_of_stock` (409) — the `items` field names the lines that could not be
  reserved

**Production build fails on a type error**:
- Expected. `next.config.ts` sets `ignoreBuildErrors: false`
- Run `pnpm --filter web check-types` to see every error at once instead of
  stopping at the first module

### Getting Help

- Check individual README files for app-specific issues
- Review API documentation in backend README
- Check existing GitHub issues
- Review logs for error messages

## License

ISC

## Additional Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Go Documentation](https://go.dev/doc/)
- [Turborepo Documentation](https://turbo.build/repo/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Redis Documentation](https://redis.io/documentation)
