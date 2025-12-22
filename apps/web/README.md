# Growman Frontend (Web Application)

A modern e-commerce web application built with Next.js 16, React 19, and TypeScript. This is the frontend application for the Growman plant e-commerce platform.

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Development](#development)
- [Configuration](#configuration)
- [Features](#features)
- [State Management](#state-management)
- [API Integration](#api-integration)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [Troubleshooting](#troubleshooting)

## Overview

The Growman frontend is a full-featured e-commerce application that provides:

- Product browsing and search
- Category and subcategory navigation
- Shopping cart functionality
- User authentication (email/password and Google OAuth)
- Checkout and payment processing (Razorpay)
- Order management
- Progressive Web App (PWA) support
- Responsive design for all devices

## Tech Stack

### Core Technologies
- **Next.js 16** - React framework with App Router
- **React 19** - UI library
- **TypeScript** - Type-safe JavaScript
- **Tailwind CSS 4** - Utility-first CSS framework

### State Management
- **Zustand** - Lightweight state management
  - `authStore` - Authentication state
  - `cartStore` - Shopping cart state

### UI Libraries
- **Framer Motion** - Animation library
- **Lucide React** - Icon library
- **React Icons** - Additional icons
- **Sonner** - Toast notifications
- **Lottie React** - Animation support

### Authentication
- **@react-oauth/google** - Google OAuth integration

### Deployment
- **@opennextjs/cloudflare** - Cloudflare Pages/Workers adapter
- **Wrangler** - Cloudflare CLI tool

## Project Structure

```
apps/web/
├── app/                          # Next.js App Router pages
│   ├── account/                  # User account page
│   ├── cart/                     # Shopping cart page
│   ├── categories/               # Category pages
│   │   └── [categorySlug]/      # Dynamic category routes
│   │       └── [subcategorySlug]/
│   ├── checkout/                 # Checkout flow
│   ├── forgot-password/          # Password reset
│   ├── login/                    # Login page
│   ├── orders/                   # Order history
│   ├── order-success/            # Order confirmation
│   ├── product/                  # Product pages
│   │   ├── [slug]/               # Individual product pages
│   │   └── add/                  # Add product (admin)
│   ├── shop/                     # Shop homepage
│   ├── signup/                   # Registration page
│   ├── layout.tsx                # Root layout
│   ├── page.tsx                  # Homepage
│   └── globals.css               # Global styles
│
├── components/                   # React components
│   ├── hompage/                  # Homepage components
│   │   ├── benifitsSection.tsx
│   │   ├── footer.tsx
│   │   ├── homeHero.tsx
│   │   ├── navbar.tsx
│   │   ├── newsLetter.tsx
│   │   └── plantSection.tsx
│   ├── loading/                  # Loading components
│   │   └── SkeletonLoader.tsx
│   ├── productspage/             # Product listing components
│   │   ├── categoryCard.tsx
│   │   ├── FilterSideBar.tsx
│   │   ├── ProductCard.tsx
│   │   ├── ProductsDisplay.tsx
│   │   └── SubcategoryCard.tsx
│   └── pwa/                      # PWA components
│       ├── InstallPrompt.tsx
│       └── ServiceWorkerRegistration.tsx
│
├── lib/                          # Utility libraries
│   ├── api.ts                    # API client functions
│   ├── data/                     # Static data
│   │   └── indianStatesCities.ts
│   ├── store/                    # Zustand stores
│   │   ├── authStore.ts          # Authentication store
│   │   └── cartStore.ts          # Cart store
│   ├── toast.tsx                 # Toast notification component
│   ├── types.ts                  # TypeScript type definitions
│   └── utils/                    # Utility functions
│
├── public/                       # Static assets
│   ├── icons/                    # PWA icons
│   ├── manifest.json             # PWA manifest
│   └── sw.js                     # Service worker
│
├── next.config.ts                # Next.js configuration
├── open-next.config.ts           # OpenNext Cloudflare config
├── wrangler.toml                 # Cloudflare Workers config
├── tsconfig.json                 # TypeScript configuration
└── package.json                  # Dependencies and scripts
```

## Getting Started

### Prerequisites

- **Node.js** 18 or higher
- **pnpm** 10.19.0 (package manager)
- **Backend API** running (see backend README)

### Installation

1. **Clone the repository** (if not already done):
   ```bash
   git clone <repository-url>
   cd growman
   ```

2. **Install dependencies**:
   ```bash
   # From root directory
   pnpm install
   
   # Or from apps/web directory
   cd apps/web
   pnpm install
   ```

3. **Set up environment variables**:
   ```bash
   cp example.env .env.local
   ```

4. **Configure environment variables** (see [Configuration](#configuration) section)

5. **Start the development server**:
   ```bash
   # From root (recommended - runs all apps)
   pnpm dev
   
   # Or from apps/web directory
   cd apps/web
   pnpm dev
   ```

6. **Open your browser**:
   Navigate to [http://localhost:3001](http://localhost:3001)

## Development

### Available Scripts

```bash
# Development
pnpm dev              # Start development server on port 3001

# Building
pnpm build            # Build for production
pnpm build:docker     # Build for Docker deployment

# Production
pnpm start            # Start production server

# Cloudflare Deployment
pnpm preview          # Preview Cloudflare build locally
pnpm deploy           # Deploy to Cloudflare Pages/Workers
pnpm cf-typegen       # Generate Cloudflare types

# Code Quality
pnpm lint             # Run ESLint
pnpm check-types      # Type check with TypeScript
```

### Development Workflow

1. **Start the backend** (see backend README):
   ```bash
   cd apps/go-backend
   pnpm dev
   ```

2. **Start the frontend**:
   ```bash
   cd apps/web
   pnpm dev
   ```

3. **Make changes** - The app will hot-reload automatically

4. **Check for errors**:
   ```bash
   pnpm lint
   pnpm check-types
   ```

### Code Structure Guidelines

- **Pages**: Use Next.js App Router conventions in `app/` directory
- **Components**: Place reusable components in `components/` directory
- **API Calls**: Use functions from `lib/api.ts` for all backend communication
- **State**: Use Zustand stores in `lib/store/` for global state
- **Types**: Define TypeScript types in `lib/types.ts`
- **Styles**: Use Tailwind CSS classes (avoid inline styles)

## Configuration

### Environment Variables

Create a `.env.local` file in `apps/web/` directory:

```env
# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:8080/api/v1
# For production, use your deployed backend URL
# NEXT_PUBLIC_API_URL=https://your-backend.com/api/v1

# Google OAuth
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com

# Razorpay Payment Gateway
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxxxx
RAZORPAY_KEY_ID=rzp_test_xxxxx
RAZORPAY_KEY_SECRET=your-razorpay-secret
```

### Environment Variable Reference

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | Yes | Backend API base URL | `http://localhost:8080/api/v1` |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID | - |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | Yes | Razorpay public key | - |
| `RAZORPAY_KEY_ID` | Yes* | Razorpay key ID (server-side) | - |
| `RAZORPAY_KEY_SECRET` | Yes* | Razorpay secret (server-side) | - |

*Required only for server-side payment operations

### Next.js Configuration

Key configurations in `next.config.ts`:

- **Image Domains**: Configured remote image patterns for product images
- **Output**: Standalone mode for Docker deployment
- **Service Worker**: Headers configured for PWA support

## Features

### Authentication

- **Email/Password Login**: Traditional authentication
- **Google OAuth**: Social login integration
- **Password Reset**: OTP-based password recovery
- **Session Management**: JWT token-based authentication

**Implementation**:
- Auth state managed via `authStore` (Zustand)
- Tokens stored in localStorage with Zustand persistence
- Automatic token injection in API requests

### Shopping Cart

- **Add/Remove Items**: Full cart management
- **Quantity Updates**: Adjust item quantities
- **Persistent Storage**: Cart persists across sessions
- **Multiple Sizes**: Support for product size variants

**Implementation**:
- Cart state managed via `cartStore` (Zustand)
- Items stored with unique IDs (productId + productSizeId)
- Automatic price calculations

### Product Browsing

- **Product Listings**: Paginated product displays
- **Search**: Real-time product search
- **Categories**: Hierarchical category navigation
- **Filters**: Category, brand, and tag filtering
- **Product Details**: Comprehensive product pages with:
  - Multiple images
  - Size variants
  - Specifications
  - Reviews
  - Related products

### Checkout Flow

1. **Cart Review**: Review items and quantities
2. **Email Verification**: OTP-based email verification
3. **Address Collection**: Shipping address form
4. **Payment**: Razorpay payment integration
5. **Order Confirmation**: Success page with order details

### Progressive Web App (PWA)

- **Install Prompt**: Browser install prompts
- **Service Worker**: Offline support
- **Manifest**: App metadata and icons
- **Offline Caching**: Asset caching strategy

## State Management

### Auth Store (`lib/store/authStore.ts`)

Manages authentication state:

```typescript
import { useAuthStore } from '@/lib/store/authStore';

// In component
const { token, isAuthenticated, setToken, clearAuth } = useAuthStore();

// Login
setToken('jwt-token-here');

// Logout
clearAuth();
```

**State**:
- `token`: JWT token string or null
- `isAuthenticated`: Boolean derived from token

**Methods**:
- `setToken(token)`: Set authentication token
- `clearAuth()`: Clear authentication
- `checkAuth()`: Sync with localStorage

### Cart Store (`lib/store/cartStore.ts`)

Manages shopping cart state:

```typescript
import { useCartStore } from '@/lib/store/cartStore';

// In component
const { 
  items, 
  addItem, 
  removeItem, 
  updateQuantity, 
  clearCart,
  getTotalPrice 
} = useCartStore();

// Add item
addItem({
  productId: 1,
  name: 'Product Name',
  price: 99.99,
  quantity: 1,
  image: '/product.jpg'
});
```

**State**:
- `items`: Array of cart items

**Methods**:
- `addItem(item)`: Add or update cart item
- `removeItem(id)`: Remove item by ID
- `updateQuantity(id, quantity)`: Update item quantity
- `clearCart()`: Empty cart
- `getTotalQuantity()`: Get total items count
- `getTotalPrice()`: Get total cart value

## API Integration

### API Client (`lib/api.ts`)

All API calls use the `apiFetch` function which:

- Automatically includes JWT token from auth store
- Handles CORS configuration
- Provides error logging
- Supports both client and server-side calls

### Example API Usage

```typescript
import { apiFetch } from '@/lib/api';

// GET request
const response = await apiFetch('/products');
const products = await response.json();

// POST request
const response = await apiFetch('/checkout/create-order', {
  method: 'POST',
  body: JSON.stringify(orderData)
});
```

### Available API Functions

- `searchProducts(query, page, pageSize)`: Search products
- `apiFetch(path, options)`: Generic API fetch wrapper

**Note**: Most API calls are made directly using `apiFetch` in components. See backend README for available endpoints.

## Deployment

### Cloudflare Pages/Workers

The app is configured for Cloudflare deployment using OpenNext:

1. **Build the application**:
   ```bash
   pnpm build
   ```

2. **Preview locally**:
   ```bash
   pnpm preview
   ```

3. **Deploy**:
   ```bash
   pnpm deploy
   ```

4. **Set environment variables** in Cloudflare Pages dashboard:
   - `NEXT_PUBLIC_API_URL`
   - `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
   - `NEXT_PUBLIC_RAZORPAY_KEY_ID`

### Docker Deployment

1. **Build Docker image**:
   ```bash
   docker build -t growman-web -f apps/web/Dockerfile .
   ```

2. **Run container**:
   ```bash
   docker run -p 3001:3001 \
     -e NEXT_PUBLIC_API_URL=http://backend:8080/api/v1 \
     growman-web
   ```

### Vercel Deployment

1. **Connect repository** to Vercel
2. **Set environment variables** in Vercel dashboard
3. **Deploy** - Vercel will auto-detect Next.js

## Contributing

### Setting Up for Contribution

1. **Fork the repository**
2. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make your changes** following the code structure guidelines

4. **Test your changes**:
   ```bash
   pnpm lint
   pnpm check-types
   pnpm dev  # Test locally
   ```

5. **Commit your changes**:
   ```bash
   git commit -m "feat: add your feature description"
   ```

6. **Push and create Pull Request**

### Code Style Guidelines

- **TypeScript**: Use TypeScript for all new code
- **Components**: Use functional components with hooks
- **Naming**: 
  - Components: PascalCase (e.g., `ProductCard.tsx`)
  - Functions: camelCase (e.g., `getTotalPrice`)
  - Files: camelCase for utilities, PascalCase for components
- **Imports**: Use absolute imports with `@/` alias
- **Formatting**: Code is auto-formatted with Prettier

### Adding New Features

1. **Create component** in appropriate directory
2. **Add types** to `lib/types.ts` if needed
3. **Update API client** in `lib/api.ts` if new endpoints
4. **Update store** if global state needed
5. **Add tests** (if test suite exists)
6. **Update documentation**

### Common Tasks

**Adding a new page**:
1. Create directory in `app/` with `page.tsx`
2. Add route to navigation if needed
3. Update types if new data structures

**Adding a new API endpoint**:
1. Add function to `lib/api.ts`
2. Use in components via `apiFetch` or new function
3. Update types in `lib/types.ts`

**Adding a new store**:
1. Create file in `lib/store/`
2. Use Zustand with persistence if needed
3. Export store hook

## Troubleshooting

### Common Issues

**CORS Errors**:
- Ensure `NEXT_PUBLIC_API_URL` is set correctly
- Check backend CORS configuration includes your frontend URL
- Verify environment variables are loaded (check browser console)

**Authentication Not Working**:
- Check token is being stored in localStorage
- Verify `NEXT_PUBLIC_API_URL` points to correct backend
- Check backend JWT_SECRET matches

**Build Errors**:
- Clear `.next` directory: `rm -rf .next`
- Reinstall dependencies: `rm -rf node_modules && pnpm install`
- Check TypeScript errors: `pnpm check-types`

**Port Already in Use**:
- Change port in `package.json` dev script
- Or kill process using port 3001

**API Calls Failing**:
- Verify backend is running
- Check API URL in browser network tab
- Verify CORS headers in response

### Debugging Tips

1. **Check browser console** for errors
2. **Use React DevTools** for component debugging
3. **Check Network tab** for API request/response details
4. **Verify environment variables** are loaded:
   ```typescript
   console.log(process.env.NEXT_PUBLIC_API_URL);
   ```

### Getting Help

- Check existing issues in repository
- Review backend README for API documentation
- Check Next.js documentation for framework-specific issues

## Additional Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [React Documentation](https://react.dev)
- [TypeScript Documentation](https://www.typescriptlang.org/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Zustand Documentation](https://zustand-demo.pmnd.rs)

## License

ISC
