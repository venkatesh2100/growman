# Growman Backend API

A high-performance REST API built with Go, providing the backend services for the Growman e-commerce platform. Built with Chi router, GORM, PostgreSQL, and Redis.

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Development](#development)
- [Configuration](#configuration)
- [API Documentation](#api-documentation)
- [Database Schema](#database-schema)
- [Authentication](#authentication)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [Troubleshooting](#troubleshooting)

## Overview

The Growman backend is a RESTful API that provides:

- Product management (CRUD operations)
- Category and subcategory management
- User authentication (JWT-based)
- Shopping cart and checkout
- Payment processing (Razorpay integration)
- Order management
- Email notifications (OTP-based)
- Rate limiting and caching
- Database migrations and seeding

## Tech Stack

### Core Technologies
- **Go 1.24+** - Programming language
- **Chi Router** - HTTP router and middleware
- **GORM** - ORM for database operations
- **PostgreSQL** - Primary database
- **Redis** - Caching and rate limiting

### Key Libraries
- **golang-jwt/jwt** - JWT token handling
- **go-redis/redis** - Redis client
- **gorm.io/driver/postgres** - PostgreSQL driver
- **godotenv** - Environment variable management
- **golang.org/x/crypto** - Password hashing (bcrypt)

## Project Structure

```
apps/go-backend/
├── cmd/                          # Application entry points
│   ├── server/                   # Standard HTTP server
│   │   └── main.go              # Server entry point
│   └── migrate/                 # Database migration tool
│       └── main.go
│
├── internal/                     # Internal application code
│   ├── auth/                     # Authentication logic
│   │   ├── context.go           # Auth context helpers
│   │   └── jwt.go               # JWT token generation/validation
│   │
│   ├── cache/                    # Caching utilities
│   │   └── cache.go
│   │
│   ├── config/                    # Configuration management
│   │   └── config.go            # Environment config loader
│   │
│   ├── db/                       # Database connections
│   │   ├── postgres.go          # PostgreSQL connection
│   │   └── redis.go             # Redis connection
│   │
│   ├── handlers/                 # HTTP request handlers
│   │   ├── handler.go           # Handler struct and initialization
│   │   ├── auth.go              # Authentication endpoints
│   │   ├── products.go          # Product endpoints
│   │   ├── categories.go        # Category endpoints
│   │   ├── brands.go            # Brand endpoints
│   │   ├── tags.go              # Tag endpoints
│   │   ├── checkout.go          # Checkout endpoints
│   │   ├── orders.go            # Order endpoints
│   │   ├── payments.go          # Payment endpoints
│   │   ├── webhooks.go          # Webhook handlers
│   │   └── health.go            # Health check
│   │
│   ├── middlewares/              # HTTP middlewares
│   │   └── ratelimit.go         # Rate limiting middleware
│   │
│   ├── models/                   # Data models
│   │   └── models.go            # GORM models
│   │
│   ├── services/                 # Business logic services
│   │   ├── email.go             # Email service (SMTP)
│   │   └── otp.go               # OTP generation/verification
│   │
│   └── server/                   # Server setup
│       └── router.go            # Route definitions
│
├── pkg/                          # Public packages
│   ├── httpjson/                 # JSON response utilities
│   │   └── httpjson.go
│   └── pagination/               # Pagination utilities
│       └── pagination.go
│
├── seed/                         # Database seeding
│   └── seed.go                  # Sample data seeding
│
├── bin/                          # Compiled binaries
│   └── server
│
├── Dockerfile                    # Docker configuration
├── go.mod                        # Go module dependencies
├── go.sum                        # Dependency checksums
├── example.env                   # Environment variable template
└── package.json                  # npm scripts for convenience
```

## Getting Started

### Prerequisites

- **Go 1.24+** - [Install Go](https://go.dev/doc/install)
- **PostgreSQL 16+** - [Install PostgreSQL](https://www.postgresql.org/download/)
- **Redis 7+** (optional but recommended) - [Install Redis](https://redis.io/download)
- **Git** - For version control

### Installation

1. **Clone the repository** (if not already done):
   ```bash
   git clone <repository-url>
   cd growman/apps/go-backend
   ```

2. **Install Go dependencies**:
   ```bash
   go mod download
   ```

3. **Set up environment variables**:
   ```bash
   cp example.env .env
   ```

4. **Configure environment variables** (see [Configuration](#configuration) section)

5. **Start PostgreSQL and Redis** (using Docker Compose from root):
   ```bash
   # From project root
   docker-compose up -d postgres redis
   ```

6. **Run database migrations** (automatic on startup if `AUTO_MIGRATE=true`)

7. **Start the server**:
   ```bash
   # Using npm script (recommended)
   pnpm dev
   
   # Or directly with Go
   go run ./cmd/server
   ```

8. **Verify the server is running**:
   ```bash
   curl http://localhost:8080/healthz
   ```

## Development

### Available Scripts

```bash
# Development
pnpm dev              # Run development server
go run ./cmd/server   # Alternative: run directly

# Building
pnpm build            # Build binary to bin/server
go build -o bin/server ./cmd/server

# Production
pnpm start            # Run production server
./bin/server          # Run compiled binary

# Code Quality
pnpm lint             # Run golangci-lint (if installed)
```

### Development Workflow

1. **Start dependencies**:
   ```bash
   # From project root
   docker-compose up -d postgres redis
   ```

2. **Start the server**:
   ```bash
   cd apps/go-backend
   pnpm dev
   ```

3. **Make changes** - The server will auto-reload if using a tool like `air` or `nodemon`

4. **Test endpoints** using curl, Postman, or your frontend

### Code Structure Guidelines

- **Handlers**: Keep handlers thin, delegate business logic to services
- **Models**: Define all database models in `internal/models/models.go`
- **Routes**: Define all routes in `internal/server/router.go`
- **Middleware**: Add reusable middleware in `internal/middlewares/`
- **Services**: Business logic goes in `internal/services/`

### Running Migrations

Migrations run automatically on startup if `AUTO_MIGRATE=true`. To run manually:

```bash
go run ./cmd/migrate
```

### Seeding Database

To seed the database with sample data:

1. Set `SEED_ON_STARTUP=true` in `.env`
2. Restart the server

Or run seeding manually (if a seed command exists):
```bash
# Check seed/seed.go for seeding functions
```

## Configuration

### Environment Variables

Create a `.env` file in `apps/go-backend/` directory:

```env
# Server Configuration
GO_PORT=:8080
GO_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/growman?sslmode=disable
# OR use Cloudflare Hyperdrive
# HYPERDRIVE_URL=postgresql://user:password@hostname:port/database?sslmode=require

# Authentication
JWT_SECRET=your-super-secret-jwt-key-change-in-production

# CORS
CORS_ORIGINS=http://localhost:3000,http://localhost:3001

# Redis (optional but recommended)
REDIS_URL=redis://localhost:6379

# Database Management
AUTO_MIGRATE=true
SEED_ON_STARTUP=false

# Payment Gateway (Razorpay)
RAZORPAY_KEY_ID=rzp_test_xxxxx
RAZORPAY_KEY_SECRET=your-razorpay-secret

# Email Service (SMTP)
SMTP_EMAIL=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
```

### Environment Variable Reference

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `GO_PORT` | No | Server port | `:8080` |
| `GO_ENV` | No | Environment (development/production) | `development` |
| `DATABASE_URL` | Yes* | PostgreSQL connection string | - |
| `HYPERDRIVE_URL` | Yes* | Cloudflare Hyperdrive connection | - |
| `JWT_SECRET` | Yes | JWT signing secret | `dev-secret-change-me` |
| `CORS_ORIGINS` | Yes | Allowed CORS origins (comma-separated) | `http://localhost:3000,http://localhost:3001` |
| `REDIS_URL` | No | Redis connection string | - |
| `AUTO_MIGRATE` | No | Run migrations on startup | `true` |
| `SEED_ON_STARTUP` | No | Seed database on startup | `false` |
| `RAZORPAY_KEY_ID` | Yes | Razorpay key ID | - |
| `RAZORPAY_KEY_SECRET` | Yes | Razorpay secret | - |
| `SMTP_EMAIL` | Yes | SMTP sender email | - |
| `SMTP_PASSWORD` | Yes | SMTP password/app password | - |
| `SMTP_HOST` | No | SMTP host | `smtp.gmail.com` |
| `SMTP_PORT` | No | SMTP port | `587` |

*Either `DATABASE_URL` or `HYPERDRIVE_URL` is required.

### Database Setup

#### Using Docker Compose (Recommended)

From project root:
```bash
docker-compose up -d postgres redis
```

#### Manual PostgreSQL Setup

1. **Create database**:
   ```sql
   CREATE DATABASE growman;
   ```

2. **Update DATABASE_URL** in `.env`:
   ```
   DATABASE_URL=postgresql://username:password@localhost:5432/growman?sslmode=disable
   ```

#### Redis Setup

Redis is optional but recommended for:
- Rate limiting
- Caching
- Session storage

**Using Docker**:
```bash
docker run -d -p 6379:6379 redis:7-alpine
```

**Or use Docker Compose** (from project root):
```bash
docker-compose up -d redis
```

## API Documentation

### Base URL

- **Development**: `http://localhost:8080`
- **Production**: Your deployed backend URL

### Authentication

Most endpoints require JWT authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

### Endpoints

#### Health Check

```
GET /healthz
```

Returns server health status.

**Response**:
```json
{
  "status": "ok"
}
```

#### Authentication

**Login**
```
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response**:
```json
{
  "token": "jwt-token-here",
  "user": {
    "id": 1,
    "name": "User Name",
    "email": "user@example.com"
  }
}
```

**Signup**
```
POST /api/v1/auth/signup
Content-Type: application/json

{
  "name": "User Name",
  "email": "user@example.com",
  "password": "password123",
  "phone": "+1234567890"
}
```

**Google OAuth Login**
```
POST /api/v1/auth/google
Content-Type: application/json

{
  "token": "google-id-token"
}
```

**Get Current User**
```
GET /api/v1/auth/me
Authorization: Bearer <token>
```

**Update Profile**
```
PUT /api/v1/auth/profile
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Updated Name",
  "phone": "+1234567890"
}
```

**Password Reset - Send OTP**
```
POST /api/v1/auth/forgot-password/send-otp
Content-Type: application/json

{
  "email": "user@example.com"
}
```

**Password Reset - Verify OTP**
```
POST /api/v1/auth/forgot-password/verify-otp
Content-Type: application/json

{
  "email": "user@example.com",
  "otp": "123456"
}
```

**Password Reset - Reset Password**
```
POST /api/v1/auth/forgot-password/reset
Content-Type: application/json

{
  "email": "user@example.com",
  "otp": "123456",
  "newPassword": "newpassword123"
}
```

#### Products

**List Products**
```
GET /api/v1/products?page=1&pageSize=20&category=slug&brand=slug&tag=tag
```

**Search Products**
```
GET /api/v1/products/search?q=query&page=1&pageSize=20
```

**Get Featured Products**
```
GET /api/v1/products/featured
```

**Get Product by Slug**
```
GET /api/v1/products/{slug}
```

**Get Related Products**
```
GET /api/v1/products/{slug}/related
```

**Create Product** (Authenticated)
```
POST /api/v1/products
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Product Name",
  "slug": "product-slug",
  "description": "Product description",
  "price": 99.99,
  "mrp": 149.99,
  "categoryId": 1,
  "stock": 100
}
```

**Update Product** (Authenticated)
```
PUT /api/v1/products/{slug}
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Updated Name",
  "price": 89.99
}
```

**Delete Product** (Authenticated)
```
DELETE /api/v1/products/{slug}
Authorization: Bearer <token>
```

#### Categories

**List Categories**
```
GET /api/v1/categories
```

**Get Category**
```
GET /api/v1/categories/{slug}
```

**Get Products by Category**
```
GET /api/v1/categories/{slug}/products?page=1&pageSize=20
```

**List Subcategories**
```
GET /api/v1/categories/{slug}/subcategories
```

**Get Products by Subcategory**
```
GET /api/v1/categories/{slug}/subcategories/{subSlug}/products?page=1&pageSize=20
```

#### Brands

**List Brands**
```
GET /api/v1/brands
```

#### Tags

**List Tags**
```
GET /api/v1/tags
```

#### Checkout

**Check User Exists**
```
GET /api/v1/auth/check-user?email=user@example.com
```

**Send Email OTP**
```
POST /api/v1/checkout/send-email-otp
Content-Type: application/json

{
  "email": "user@example.com"
}
```

**Verify Email OTP**
```
POST /api/v1/checkout/verify-email-otp
Content-Type: application/json

{
  "email": "user@example.com",
  "otp": "123456"
}
```

**Create Checkout Order**
```
POST /api/v1/checkout/create-order
Content-Type: application/json

{
  "email": "user@example.com",
  "name": "Customer Name",
  "phone": "+1234567890",
  "items": [
    {
      "productId": 1,
      "productSizeId": 2,
      "quantity": 2,
      "price": 99.99
    }
  ],
  "address": {
    "addressLine": "123 Main St",
    "city": "City",
    "state": "State",
    "pincode": "123456",
    "country": "India"
  }
}
```

#### Orders

**List Orders** (Authenticated)
```
GET /api/v1/orders
Authorization: Bearer <token>
```

**Get Order**
```
GET /api/v1/order?razorpayOrderId=order_xxxxx
```

#### Payments

**Create Razorpay Order** (Legacy)
```
POST /api/v1/razorpay/order
Content-Type: application/json

{
  "amount": 1999.99,
  "currency": "INR"
}
```

**Verify Payment**
```
POST /api/v1/razorpay/verify
Content-Type: application/json

{
  "razorpayOrderId": "order_xxxxx",
  "razorpayPaymentId": "pay_xxxxx",
  "razorpaySignature": "signature"
}
```

#### Webhooks

**Razorpay Webhook**
```
POST /webhooks/razorpay
Content-Type: application/json
X-Razorpay-Signature: signature

{
  "event": "payment.captured",
  "payload": { ... }
}
```

### Response Format

**Success Response**:
```json
{
  "data": { ... },
  "message": "Success message"
}
```

**Error Response**:
```json
{
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

**Paginated Response**:
```json
{
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 100,
    "totalPages": 5,
    "hasNext": true,
    "hasPrev": false
  }
}
```

## Database Schema

### Models

**User**
- `id`, `name`, `email`, `phone`, `passwordHash`
- `emailVerified`, `provider`, `role`
- `addressLine`, `city`, `state`, `pincode`, `country`
- `latitude`, `longitude`

**Category**
- `id`, `name`, `slug`, `description`
- Has many `Subcategories` and `Products`

**Subcategory**
- `id`, `name`, `slug`, `description`, `categoryId`
- Belongs to `Category`
- Has many `Products`

**Product**
- `id`, `name`, `slug`, `description`
- `price`, `mrp`, `currency`, `imageUrl`
- `status`, `featured`, `tags` (array), `stock`
- `categoryId`, `subcategoryId`, `brandId`
- Has many `ProductSize`, `Attribute`, `Review`

**ProductSize**
- `id`, `label`, `price`, `stock`, `productId`
- `images` (array)

**Order**
- `id`, `userId` (nullable), `razorpayOrderId`
- `paymentStatus`, `status`, `amount`, `currency`
- `customerName`, `customerEmail`, `customerPhone`
- `addressLine`, `city`, `state`, `pincode`
- Has many `OrderItem`

**OrderItem**
- `id`, `orderId`, `productId`, `productSizeId`
- `quantity`, `price`, `name`, `imageUrl`

See `internal/models/models.go` for complete schema definitions.

## Authentication

### JWT Token Flow

1. **User logs in** via `/api/v1/auth/login`
2. **Server returns JWT token** in response
3. **Client stores token** (localStorage/cookie)
4. **Client includes token** in `Authorization: Bearer <token>` header
5. **Server validates token** via `AuthMiddleware`

### Token Structure

JWT tokens contain:
- `userId`: User ID
- `email`: User email
- `exp`: Expiration time

### Password Hashing

Passwords are hashed using bcrypt before storage. Never store plain text passwords.

### OTP System

OTPs are used for:
- Email verification during checkout
- Password reset

OTPs are:
- 6-digit numeric codes
- Stored in Redis with expiration (typically 10 minutes)
- One-time use (deleted after verification)

## Deployment

### Docker Deployment

1. **Build Docker image**:
   ```bash
   docker build -t growman-backend -f apps/go-backend/Dockerfile .
   ```

2. **Run container**:
   ```bash
   docker run -d \
     -p 8080:8080 \
     -e DATABASE_URL=postgresql://... \
     -e JWT_SECRET=... \
     -e CORS_ORIGINS=... \
     growman-backend
   ```

### Docker Compose

From project root:
```bash
docker-compose up -d
```

This starts:
- PostgreSQL
- Redis
- Backend API

### Cloud Run (Google Cloud)

1. **Build and push image**:
   ```bash
   gcloud builds submit --tag gcr.io/PROJECT_ID/growman-backend
   ```

2. **Deploy**:
   ```bash
   gcloud run deploy growman-backend \
     --image gcr.io/PROJECT_ID/growman-backend \
     --platform managed \
     --region us-central1 \
     --set-env-vars DATABASE_URL=...,JWT_SECRET=...
   ```

### Environment-Specific Configuration

**Development**:
- Use local PostgreSQL and Redis
- Enable `AUTO_MIGRATE=true`
- Use `SEED_ON_STARTUP=true` for testing

**Production**:
- Use managed PostgreSQL (Cloud SQL, Neon, etc.)
- Use managed Redis (Cloud Memorystore, Upstash, etc.)
- Set strong `JWT_SECRET`
- Configure proper `CORS_ORIGINS`
- Disable `SEED_ON_STARTUP`
- Enable `AUTO_MIGRATE` only on first deployment

## Contributing

### Setting Up for Contribution

1. **Fork the repository**
2. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make your changes** following Go best practices

4. **Test your changes**:
   ```bash
   go test ./...
   go run ./cmd/server  # Test manually
   ```

5. **Commit your changes**:
   ```bash
   git commit -m "feat: add your feature description"
   ```

6. **Push and create Pull Request**

### Code Style Guidelines

- **Formatting**: Use `gofmt` or `goimports`
- **Naming**: Follow Go naming conventions
  - Exported: PascalCase
  - Unexported: camelCase
- **Error Handling**: Always handle errors, don't ignore them
- **Comments**: Document exported functions and types
- **Package Organization**: Keep related code together

### Adding New Features

1. **Define models** in `internal/models/models.go` if needed
2. **Create handlers** in `internal/handlers/`
3. **Add routes** in `internal/server/router.go`
4. **Add business logic** in `internal/services/` if complex
5. **Update documentation** in this README

### Common Tasks

**Adding a new endpoint**:
1. Create handler function in appropriate handler file
2. Add route in `internal/server/router.go`
3. Update API documentation in this README

**Adding a new model**:
1. Define struct in `internal/models/models.go`
2. Add to AutoMigrate in handler
3. Create seed data if needed

**Adding middleware**:
1. Create middleware function in `internal/middlewares/`
2. Apply in `internal/server/router.go`

## Troubleshooting

### Common Issues

**Database Connection Errors**:
- Verify PostgreSQL is running: `docker ps` or `pg_isready`
- Check `DATABASE_URL` format and credentials
- Ensure database exists: `psql -l`

**Redis Connection Errors**:
- Verify Redis is running: `redis-cli ping`
- Check `REDIS_URL` format
- Backend will continue without Redis (some features disabled)

**Migration Errors**:
- Check database connection
- Verify GORM models are correct
- Manually fix schema if needed

**CORS Errors**:
- Verify `CORS_ORIGINS` includes frontend URL
- Check frontend is using correct API URL
- Ensure credentials are allowed in CORS config

**JWT Token Errors**:
- Verify `JWT_SECRET` is set and consistent
- Check token expiration
- Ensure token is sent in `Authorization` header

**Rate Limiting Issues**:
- Check Redis connection (rate limiting requires Redis)
- Verify rate limit configuration in `router.go`
- Check Redis memory if many rate limit keys

### Debugging Tips

1. **Check logs** - Server logs all requests and errors
2. **Test endpoints** with curl or Postman
3. **Verify environment variables** are loaded:
   ```go
   // Add temporary logging in config.go
   log.Printf("Config: %+v", cfg)
   ```
4. **Check database** directly:
   ```bash
   psql $DATABASE_URL
   SELECT * FROM users;
   ```

### Performance Optimization

- **Enable Redis** for caching and rate limiting
- **Use database indexes** on frequently queried fields
- **Implement pagination** for list endpoints
- **Add database connection pooling** (GORM handles this)
- **Monitor slow queries** and optimize

### Getting Help

- Check existing issues in repository
- Review Go documentation
- Check GORM documentation for ORM issues
- Review Chi router documentation for routing issues

## Additional Resources

- [Go Documentation](https://go.dev/doc/)
- [Chi Router Documentation](https://github.com/go-chi/chi)
- [GORM Documentation](https://gorm.io/docs/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Redis Documentation](https://redis.io/documentation)
- [JWT Documentation](https://jwt.io/)

## License

ISC
