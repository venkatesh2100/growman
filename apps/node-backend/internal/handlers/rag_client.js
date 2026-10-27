// This file talks to the plant-advice service for Dootha chat and care guides.
// A customer question goes out, and the reply comes back as text plus shop
// product names the chat can turn into cards.

import { Product } from "../models/index.js";

// Drops a trailing slash so the service address and the path join cleanly.
function trimBase(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

// Reads the service reply and stops after the size limit so a huge body cannot fill memory.
async function readLimited(res, max) {
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > max ? buf.subarray(0, max) : buf;
}

// Sends one JSON request to the plant-advice service and returns the status and body.
export async function postRAG(path, payload, signal) {
  // Chat cannot call the service when the address in config is blank.
  const base = trimBase(this.cfg.ragServiceURL);
  if (!base) {
    throw new Error("rag service url is empty");
  }
  // The shared secret tells the advice service this request came from Growman.
  const res = await fetch(base + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Growman-RAG-Secret": this.cfg.ragSharedSecret || "",
    },
    body: JSON.stringify(payload),
    signal,
  });
  // Keep at most one megabyte of the reply.
  const body = await readLimited(res, 1 << 20);
  return { status: res.status, body };
}

// Asks the advice service to answer a customer message, including recent chat turns.
export async function askRAG(message, history) {
  const turns = Array.isArray(history) ? history : [];
  // Give the service twenty seconds, then treat a slow reply as a failure.
  const { status, body } = await this.postRAG("/v1/answer", { message, history: turns }, AbortSignal.timeout(20_000));
  // Anything other than a normal success means the canned plant replies should be used instead.
  if (status !== 200) throw new Error(`rag status ${status}`);
  const ans = JSON.parse(body.toString("utf8"));
  return {
    response: ans.response || "",
    productSlugs: Array.isArray(ans.productSlugs) ? ans.productSlugs : [],
    route: ans.route || "",
    usedLlm: Boolean(ans.usedLlm),
  };
}

// Asks the advice service for a short care guide for one scanned plant species.
export async function askRAGCare(payload, signal) {
  const { status, body } = await this.postRAG("/v1/care", payload, signal);
  if (status !== 200) throw new Error(`rag care status ${status}`);
  return body;
}

// Turns the plant names the advice service suggested into shop cards.
// Keeps the order the RAG service returned and drops anything that is not an active catalog row.
export async function productsBySlugs(slugs) {
  if (!Array.isArray(slugs) || slugs.length === 0) return [];
  // Only the first three suggestions become cards the customer can tap.
  const wanted = slugs.slice(0, 3);
  const products = await Product.findAll({
    attributes: ["id", "name", "slug", "price", "imageKey"],
    where: { status: "active", slug: wanted },
  });
  const bySlug = new Map(products.map((p) => [p.slug, p]));
  const out = [];
  for (const slug of wanted) {
    const product = bySlug.get(slug);
    // Skip a name that is not an active product in the shop.
    if (!product) continue;
    const imageUrl = await this.displayPhotoURL(product.id, product.imageKey);
    const row = {
      id: product.id,
      name: product.name,
      slug: product.slug,
      price: product.price,
    };
    if (imageUrl) row.imageUrl = imageUrl;
    out.push(row);
  }
  return out;
}
