# Build stage
FROM node:20-alpine AS deps

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@10.19.0

# Copy workspace root files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages

# Copy web app package files and .npmrc to prevent hoisting
COPY apps/web/package.json ./apps/web/
COPY apps/web/.npmrc* ./apps/web/

# Install dependencies
# Use --shamefully-hoist=false to ensure Next.js is installed locally
# This prevents hoisting which causes Turbopack issues
WORKDIR /app/apps/web
RUN pnpm install --frozen-lockfile --shamefully-hoist=false

# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@10.19.0

# Copy workspace root files
COPY pnpm-workspace.yaml package.json ./
COPY packages ./packages

# Copy node_modules from deps stage - ensure Next.js is accessible
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages ./packages

# Copy web app source code
COPY apps/web ./apps/web

# Build the application
WORKDIR /app/apps/web
# Set NODE_ENV for build
ENV NODE_ENV=production

# Verify Next.js is installed locally (not hoisted)
# With shamefully-hoist=false, Next.js should be in ./node_modules/next
RUN if [ ! -f "./node_modules/next/package.json" ]; then \
      echo "ERROR: Next.js not found in local node_modules!" && \
      echo "Checking locations:" && \
      ls -la ./node_modules/ 2>/dev/null | head -10 && \
      ls -la /app/node_modules/ 2>/dev/null | grep next | head -5 && \
      echo "Reinstalling with local install..." && \
      pnpm install next react react-dom --save --shamefully-hoist=false && \
      test -f "./node_modules/next/package.json" || (echo "Failed to install Next.js locally" && exit 1); \
    else \
      echo "✓ Next.js found in local node_modules"; \
    fi

# Build - Turbopack should now be able to find Next.js
RUN pnpm next build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy necessary files from builder
COPY --from=builder /app/apps/web/package.json ./
COPY --from=builder /app/apps/web/next.config.ts* ./
COPY --from=builder /app/apps/web/public ./public
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./.next/static

# Expose port
EXPOSE 3001

ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

# Run the server
CMD ["node", "server.js"]

