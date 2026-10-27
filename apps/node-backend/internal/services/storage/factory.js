// Builds the image store from config. Google Cloud Storage is the only backend.
// The API server and the migrate command call newImageServiceFromConfig.
// Throws when the bucket or the public image base URL is missing.

import { newImageService } from "./storage.js";
import { newGCSStorage } from "./gcs.js";

// Google Cloud Storage is the only supported provider.
// Returns a GCS client. Called by newImageServiceFromConfig.
export async function newStorageProvider(cfg) {
  if (!cfg?.gcsBucketName) {
    throw new Error("no storage provider configured: set GCS_BUCKET_NAME");
  }
  return newGCSStorage(cfg.gcsBucketName, cfg.gcsProjectID, cfg.gcsCredentialsJSON);
}

// Returns the image helper handlers use to upload, delete, and build public URLs.
// IMAGE_BASE_URL is required because product photos are served from that host, not from a signed URL.
export async function newImageServiceFromConfig(cfg) {
  if (!cfg?.imageBaseURL) {
    throw new Error("IMAGE_BASE_URL is required");
  }
  const provider = await newStorageProvider(cfg);
  return newImageService(provider, cfg.imageBaseURL);
}
