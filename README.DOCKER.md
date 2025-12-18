# Docker/Podman Setup for Growman

This project is containerized using Docker/Podman. The setup includes:
- PostgreSQL database
- Redis cache
- Go backend API
- Next.js frontend

## Prerequisites

- Docker or Podman installed
- Docker Compose or Podman Compose

## Quick Start

### Using Docker Compose

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down

# Stop and remove volumes (clean slate)
docker-compose down -v
```

### Using Podman Compose

```bash
# Build and start all services
podman-compose up -d

# View logs
podman-compose logs -f

# Stop all services
podman-compose down

# Stop and remove volumes (clean slate)
podman-compose down -v
```

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Database
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=growman

# Backend
GO_PORT=:8080
GO_ENV=production
JWT_SECRET=your-secret-key-here
CORS_ORIGINS=http://localhost:3001,http://localhost:3000
AUTO_MIGRATE=true
SEED_ON_STARTUP=false

# Redis
REDIS_URL=redis://redis:6379

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:8080/api/v1
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
NEXT_PUBLIC_RAZORPAY_KEY_ID=
```

## Services

- **PostgreSQL**: Available on port `5432`
- **Redis**: Available on port `6379`
- **Backend API**: Available on port `8080`
- **Frontend**: Available on port `3001`

## Building Individual Services

### Backend

```bash
cd apps/go-backend
docker build -t growman-backend .
# or
podman build -t growman-backend .
```

### Frontend

```bash
cd apps/web
docker build -t growman-frontend .
# or
podman build -t growman-frontend .
```

## Development

For development, you can run services individually:

```bash
# Start only database and redis
docker-compose up -d postgres redis

# Run backend locally
cd apps/go-backend
go run ./cmd/server

# Run frontend locally
cd apps/web
pnpm dev
```

## Production

For production deployment, ensure:
1. Strong `JWT_SECRET` is set
2. `SEED_ON_STARTUP=false` (unless you want to seed on every restart)
3. `AUTO_MIGRATE=false` (run migrations manually)
4. Proper database credentials
5. SSL/TLS for database connections if needed

## Troubleshooting

### Database connection issues
- Ensure PostgreSQL container is healthy: `docker-compose ps`
- Check database logs: `docker-compose logs postgres`
- Verify connection string in backend environment variables

### Frontend can't reach backend
- Check `NEXT_PUBLIC_API_URL` is set correctly
- Ensure backend container is running: `docker-compose ps`
- Check backend logs: `docker-compose logs backend`

### Port conflicts
- Change ports in `docker-compose.yml` if needed
- Update `CORS_ORIGINS` to match your frontend URL

