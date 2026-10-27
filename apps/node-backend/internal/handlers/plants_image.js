// This file prepares a customer's plant photo before it is sent for identification.
// It checks the real file type, rejects photos that are too big or in HEIC,
// and saves a smaller JPEG the scan can use.

import path from "node:path";
import sharp from "sharp";

// The longest side of a prepared photo, in pixels.
const plantPhotoMaxEdge = 1600;

// Looks at the first bytes of a file to see if it is JPEG, PNG, WebP, or HEIC.
// The filename the phone sent is not trusted.
function sniffImage(b) {
  if (!b || b.length < 3) return "";
  // JPEG files start with these three bytes.
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  // PNG files start with this eight-byte signature.
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) return "png";
  if (b.length >= 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") {
    return "webp";
  }
  // HEIC photos from some phones use these brand names inside the file.
  if (b.length >= 12 && b.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = b.subarray(8, 12).toString("ascii");
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "heic";
  }
  return "";
}

// True when a photo is wider, taller, or heavier in pixels than we will process.
async function tooLarge(b, kind) {
  if (kind !== "jpeg" && kind !== "png" && kind !== "webp") return false;
  try {
    const cfg = await sharp(b, { failOn: "none" }).metadata();
    const width = cfg.width || 0;
    const height = cfg.height || 0;
    if (width < 1 || height < 1) return false;
    return width > 8000 || height > 8000 || width * height > 24_000_000;
  } catch {
    return false;
  }
}

// Keeps the original file name and swaps in the new extension.
function withExt(name, ext) {
  const base = path.basename(String(name || ""), path.extname(String(name || "")));
  return `${base && base !== "." ? base : "plant"}${ext}`;
}

// Turns a JPEG, PNG, or WebP into a baseline JPEG no larger than 1600px.
// The bytes are what we trust, not the filename the browser sent.
export async function normalizePlantPhoto(photo) {
  const bytes = photo?.bytes;
  const kind = sniffImage(bytes);
  // Huge pixel counts are rejected before we spend time shrinking them.
  if (kind === "jpeg" || kind === "png" || kind === "webp") {
    if (await tooLarge(bytes, kind)) {
      throw new Error("That photo is too large. Crop it closer and try again.");
    }
  }
  // Phone HEIC photos need to be exported as JPEG first.
  if (kind === "heic") {
    throw new Error("This photo is HEIC. Export it as a JPEG, then scan it again.");
  }
  if (kind !== "jpeg" && kind !== "png" && kind !== "webp") {
    throw new Error("Use a JPEG, PNG, or WebP photo of one plant.");
  }
  try {
    // Shrink the long side to 1600 pixels and save a JPEG the identifier can read.
    const out = await sharp(bytes, { failOn: "none" })
      .resize({ width: plantPhotoMaxEdge, height: plantPhotoMaxEdge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return {
      filename: withExt(photo.filename, ".jpg"),
      contentType: "image/jpeg",
      bytes: out,
    };
  } catch {
    if (kind === "webp") throw new Error("That WebP photo could not be read.");
    throw new Error("That photo could not be read. Try a JPEG of the plant.");
  }
}
