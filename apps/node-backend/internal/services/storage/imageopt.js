// Shrinks product and review photos before they are stored.
// ImageService.uploadImage and the bucket rewrite call optimizeImage.
// Returns [bytes, true] when the file was rewritten, or [original, false] when it should be stored as-is.
// A decode failure is not an error. The original bytes are kept so a bad photo does not block the upload.

import sharp from "sharp";

// Longest side kept for stored images. Gallery at 2x still fits.
export const maxImageEdge = 1600;
// Files at or under this size and edge are stored untouched.
const optimizeMinBytes = 350 << 10;
const jpegQuality = 82;
// Refuse to decode anything bigger (~50 MP). Decompression-bomb guard.
const maxDecodePixels = 50_000_000;

// Image keys are unique per upload, so a year-long immutable cache is safe.
export const immutableCacheControl = "public, max-age=31536000, immutable";

// Returns [bytes, optimized]. Bytes are the original buffer when optimized is false.
// Only JPEG and PNG are considered. A small, upright image under the byte cap is left alone.
export async function optimizeImage(data, contentType) {
  const input = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
  const ct = String(contentType ?? "")
    .toLowerCase()
    .trim()
    .split(";")[0]
    .trim();
  if (ct !== "image/jpeg" && ct !== "image/png") return [input, false];

  let meta;
  try {
    meta = await sharp(input, { failOn: "none", limitInputPixels: false }).metadata();
  } catch {
    return [input, false];
  }
  const width = meta.width || 0;
  const height = meta.height || 0;
  const format = meta.format;
  // Zero size, a huge pixel count, or a file whose bytes are not really JPEG/PNG: keep the original.
  if (width <= 0 || height <= 0 || width * height > maxDecodePixels) return [input, false];
  if (format !== "jpeg" && format !== "png") return [input, false];

  let orientation = 1;
  if (format === "jpeg") orientation = jpegOrientation(input);
  // Already small, already upright, already under the size cap: nothing to gain.
  if (Math.max(width, height) <= maxImageEdge && input.length <= optimizeMinBytes && orientation === 1) {
    return [input, false];
  }

  try {
    const [fitW, fitH] = fitEdge(width, height, maxImageEdge);
    let pipeline = sharp(input, { failOn: "none", limitInputPixels: maxDecodePixels });
    if (fitW !== width || fitH !== height) {
      pipeline = pipeline.resize(fitW, fitH, { fit: "fill", kernel: "cubic" });
    }
    // Lossless intermediate so orientation is applied once, then encoded once.
    let pixels = await pipeline.png({ compressionLevel: 0 }).toBuffer();
    if (orientation >= 2 && orientation <= 8) pixels = await applyOrientation(pixels, orientation);

    const out =
      format === "png"
        ? await sharp(pixels, { failOn: "none" }).png({ compressionLevel: 9 }).toBuffer()
        : await sharp(pixels, { failOn: "none" })
            .jpeg({ quality: jpegQuality, mozjpeg: false, chromaSubsampling: "4:2:0" })
            .toBuffer();
    // A rotated result is kept even when it is not smaller, otherwise the
    // photo stays sideways once the EXIF tag is gone.
    if (out.length >= input.length && orientation === 1) return [input, false];
    return [out, true];
  } catch {
    return [input, false];
  }
}

// Width and height that fit inside maxEdge without stretching. The long side becomes maxEdge.
function fitEdge(w, h, maxEdge) {
  if (Math.max(w, h) <= maxEdge) return [w, h];
  if (w >= h) return [maxEdge, Math.max(1, Math.floor((h * maxEdge) / w))];
  return [Math.max(1, Math.floor((w * maxEdge) / h)), maxEdge];
}

// Bakes EXIF orientation 2–8 into pixels. 90° turns are lossless.
// Called only for a JPEG that was not already upright. Returns the turned pixels.
async function applyOrientation(buf, orientation) {
  const step = (input, build) => build(sharp(input, { failOn: "none" })).png({ compressionLevel: 0 }).toBuffer();
  switch (orientation) {
    case 2:
      return step(buf, (img) => img.flop());
    case 3:
      return step(buf, (img) => img.rotate(180));
    case 4:
      return step(buf, (img) => img.flip());
    case 5:
      return step(await step(buf, (img) => img.rotate(90)), (img) => img.flop());
    case 6:
      return step(buf, (img) => img.rotate(90));
    case 7:
      return step(await step(buf, (img) => img.rotate(270)), (img) => img.flop());
    case 8:
      return step(buf, (img) => img.rotate(270));
    default:
      return buf;
  }
}

// EXIF orientation tag, 1 when absent or unreadable.
// Walks JPEG markers until the EXIF APP1 segment or the start of the image data.
function jpegOrientation(data) {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 <= data.length) {
    if (data[i] !== 0xff) return 1;
    const marker = data[i + 1];
    // Start of scan or end of image. Orientation will not appear after this.
    if (marker === 0xda || marker === 0xd9) return 1;
    const segLen = data.readUInt16BE(i + 2);
    if (segLen < 2 || i + 2 + segLen > data.length) return 1;
    const seg = data.subarray(i + 4, i + 2 + segLen);
    if (marker === 0xe1 && seg.length > 14 && seg.subarray(0, 6).toString("latin1") === "Exif\x00\x00") {
      return exifOrientation(seg.subarray(6));
    }
    i += 2 + segLen;
  }
  return 1;
}

// Reads the orientation tag (0x0112) from the TIFF header inside the EXIF block. Returns 1 when it is missing.
function exifOrientation(tiff) {
  if (tiff.length < 8) return 1;
  const order = tiff.subarray(0, 2).toString("latin1");
  const le = order === "II";
  if (!le && order !== "MM") return 1;
  const u16 = (off) => (le ? tiff.readUInt16LE(off) : tiff.readUInt16BE(off));
  const u32 = (off) => (le ? tiff.readUInt32LE(off) : tiff.readUInt32BE(off));
  const ifd = u32(4);
  if (ifd < 8 || ifd + 2 > tiff.length) return 1;
  const n = u16(ifd);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > tiff.length) return 1;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}
