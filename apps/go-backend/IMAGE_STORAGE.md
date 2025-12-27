# Image Storage System

This document describes the storage-agnostic image handling system implemented in the backend.

## Overview

The image storage system is designed to be **storage-provider agnostic**, meaning you can switch between different cloud storage providers (Azure Blob Storage, Google Cloud Storage, etc.) by simply changing environment variables. **No database migration is required** when switching providers.

## Architecture

### Key Principles

1. **Database stores only `image_key`** (e.g., `"products/130239.jpg"`), never full URLs
2. **Full URLs are built at runtime** using `IMAGE_BASE_URL + "/" + image_key`
3. **Storage provider is determined by environment variables**
4. **URL resolution happens in handlers** before returning JSON responses

### Components

#### 1. Storage Interface (`internal/services/storage/storage.go`)

Defines the `StorageProvider` interface that all storage implementations must satisfy:

```go
type StorageProvider interface {
    Upload(ctx context.Context, imageKey string, file io.Reader, contentType string) error
    Delete(ctx context.Context, imageKey string) error
    Exists(ctx context.Context, imageKey string) (bool, error)
}
```

#### 2. Storage Implementations

- **Azure Blob Storage** (`internal/services/storage/azure.go`)
- **Google Cloud Storage** (`internal/services/storage/gcs.go`)

#### 3. Image Service (`internal/services/storage/storage.go`)

Provides high-level image operations:

- `UploadImage()` - Upload an image to cloud storage
- `ResolveImageURL()` - Build full URL from image_key
- `ResolveImageURLs()` - Build full URLs from multiple image_keys

#### 4. Database Models

Models store `image_key` instead of full URLs:

- `Product.ImageKey` - Main product image key
- `ProductSize.ImageKeys` - Array of image keys for product sizes
- `OrderItem.ImageKey` - Order item image key

The `ImageURL` field is computed at runtime (marked with `gorm:"-"` to exclude from DB).

## Configuration

### Environment Variables

#### Required

- `IMAGE_BASE_URL` - Base URL for image storage
  - Azure example: `https://youraccount.blob.core.windows.net/container`
  - GCS example: `https://storage.googleapis.com/your-bucket`

#### Azure Blob Storage (Optional)

- `AZURE_STORAGE_ACCOUNT_NAME` - Azure storage account name
- `AZURE_STORAGE_ACCOUNT_KEY` - Azure storage account key
- `AZURE_STORAGE_CONTAINER_NAME` - Container name

#### Google Cloud Storage (Optional)

- `GCS_BUCKET_NAME` - GCS bucket name
- `GCS_PROJECT_ID` - Google Cloud project ID
- `GCS_CREDENTIALS_JSON` - Path to service account JSON (optional, can use default credentials)

### Example `.env` for Azure

```env
IMAGE_BASE_URL=https://youraccount.blob.core.windows.net/images
AZURE_STORAGE_ACCOUNT_NAME=youraccount
AZURE_STORAGE_ACCOUNT_KEY=your-key-here
AZURE_STORAGE_CONTAINER_NAME=images
```

### Example `.env` for GCS

```env
IMAGE_BASE_URL=https://storage.googleapis.com/your-bucket
GCS_BUCKET_NAME=your-bucket
GCS_PROJECT_ID=your-project-id
```

## API Endpoints

### Upload Image

**POST** `/api/v1/images/upload`

Upload an image file and get back the `image_key` to store in the database.

**Request:**
- Content-Type: `multipart/form-data`
- Form fields:
  - `image` (file, required) - The image file to upload
  - `prefix` (string, optional) - Prefix for the image key (default: "uploads")
    - Examples: "products", "categories", "users"

**Response:**
```json
{
  "imageKey": "products/1703123456-123456.jpg",
  "imageUrl": "https://youraccount.blob.core.windows.net/images/products/1703123456-123456.jpg"
}
```

**Example using curl:**
```bash
curl -X POST http://localhost:8080/api/v1/images/upload \
  -F "image=@product-photo.jpg" \
  -F "prefix=products"
```

## Usage Examples

### Example 1: Product Insert Flow

#### Step 1: Upload Image

```bash
# Upload the product image
curl -X POST http://localhost:8080/api/v1/images/upload \
  -F "image=@product.jpg" \
  -F "prefix=products"

# Response:
# {
#   "imageKey": "products/1703123456-789012.jpg",
#   "imageUrl": "https://youraccount.blob.core.windows.net/images/products/1703123456-789012.jpg"
# }
```

#### Step 2: Create Product with image_key

```bash
curl -X POST http://localhost:8080/api/v1/products \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Monstera Deliciosa",
    "slug": "monstera-deliciosa",
    "description": "A beautiful houseplant",
    "price": 29.99,
    "currency": "INR",
    "imageKey": "products/1703123456-789012.jpg",
    "categoryId": 1,
    "stock": 10
  }'
```

