// Turns an uploaded plant photo into a stored object and a public URL.
// Product and review handlers call uploadImage, deleteImage, and the URL helpers.
// Large JPEG and PNG files are shrunk before they are stored. Other types are stored as uploaded.

import { optimizeImage } from "./imageopt.js";

// Only this much of an upload is buffered before optimization.
const maxUploadBytes = 40 << 20;

// provider is the bucket client. baseURL is the public host prefixed onto every image key.
export class ImageService {
  constructor(provider, baseURL) {
    this.provider = provider;
    this.baseURL = baseURL || "";
  }

  // Downsizes large JPEG/PNG originals, then uploads under imageKey.
  // Returns whatever the bucket upload returns. Throws when the file is over 40 MB.
  async uploadImage(imageKey, bufferOrStream, contentType) {
    const data = await readUpload(bufferOrStream);
    if (data.length > maxUploadBytes) {
      throw new Error(`image larger than ${maxUploadBytes >> 20} MB`);
    }
    let body = data;
    const [optimized, ok] = await optimizeImage(data, contentType);
    // A failed or skipped optimize keeps the original bytes. The log line is only for a real shrink.
    if (ok) {
      console.log(`[IMAGE] optimized ${imageKey}: ${data.length >> 10} KB -> ${optimized.length >> 10} KB`);
      body = optimized;
    }
    return this.provider.upload(imageKey, body, contentType);
  }

  // Removes one object. Called when a product photo is replaced or a review image is rejected.
  async deleteImage(imageKey) {
    return this.provider.delete(imageKey);
  }

  // Public URL for one key. A blank key is "". A trailing slash on the base and a leading slash on the key are dropped
  // so the URL has exactly one slash between host and path.
  resolveImageURL(imageKey) {
    if (!imageKey) return "";
    let base = this.baseURL;
    if (base.length > 0 && base[base.length - 1] === "/") base = base.slice(0, -1);
    let key = imageKey;
    if (key.length > 0 && key[0] === "/") key = key.slice(1);
    return `${base}/${key}`;
  }

  // Public URLs for a gallery. Blank keys are skipped so the app does not render an empty image.
  resolveImageURLs(imageKeys) {
    const urls = [];
    for (const key of imageKeys || []) {
      const url = this.resolveImageURL(key);
      if (url) urls.push(url);
    }
    return urls;
  }
}

// Factory used by the storage setup. Returns an ImageService.
export function newImageService(provider, baseURL) {
  return new ImageService(provider, baseURL);
}

// Reads a buffer, a byte array, or a stream, but never more than one byte past the size cap.
// The extra byte lets uploadImage tell "too big" from "exactly 40 MB". Throws "read image: ..." on a stream error.
async function readUpload(file) {
  const limit = maxUploadBytes + 1;
  try {
    if (file == null) return Buffer.alloc(0);
    if (Buffer.isBuffer(file)) return file.length > limit ? file.subarray(0, limit) : file;
    if (file instanceof Uint8Array) {
      const buf = Buffer.from(file);
      return buf.length > limit ? buf.subarray(0, limit) : buf;
    }
    if (typeof file[Symbol.asyncIterator] !== "function") {
      throw new Error("unsupported image payload");
    }
    const chunks = [];
    let total = 0;
    let truncated = false;
    for await (const chunk of file) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (total + buf.length > limit) {
        chunks.push(buf.subarray(0, limit - total));
        total = limit;
        truncated = true;
        break;
      }
      chunks.push(buf);
      total += buf.length;
    }
    // Stop the stream so a huge upload does not keep filling memory after we already decided it is too big.
    if (truncated && typeof file.destroy === "function") file.destroy();
    return Buffer.concat(chunks, total);
  } catch (err) {
    if (String(err.message || "").startsWith("image larger than")) throw err;
    if (String(err.message || "").startsWith("read image:")) throw err;
    throw new Error(`read image: ${err.message}`);
  }
}
