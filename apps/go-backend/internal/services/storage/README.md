# Storage Service

This package provides storage-agnostic image handling for the backend.

## Dependencies

### Azure Blob Storage

To use Azure Blob Storage, add the following dependency:

```bash
go get github.com/Azure/azure-storage-blob-go/azblob
```

### Google Cloud Storage

To use Google Cloud Storage, add the following dependency:

```bash
go get cloud.google.com/go/storage
```

## Usage

The storage provider is automatically selected based on environment variables:

- **Azure**: Set `AZURE_STORAGE_ACCOUNT_NAME`, `AZURE_STORAGE_ACCOUNT_KEY`, and `AZURE_STORAGE_CONTAINER_NAME`
- **GCS**: Set `GCS_BUCKET_NAME` and optionally `GCS_PROJECT_ID`

The `IMAGE_BASE_URL` environment variable is required for both providers.

## Development

For development without cloud storage, you can:

1. Leave storage provider credentials unset (the service will log a warning)
2. Implement a local file storage provider for testing
3. Use a mock storage provider in tests

