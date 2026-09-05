# Images & Cloud Storage

## The "key vs URL" pattern

The database never stores full image URLs for products — only a storage
**key** (e.g. `products/1699999999-neem-plant.jpg`). The absolute URL is
computed on every read by prefixing `IMAGE_BASE_URL`. This means:
- Switching storage backends or CDN domains only requires changing one env
  var, not a data migration.
- Keys are portable/storage-agnostic (see the doc comment in
  `internal/handlers/images.go`: *"Returns the image_key that should be
  stored in the database"*).

This shows up as a consistent pair of fields on every model that has images
(`internal/models/models.go`):

| Model | Stored (DB) | Computed (not stored, `gorm:"-"`) |
|---|---|---|
| `Product` | `ImageKey` | `ImageURL` |
| `ProductSize` | `ImageKeys []string` | `Images []string` |
| `OrderItem` | `ImageKey` | `ImageURL` |

`internal/handlers/image_helpers.go` provides the resolution functions
(`ResolveProductImageURL(Slice)`, `ResolveOrderItemImageURL(Slice)`) called
by every handler right before a response is marshaled/cached. If
`h.ImageService` is `nil` (storage not configured), these are no-ops and the
URL fields stay empty — the rest of the API still works.

## Storage abstraction (`internal/services/storage/`)

```go
type StorageProvider interface {
    Upload(ctx, imageKey string, file io.Reader, contentType string) error
    Delete(ctx, imageKey string) error
    Exists(ctx, imageKey string) (bool, error)
}
```

`ImageService` (`storage.go`) wraps a `StorageProvider` + a base URL and
exposes `UploadImage`, `DeleteImage`, `ResolveImageURL`/`ResolveImageURLs`
(the URL-joining logic that trims a trailing `/` on the base and a leading
`/` on the key before joining with `/`).

Only one provider is implemented today: **Google Cloud Storage**
(`gcs.go`, `GCSStorage`), using `cloud.google.com/go/storage`. Despite the
interface being provider-agnostic, `factory.go`'s `NewStorageProvider`
explicitly errors "no storage provider configured" if `GCS_BUCKET_NAME`
isn't set — there's no branching to a different provider today.

### Construction (`factory.go`)

```
NewImageServiceFromConfig(cfg):
  requires IMAGE_BASE_URL (else: image service not initialized — uploads disabled)
  → NewStorageProvider(cfg):
      requires GCS_BUCKET_NAME
      → NewGCSStorage(bucket, projectID, credentialsJSON):
          credentialsJSON set → option.WithCredentialsFile(path)
          else                → Application Default Credentials
                                 (GOOGLE_APPLICATION_CREDENTIALS env var,
                                  gcloud user creds, or the GCP metadata
                                  server on Cloud Run/GKE/Compute Engine)
```

In `cmd/server/main.go`, a failure here is **not fatal** — it's logged
(`[IMAGE] init failed: ... (uploads disabled)`) and the server boots with
`imageService == nil`. The intent is that a developer without GCS
credentials configured can still run the rest of the API locally.

## Frontend delivery (avoid slow top→bottom paint)

Product/category cards used to set `unoptimized` on `next/image` for remote
storage URLs. That streamed full-resolution originals straight from Azure/GCS;
progressive JPEGs then painted top→bottom in the browser.

The web app now routes those URLs through Next/OpenNext image optimization
(`/_next/image` → Cloudflare Images on Workers) so the browser receives a
resized AVIF/WebP at the display size. See:

- `apps/web/next.config.ts` — `remotePatterns` + `formats`
- `apps/web/wrangler.jsonc` — `images.binding = "IMAGES"`
- `apps/web/components/ui/OptimizedImage.tsx` — fade-in after decode

`ResolveImageURL` still returns the canonical storage URL; resizing happens
at the edge, not in the Go backend.

## Upload endpoint (`internal/handlers/images.go`)

`POST /api/v1/images/upload` — **admin-only** (`appauth.AdminMiddleware`).

- `multipart/form-data`, field name `image`, max 10MB
  (`r.ParseMultipartForm(10 << 20)`).
- Optional `prefix` form field (sanitized: lowercased, `..`/`\` stripped,
  restricted to `[a-z0-9_-]`, defaults to `"uploads"`) — lets callers
  organize keys into folders like `products/`, `plants/`.
- Extension allow-list: `.jpg .jpeg .png .gif .webp`. Content-Type is
  cross-checked against an allow-list too (`allowedImageMIME`); if the
  client didn't send a recognized MIME type, it's inferred from the
  extension (`contentTypeFromExt`, defined in `plants.go` since it's shared
  with the plant-ID upload path).
- **`GenerateImageKey(prefix, filename)`** builds a human-readable key:
  sanitizes the original filename (lowercase, spaces/underscores → hyphens,
  strip non-`[a-z0-9-]` characters) and prefixes it with a Unix timestamp —
  `products/1699999999-neem-plant-12in.jpg` — rather than a random/opaque
  key, so keys stay debuggable in the GCS console.
- Response: `{"imageKey": "...", "imageUrl": "..."}` — the frontend stores
  `imageKey` on the product/size it's editing; `imageUrl` is returned
  purely for immediate preview.

## Other places images get uploaded

- **Plant identification** (`internal/handlers/plants.go`,
  `IdentifyPlant`) silently uploads submitted photos to `plants/` in the
  background — not client-triggered, not admin-only, just a side effect of
  calling the identify endpoint. See
  [06-chat-and-ai.md](./06-chat-and-ai.md).
- **`UploadImageFromReader`** (`images.go`) is a small in-process helper
  (not exposed as its own route) for uploading from an already-in-memory
  reader — used internally rather than via a dedicated HTTP endpoint.