**Important:** Store only the `imageKey` value (`"products/1703123456-789012.jpg"`) in the database, not the full URL.

#### Step 3: Fetch Product (URLs are automatically resolved)

```bash
curl http://localhost:8080/api/v1/products/monstera-deliciosa

# Response includes resolved imageUrl:
# {
#   "id": 1,
#   "name": "Monstera Deliciosa",
#   "imageKey": "products/1703123456-789012.jpg",
#   "imageUrl": "https://youraccount.blob.core.windows.net/images/products/1703123456-789012.jpg",
#   ...
# }
```

### Example 2: Product with Multiple Sizes and Images

```bash
# Upload images for different sizes
curl -X POST http://localhost:8080/api/v1/images/upload \
  -F "image=@small.jpg" \
  -F "prefix=products"
# Response: {"imageKey": "products/1703123456-111.jpg", ...}

curl -X POST http://localhost:8080/api/v1/images/upload \
  -F "image=@large.jpg" \
  -F "prefix=products"
# Response: {"imageKey": "products/1703123456-222.jpg", ...}

# Create product with sizes
curl -X POST http://localhost:8080/api/v1/products \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Snake Plant",
    "slug": "snake-plant",
    "price": 19.99,
    "imageKey": "products/1703123456-111.jpg",
    "sizes": [
      {
        "label": "Small",
        "price": 19.99,
        "stock": 5,
        "imageKeys": ["products/1703123456-111.jpg"]
      },
      {
        "label": "Large",
        "price": 39.99,
        "stock": 3,
        "imageKeys": ["products/1703123456-222.jpg"]
      }
    ]
  }'
```

### Example 3: Switching Storage Providers

To switch from Azure to GCS:

1. **Update environment variables:**
   ```env
   # Remove Azure variables
   # AZURE_STORAGE_ACCOUNT_NAME=...
   # AZURE_STORAGE_ACCOUNT_KEY=...
   # AZURE_STORAGE_CONTAINER_NAME=...

   # Add GCS variables
   IMAGE_BASE_URL=https://storage.googleapis.com/your-bucket
   GCS_BUCKET_NAME=your-bucket
   GCS_PROJECT_ID=your-project-id
   ```

2. **Restart the server** - No database changes needed!

3. **Existing image_keys continue to work** - The system will build URLs using the new `IMAGE_BASE_URL`

## Implementation Details

### Image Key Generation

Image keys are generated with the format: `{prefix}/{timestamp}-{random}.{ext}`

- `prefix`: Provided in upload request (default: "uploads")
- `timestamp`: Unix timestamp
- `random`: Random number for uniqueness
- `ext`: File extension (default: ".jpg")

Example: `products/1703123456-789012.jpg`

### URL Resolution

URLs are resolved in handlers before returning JSON:

```go
// In product handlers
h.ResolveProductImageURLs(&product)
// Sets product.ImageURL from product.ImageKey

// For slices
h.ResolveProductImageURLsSlice(products)
```

### Database Schema

The database stores:
- `products.image_key` (VARCHAR) - e.g., "products/130239.jpg"
- `product_sizes.image_keys` (TEXT[]) - Array of image keys
- `order_items.image_key` (VARCHAR) - Image key for order item

**Never store full URLs in the database.**

## Migration Guide

If you have existing products with `image_url` in the database:

1. **Extract image keys from existing URLs:**
   ```sql
   -- Example: Extract key from Azure URL
   UPDATE products 
   SET image_key = SUBSTRING(image_url FROM 'images/(.*)')
   WHERE image_url IS NOT NULL;
   ```

2. **Run database migration** to rename column:
   ```sql
   ALTER TABLE products RENAME COLUMN image_url TO image_key;
   ```

3. **Update `IMAGE_BASE_URL`** to match your storage provider

4. **Test** that URLs are resolved correctly

## Best Practices

1. **Always use the upload endpoint** to generate image keys - don't construct them manually
2. **Store only `imageKey`** in database requests, never full URLs
3. **Use appropriate prefixes** for organization (e.g., "products", "categories", "users")
4. **Validate image files** on the client side before uploading
5. **Handle upload errors gracefully** - the upload endpoint returns errors if storage fails

## Troubleshooting

### Image service not initialized

If you see "image service not configured" errors:
- Check that `IMAGE_BASE_URL` is set in environment variables
- Verify storage provider credentials are correct
- Check server logs for initialization errors

### Images not displaying

- Verify `IMAGE_BASE_URL` matches your storage provider's base URL format
- Check that image keys in database are correct (should not include base URL)
- Ensure storage provider credentials have read permissions

### Switching providers

- Ensure new provider credentials are set
- Update `IMAGE_BASE_URL` to match new provider
- Restart server - no database changes needed
- Existing image_keys will work with new provider

