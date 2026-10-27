// Google Cloud Storage for product, review, and plant photos.
// The image service calls upload, delete, and exists. A one-off rewrite calls optimizeExisting.
// upload stores the bytes under imageKey. delete and exists talk to that one object.
// optimizeExisting walks a prefix and returns counts of what it scanned, shrunk, and failed.

import { readFileSync } from "node:fs";
import { Storage } from "@google-cloud/storage";
import { immutableCacheControl, optimizeImage } from "./imageopt.js";

// bucketName is the GCS bucket. client is the Google Storage SDK client.
export class GCSStorage {
  constructor(bucketName, client) {
    this.bucketName = bucketName;
    this.client = client;
    this.bucket = client.bucket(bucketName);
  }

  // Writes one object. contentType is omitted when the caller did not send one.
  // A stream error is wrapped so the handler can show a storage failure instead of a socket error.
  async upload(imageKey, file, contentType) {
    const data = Buffer.isBuffer(file) ? file : Buffer.from(file || []);
    const gcsFile = this.bucket.file(imageKey);
    const metadata = { cacheControl: immutableCacheControl };
    if (contentType) metadata.contentType = contentType;
    await new Promise((resolve, reject) => {
      const ws = gcsFile.createWriteStream({ resumable: false, metadata });
      ws.on("error", (err) => reject(uploadError(err)));
      ws.on("finish", resolve);
      ws.end(data);
    });
  }

  // Deletes one object. A missing object still throws, with the GCS message attached.
  async delete(imageKey) {
    try {
      await this.bucket.file(imageKey).delete();
    } catch (err) {
      throw new Error(`failed to delete from GCS: ${err.message}`);
    }
  }

  // True when the object is there. A 404 is false, not an error. Any other failure is thrown.
  async exists(imageKey) {
    try {
      const [found] = await this.bucket.file(imageKey).exists();
      return Boolean(found);
    } catch (err) {
      if (err?.code === 404) return false;
      throw new Error(`failed to check existence: ${err.message}`);
    }
  }

  // Rewrites images under prefix. Large JPEG/PNG originals are replaced in
  // place (same key). dryRun writes nothing. logf receives one formatted line.
  // Returns the scan counts. A list failure throws. One bad file is counted and the walk continues.
  async optimizeExisting(prefix, dryRun, logf = console.log) {
    const res = { scanned: 0, optimized: 0, cacheFixed: 0, failed: 0, bytesBefore: 0, bytesAfter: 0 };
    let files;
    try {
      [files] = await this.bucket.getFiles({ prefix: prefix || "" });
    } catch (err) {
      throw new Error(`list objects: ${err.message}`);
    }
    for (const file of files) {
      let attrs;
      try {
        [attrs] = await file.getMetadata();
      } catch (err) {
        res.failed++;
        logf(`read ${file.name}: ${err.message}`);
        continue;
      }
      const ct = String(attrs.contentType || "").toLowerCase();
      // PDFs and other objects in the same prefix are not photos. Leave them alone and do not count them.
      if (!ct.startsWith("image/")) continue;
      const size = Number(attrs.size) || 0;
      res.scanned++;
      res.bytesBefore += size;
      const generation = generationOf(attrs);

      let optimized = null;
      if (ct === "image/jpeg" || ct === "image/png") {
        try {
          const [data] = await file.download();
          const [out, ok] = await optimizeImage(data, ct);
          if (ok) optimized = out;
        } catch (err) {
          res.failed++;
          logf(`read ${attrs.name}: ${err.message}`);
          res.bytesAfter += size;
          continue;
        }
      }

      if (optimized) {
        logf(`optimize ${attrs.name}: ${size >> 10} KB -> ${optimized.length >> 10} KB`);
        res.bytesAfter += optimized.length;
        // dryRun reports the saving and does not replace the object.
        if (dryRun) {
          res.optimized++;
          continue;
        }
        try {
          // ifGenerationMatch refuses the write when someone else replaced the object since we read it.
          await file.save(optimized, {
            resumable: false,
            metadata: {
              contentType: attrs.contentType,
              cacheControl: immutableCacheControl,
              metadata: attrs.metadata || undefined,
            },
            preconditionOpts: generation == null ? undefined : { ifGenerationMatch: generation },
          });
          res.optimized++;
        } catch (err) {
          res.failed++;
          logf(`write ${attrs.name}: ${err.message}`);
        }
        continue;
      }

      // The pixels were already fine. Still fix a short cache header so browsers keep the photo for a year.
      if (attrs.cacheControl !== immutableCacheControl) {
        res.bytesAfter += size;
        if (!dryRun) {
          try {
            await file.setMetadata(
              { cacheControl: immutableCacheControl },
              generation == null ? undefined : { ifGenerationMatch: generation },
            );
          } catch (err) {
            res.failed++;
            logf(`cache-control ${attrs.name}: ${err.message}`);
            continue;
          }
        }
        res.cacheFixed++;
        continue;
      }
      res.bytesAfter += size;
    }
    return res;
  }

  // The SDK has nothing to close. Kept so callers can treat every storage client the same.
  async close() {}
}

// Builds the bucket client. credentialsJSON is a path to a service-account key file, or empty to use the environment.
// Returns a GCSStorage. Throws when the bucket name is missing or the key file is not a service account.
export async function newGCSStorage(bucketName, projectID, credentialsJSON) {
  if (!bucketName) throw new Error("GCS bucket name is required");
  const opts = {};
  if (projectID) opts.projectId = projectID;
  if (credentialsJSON) {
    // Service-account key file only. Other credential types are rejected.
    try {
      const parsed = JSON.parse(readFileSync(credentialsJSON, "utf8"));
      if (parsed?.type !== "service_account") {
        throw new Error("credentials file is not a service account key");
      }
      opts.credentials = parsed;
    } catch (err) {
      throw new Error(`failed to create GCS client: ${err.message}`);
    }
  }
  try {
    return new GCSStorage(bucketName, new Storage(opts));
  } catch (err) {
    throw new Error(`failed to create GCS client: ${err.message}`);
  }
}

// A numeric error code means the write stream failed while closing. Anything else failed while copying the bytes.
function uploadError(err) {
  const msg = err?.message || String(err);
  if (typeof err?.code === "number") return new Error(`failed to close GCS writer: ${msg}`);
  return new Error(`failed to copy file to GCS: ${msg}`);
}

// The object's generation, used so a rewrite does not clobber a newer upload. Null when it is missing.
function generationOf(attrs) {
  if (attrs?.generation == null || attrs.generation === "") return null;
  const n = Number(attrs.generation);
  return Number.isSafeInteger(n) ? n : attrs.generation;
}
