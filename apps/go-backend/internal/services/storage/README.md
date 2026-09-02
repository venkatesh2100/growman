# Storage Service

This package provides image upload/retrieval on top of Google Cloud Storage.

## Configuration

Set these environment variables:

- `GCS_BUCKET_NAME` (required) — the bucket images are uploaded to/served from.
- `IMAGE_BASE_URL` (required) — the public base URL prepended to an `imageKey` to
  build the URL returned to clients, e.g. `https://storage.googleapis.com/your-bucket`
  (or a CDN/custom domain fronting the bucket).
- `GCS_PROJECT_ID` (optional) — usually inferred from the credentials.
- `GCS_CREDENTIALS_JSON` (optional) — path to a service account key file. When unset,
  the client falls back to Application Default Credentials: `GOOGLE_APPLICATION_CREDENTIALS`,
  `gcloud auth application-default login`, or the metadata server when running on
  Cloud Run / GKE / Compute Engine.

## Bucket setup (one-time)

Images are served by building a public URL from the object's key — the app never
signs URLs — so the bucket must allow public reads:

1. Create the bucket with **uniform bucket-level access** enabled (the modern default).
2. Grant `roles/storage.objectViewer` to `allUsers` at the bucket level
   (Console → bucket → Permissions → Grant access), or:
   ```bash
   gcloud storage buckets add-iam-policy-binding gs://your-bucket \
     --member=allUsers --role=roles/storage.objectViewer
   ```
3. Grant the app's service account `roles/storage.objectAdmin` (or at least
   `objectCreator` + `objectViewer`) on the bucket so it can upload.

## Usage

`storage.NewImageServiceFromConfig(cfg)` builds an `*ImageService` wired to GCS from
the `Config` above. `ImageService.UploadImage` stores a file under an `imageKey` and
`ImageService.ResolveImageURL` turns that key into the public URL clients fetch.

## Development

Without `GCS_BUCKET_NAME`/`IMAGE_BASE_URL` set, `NewImageServiceFromConfig` returns an
error and the server disables uploads (logs a warning) rather than failing to start.
