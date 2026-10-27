// Product and review photo uploads.
//
// The browser posts one image in a multipart form. The file must be a JPEG,
// PNG, GIF, or WebP, and it must be 10 MB or smaller. The stored name is a
// folder prefix plus a timestamp, and the response is that key plus the
// public image URL the shop can save on a product, size, or review.

import path from "node:path";
import multer from "multer";
import { json, error } from "../../pkg/httpjson/httpjson.js";

// The file is held in memory and rejected once it passes 10 MB.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// File extensions the shop accepts for a photo.
function allowedImageExt(ext) {
  switch (String(ext || "").toLowerCase()) {
    case ".jpg":
    case ".jpeg":
    case ".png":
    case ".gif":
    case ".webp":
      return true;
    default:
      return false;
  }
}

// MIME types the shop accepts. A charset suffix on the header is ignored.
function allowedImageMIME(contentType) {
  const base = String(contentType || "").toLowerCase().split(";")[0].trim();
  return base === "image/jpeg" || base === "image/png" || base === "image/gif" || base === "image/webp";
}

// When the browser's MIME type is missing or wrong, the extension picks JPEG or PNG.
function contentTypeFromExt(ext) {
  switch (String(ext || "").toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    default:
      return "image/jpeg";
  }
}

// The folder name on an upload. Slashes, dots, and backslashes are stripped.
// Anything other than letters, digits, dash, and underscore is dropped. An empty result becomes "uploads".
export function sanitizeUploadPrefix(prefix) {
  let out = String(prefix ?? "").replace(/^\/+|\/+$/g, "").toLowerCase();
  out = out.replaceAll("..", "").replaceAll("\\", "");
  let cleaned = "";
  for (const character of out) {
    if ((character >= "a" && character <= "z") || (character >= "0" && character <= "9") || character === "-" || character === "_") cleaned += character;
  }
  return cleaned || "uploads";
}

// The object key stored for this file: prefix, unix time, and a cleaned file name.
// A missing name gets a short random suffix. A missing extension is treated as JPEG.
export function generateImageKey(prefix, filename) {
  let keyPrefix = prefix || "uploads";
  let ext = path.extname(filename || "");
  if (!ext) ext = ".jpg";
  const timestamp = Math.floor(Date.now() / 1000);
  if (filename) {
    const baseName = path.basename(filename, path.extname(filename));
    let base = baseName.toLowerCase().replaceAll(" ", "-").replaceAll("_", "-");
    let sanitized = "";
    for (const character of base) {
      if ((character >= "a" && character <= "z") || (character >= "0" && character <= "9") || character === "-") sanitized += character;
    }
    return `${keyPrefix}/${timestamp}-${sanitized}${ext}`;
  }
  const random = Number(process.hrtime.bigint() % 1000000n);
  return `${keyPrefix}/${timestamp}-${random}${ext}`;
}

// Read the single form field named "image".
function parseUpload(req, res) {
  return new Promise((resolve, reject) => {
    upload.single("image")(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Store one uploaded photo and return its key and public image URL.
export async function uploadImage(req, res) {
  if (!this.imageService) {
    error(res, 500, "image service not configured");
    return;
  }

  try {
    await parseUpload(req, res);
  } catch {
    error(res, 400, "failed to parse multipart form");
    return;
  }
  // Multer may already have written the error response for a file that is too large.
  if (res.headersSent) return;

  const file = req.file;
  if (!file) {
    error(res, 400, "image file is required");
    return;
  }

  const prefix = sanitizeUploadPrefix(req.body?.prefix);
  const filename = file.originalname || "";
  let ext = path.extname(filename).toLowerCase();
  if (!ext) ext = ".jpg";
  if (!allowedImageExt(ext)) {
    error(res, 400, "unsupported image type");
    return;
  }

  const imageKey = generateImageKey(prefix, filename);
  let contentType = file.mimetype || "";
  if (!allowedImageMIME(contentType)) contentType = contentTypeFromExt(ext);
  if (!allowedImageMIME(contentType)) {
    error(res, 400, "unsupported image type");
    return;
  }

  try {
    await this.imageService.uploadImage(imageKey, file.buffer, contentType);
  } catch (err) {
    error(res, 500, `failed to upload image: ${err?.message || err}`);
    return;
  }

  json(res, 200, {
    imageKey,
    imageUrl: this.imageService.resolveImageURL(imageKey),
  });
}
