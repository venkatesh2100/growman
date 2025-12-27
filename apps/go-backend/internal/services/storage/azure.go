package storage

import (
	"context"
	"fmt"
	"io"
	"net/url"

	"github.com/Azure/azure-storage-blob-go/azblob"
)

// AzureBlobStorage implements StorageProvider for Azure Blob Storage
type AzureBlobStorage struct {
	accountName   string
	accountKey    string
	containerName string
}

// NewAzureBlobStorage creates a new Azure Blob Storage provider
// accountName: Azure storage account name
// accountKey: Azure storage account key
// containerName: Container name where images will be stored
func NewAzureBlobStorage(accountName, accountKey, containerName string) (*AzureBlobStorage, error) {
	if accountName == "" || accountKey == "" || containerName == "" {
		return nil, fmt.Errorf("azure storage credentials are required")
	}

	return &AzureBlobStorage{
		accountName:   accountName,
		accountKey:    accountKey,
		containerName: containerName,
	}, nil
}

// getBlobURL returns the URL for a blob
func (a *AzureBlobStorage) getBlobURL(imageKey string) (azblob.BlockBlobURL, error) {
	credential, err := azblob.NewSharedKeyCredential(a.accountName, a.accountKey)
	if err != nil {
		return azblob.BlockBlobURL{}, err
	}

	p := azblob.NewPipeline(credential, azblob.PipelineOptions{})
	
	// Construct the account URL manually
	accountURLStr := fmt.Sprintf("https://%s.blob.core.windows.net", a.accountName)
	accountURL, err := url.Parse(accountURLStr)
	if err != nil {
		return azblob.BlockBlobURL{}, fmt.Errorf("failed to parse account URL: %w", err)
	}
	
	serviceURL := azblob.NewServiceURL(*accountURL, p)
	containerURL := serviceURL.NewContainerURL(a.containerName)
	blobURL := containerURL.NewBlockBlobURL(imageKey)

	return blobURL, nil
}

// Upload uploads a file to Azure Blob Storage
func (a *AzureBlobStorage) Upload(ctx context.Context, imageKey string, file io.Reader, contentType string) error {
	blobURL, err := a.getBlobURL(imageKey)
	if err != nil {
		return fmt.Errorf("failed to create blob URL: %w", err)
	}

	// Set content type if provided
	headers := azblob.BlobHTTPHeaders{}
	if contentType != "" {
		headers.ContentType = contentType
	}

	_, err = azblob.UploadStreamToBlockBlob(
		ctx,
		file,
		blobURL,
		azblob.UploadStreamToBlockBlobOptions{
			BlobHTTPHeaders: headers,
		},
	)

	if err != nil {
		return fmt.Errorf("failed to upload to Azure Blob Storage: %w", err)
	}

	return nil
}

// Delete deletes a file from Azure Blob Storage
func (a *AzureBlobStorage) Delete(ctx context.Context, imageKey string) error {
	blobURL, err := a.getBlobURL(imageKey)
	if err != nil {
		return fmt.Errorf("failed to create blob URL: %w", err)
	}

	_, err = blobURL.Delete(ctx, azblob.DeleteSnapshotsOptionNone, azblob.BlobAccessConditions{})
	if err != nil {
		return fmt.Errorf("failed to delete from Azure Blob Storage: %w", err)
	}

	return nil
}

// Exists checks if a file exists in Azure Blob Storage
func (a *AzureBlobStorage) Exists(ctx context.Context, imageKey string) (bool, error) {
	blobURL, err := a.getBlobURL(imageKey)
	if err != nil {
		return false, fmt.Errorf("failed to create blob URL: %w", err)
	}

	_, err = blobURL.GetProperties(ctx, azblob.BlobAccessConditions{}, azblob.ClientProvidedKeyOptions{})
	if err != nil {
		if serr, ok := err.(azblob.StorageError); ok {
			if serr.ServiceCode() == azblob.ServiceCodeBlobNotFound {
				return false, nil
			}
		}
		return false, fmt.Errorf("failed to check existence: %w", err)
	}

	return true, nil
}

