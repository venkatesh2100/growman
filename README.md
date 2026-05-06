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
  - User authentication (email/password + Google OAuth)
  - Shopping cart and checkout
  - Payment processing (Razorpay)
  - Order management
  - Email notifications (OTP-based)
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
   - Authentication (JWT tokens)
   - Business logic
   - Database operations (PostgreSQL via GORM)
   - Caching and rate limiting (Redis)
   - Payment processing (Razorpay webhooks)
3. **Database** stores:
   - Users, products, categories, orders
   - Product inventory and pricing
4. **Redis** provides:
   - Rate limiting (per IP)
   - OTP storage (temporary)
   - Caching (optional)

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
SMTP_EMAIL=your-email@gmail.com
SMTP_PASSWORD=your-app-password
```

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
```

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

**Backend**:
- `DATABASE_URL` or `HYPERDRIVE_URL`
- `JWT_SECRET` (strong, random secret)
- `CORS_ORIGINS` (your frontend domain)
- `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`
- `SMTP_EMAIL` and `SMTP_PASSWORD`

**Frontend**:
- `NEXT_PUBLIC_API_URL` (your backend URL)
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
- `NEXT_PUBLIC_RAZORPAY_KEY_ID`

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

4. **Test your changes**:
   ```bash
   # Backend
   cd apps/go-backend
   pnpm dev
   
   # Frontend
   cd apps/web
   pnpm dev
   pnpm lint
   pnpm check-types
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
2. User proceeds to checkout
3. Email OTP verification (backend sends OTP)
4. User enters shipping address
5. Backend creates Razorpay order
6. User completes payment
7. Razorpay webhook confirms payment
8. Order is created in database

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
