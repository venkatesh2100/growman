// Turn stored image keys into the public image URLs the shop JSON returns.
//
// A product prefers the first photo on any of its sizes. If no size has a
// photo, the product's own image key is used. Order lines use the image key
// saved on the line. Reviews and other callers can resolve a single key.

import { ProductSize } from "../models/index.js";

// Fill image URLs on one product. Size photos are listed first. The card image is the first size photo, or the product photo.
export function resolveProductImageURLs(product) {
  const body = product?.toJSON ? product.toJSON() : { ...(product || {}) };
  if (!this.imageService) return body;
  let firstSize = "";
  body.sizes = (body.sizes || []).map((size) => {
    const keys = size.imageKeys || [];
    const images = this.imageService.resolveImageURLs(keys);
    if (!firstSize && images.length) firstSize = images[0];
    return { ...size, images };
  });
  if (firstSize) body.imageUrl = firstSize;
  else if (body.imageKey) body.imageUrl = this.imageService.resolveImageURL(body.imageKey);
  return body;
}

// The same image URL fill for a list of product cards.
export function resolveProductImageURLsSlice(products) {
  return (products || []).map((product) => this.resolveProductImageURLs(product));
}

// The photo stored on one order line.
export function resolveOrderItemImageURL(item) {
  const body = item?.toJSON ? item.toJSON() : { ...(item || {}) };
  if (this.imageService && body.imageKey) body.imageUrl = this.imageService.resolveImageURL(body.imageKey);
  return body;
}

// The same order-line photo fill for a list of lines.
export function resolveOrderItemImageURLsSlice(items) {
  return (items || []).map((item) => this.resolveOrderItemImageURL(item));
}

// The photo to show for a product: the first size image that resolves, otherwise the product image key.
export async function displayPhotoURL(productId, imageKey) {
  if (!this.imageService) return "";
  if (productId) {
    const sizes = await ProductSize.findAll({ where: { productId }, attributes: ["imageKeys"] });
    for (const size of sizes) {
      for (const key of size.imageKeys || []) {
        if (!key) continue;
        const url = this.imageService.resolveImageURL(key);
        if (url) return url;
      }
    }
  }
  return this.imageService.resolveImageURL(imageKey || "");
}

// One stored key as a public image URL. An empty key or a missing image service yields an empty string.
export function resolveImageURL(key) {
  if (!this.imageService || !key) return "";
  return this.imageService.resolveImageURL(key);
}
