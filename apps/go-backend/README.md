# Go Backend

A Go backend API server built with Chi router, GORM, PostgreSQL, and Redis.

## Features

- RESTful API with Chi router
- PostgreSQL database with GORM
- Redis caching support
- JWT authentication
- Cloudflare Workers deployment support
- Database migrations
- Seed data support

## Local Development

### Prerequisites

- Go 1.21+
- PostgreSQL database
- Redis (optional)
- Environment variables configured

### Setup

1. Copy example environment file:
   ```bash
   cp example.env .env
   ```

2. Update `.env` with your configuration:
   ```env
   DATABASE_URL=postgresql://user:password@host:port/database
   JWT_SECRET=your-secret-key
   CORS_ORIGINS=http://localhost:3000
   REDIS_URL=redis://localhost:6379
   ```

3. Install dependencies:
   ```bash
   go mod download
   ```

4. Run the server:
   ```bash
   npm run dev
   # or
   go run ./cmd/server
   ```

The server will start on `:8080` by default.

## Cloudflare Workers Deployment

This backend can be deployed to Cloudflare Workers using WebAssembly (WASM).

### Quick Start

1. Install Wrangler CLI:
   ```bash
   npm install -g wrangler
   ```

2. Login to Cloudflare:
   ```bash
   wrangler login
   ```

3. Set environment variables:
   ```bash
   wrangler secret put DATABASE_URL
   wrangler secret put JWT_SECRET
   wrangler secret put CORS_ORIGINS
   ```

4. Build and deploy:
   ```bash
   npm run build:worker
   npm run deploy
   ```

For detailed deployment instructions, see [DEPLOY.md](./DEPLOY.md).

## API Endpoints

### Health Check
- `GET /healthz` - Health check endpoint

### Products
- `GET /api/v1/products` - List products
- `GET /api/v1/products/search` - Search products
- `GET /api/v1/products/featured` - Get featured products
- `GET /api/v1/products/{slug}` - Get product by slug
- `POST /api/v1/products` - Create product (authenticated)
- `PUT /api/v1/products/{slug}` - Update product (authenticated)
- `DELETE /api/v1/products/{slug}` - Delete product (authenticated)
- `GET /api/v1/products/{slug}/related` - Get related products

### Categories
- `GET /api/v1/categories` - List categories
- `GET /api/v1/categories/{slug}` - Get category
- `GET /api/v1/categories/{slug}/products` - Get products by category
- `GET /api/v1/categories/{slug}/subcategories` - List subcategories
- `GET /api/v1/categories/{slug}/subcategories/{subSlug}/products` - Get products by subcategory

### Brands
- `GET /api/v1/brands` - List brands

### Tags
- `GET /api/v1/tags` - List tags

### Authentication
- `POST /api/v1/auth/login` - Login and get JWT token
- `GET /api/v1/auth/me` - Get current user (authenticated)

## Environment Variables

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `GO_PORT` | No | Server port | `:8080` |
| `GO_ENV` | No | Environment | `development` |
| `DATABASE_URL` | Yes* | PostgreSQL connection string | - |
| `HYPERDRIVE_URL` | Yes* | Cloudflare Hyperdrive connection | - |
| `JWT_SECRET` | Yes | JWT signing secret | - |
| `CORS_ORIGINS` | Yes | Allowed CORS origins (comma-separated) | - |
| `REDIS_URL` | No | Redis connection string | - |
| `AUTO_MIGRATE` | No | Run migrations on startup | `true` |
| `SEED_ON_STARTUP` | No | Seed database on startup | `false` |

*Either `DATABASE_URL` or `HYPERDRIVE_URL` is required.

## Project Structure

```
apps/go-backend/
├── cmd/
│   ├── server/        # Standard HTTP server entry point
│   └── worker/        # Cloudflare Workers entry point
├── internal/
│   ├── auth/          # JWT authentication
│   ├── cache/         # Caching utilities
│   ├── config/        # Configuration management
│   ├── db/            # Database connections (PostgreSQL, Redis)
│   ├── handlers/      # HTTP handlers
│   ├── models/        # Data models
│   └── server/        # Router setup
├── pkg/
│   └── httpjson/      # JSON response utilities
├── seed/              # Database seeding
├── wrangler.toml      # Cloudflare Workers configuration
└── go.mod             # Go dependencies
```

## Scripts

- `npm run dev` - Run development server
- `npm run start` - Run production server
- `npm run build` - Build standard binary
- `npm run build:worker` - Build WASM for Cloudflare Workers
- `npm run deploy` - Deploy to Cloudflare Workers
- `npm run dev:worker` - Test Workers locally

## License

ISC


