// This file is Dootha's chat for customers.
// A message is read as an order question, a wishlist question, or a plant-care
// question. Order and wishlist answers come from the customer's account.
// Other questions go to the plant-advice service, with a short canned reply
// when that service is down. Signed-in chats are saved and a notice is sent.

import { Op, literal } from "sequelize";
import { decode, error, json } from "../../pkg/httpjson/httpjson.js";
import { parseToken } from "../auth/jwt.js";
import { emailOrEmpty, Order, phoneOrEmpty, Product, RequestedProduct, User, Wishlist } from "../models/index.js";

// A message that is only "show my orders" or a close variant.
const orderShortPhrase = /^(?:show\s+|list\s+|view\s+|check\s+|see\s+|get\s+)?(?:my\s+)?orders?[\s!.?]*$/i;
// "for my order", "about orders", and similar phrases.
const orderForAbout = /\b(for|about|regarding|with)\s+(my\s+)?orders?\b/i;
// "list my orders" even when a few words sit between the verb and "orders".
const orderListIntent = /\b(list|show|view|check|see|get|tell\s+me)\b.{0,30}\b(?:my\s+)?orders?\b/i;
// Refund, tracking, and delivery words that point at an order question.
const orderSupportKeyword = /\b(refund|tracking|tracked|delivery|delivered|shipped|shipment)\b/i;
// A short message that merely mentions an order, a parcel, or a refund.
const looseOrder = /\b(orders?|delivery|refund|tracking|shipment|parcel)\b/i;
// "order #12", "order number 12", or a bare "#12".
const orderIDPatterns = [
  /order\s*(?:#|no\.?|number|id)?\s*(\d{1,10})/i,
  /#\s*(\d{1,10})\b/i,
];
// Words that are too common to use when searching the shop for a plant.
const chatStopWords = new Set([
  "the", "a", "an", "is", "are", "was", "be",
  "how", "what", "when", "where", "why", "can",
  "do", "does", "did", "my", "i", "me", "for",
  "to", "and", "or", "with", "about", "please",
  "help", "tell", "this", "that", "have", "has",
  "plant", "plants", "growman", "dootha", "need", "want",
]);

// A calendar date in UTC, written as "26 Oct 2026" on an order card.
function utcLong(date) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = new Date(date);
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// The current hour, used so a handoff notice is sent at most once an hour.
function localHour(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}`;
}

// The current minute, used so a Dootha reply notice is sent at most once a minute.
function localMinute(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${min}`;
}

// Shortens text to a byte limit without cutting a multi-byte letter in half.
function clipBytes(s, max) {
  const text = String(s ?? "");
  const buf = Buffer.from(text);
  if (buf.length <= max) return text;
  let end = max;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString("utf8");
}

// The shop fields a chat product card is allowed to show.
function cardProduct(p) {
  const row = { id: p.id, name: p.name, slug: p.slug, price: p.price };
  if (p.imageUrl) row.imageUrl = p.imageUrl;
  return row;
}

// The chat reply the app receives: text, product cards, order cards, and optional hints.
function chatPayload(resp) {
  const out = { response: resp.response };
  if (resp.recommendedProducts?.length) out.recommendedProducts = resp.recommendedProducts.map(cardProduct);
  if (resp.orders?.length) {
    out.orders = resp.orders.map((card) => {
      const row = {
        id: card.id,
        status: card.status,
        amount: card.amount,
        createdAt: card.createdAt,
        itemCount: card.itemCount,
        itemPreview: card.itemPreview || "",
      };
      if (card.expectedDeliveryDate) row.expectedDeliveryDate = card.expectedDeliveryDate;
      if (card.imageUrl) row.imageUrl = card.imageUrl;
      return row;
    });
  }
  if (resp.careHint) out.careHint = resp.careHint;
  if (resp.handoff) out.handoff = true;
  return out;
}

// Answers one customer message: support, orders, wishlist, or a plant-care reply.
export async function chat(req, res) {
  const body = decode(req, res);
  if (!body) return;
  if (!body.message) {
    error(res, 400, "message is required");
    return;
  }
  // Login is optional. Orders and wishlist answers need it. Plant questions do not.
  const [claims, loggedIn] = this.optionalClaimsFromRequest(req, body.token);
  // Chat intent: a delay, refund, or support phrase is handed to the team.
  if (this.detectOrderSupportIntent(body.message)) {
    const result = await this.handleOrderSupportChat(body.message, loggedIn ? claims : null, loggedIn);
    await this.finishChat(claims, loggedIn, body.message, result.text, true);
    json(res, 200, chatPayload({
      response: result.text,
      recommendedProducts: result.products,
      orders: result.orders,
      handoff: true,
    }));
    return;
  }
  // Chat intent: "my orders" or "my wishlist" is answered from the account.
  const intent = detectAccountIntent(body.message);
  if (intent) {
    if (!loggedIn) {
      json(res, 200, {
        response: "Please **log in** to view your orders or wishlist. Open **Account**, sign in, then ask me again — e.g. \"show my orders\" or \"what's in my wishlist\".",
      });
      return;
    }
    const result = await this.handleAccountChatIntent(intent, body.message, claims.userId);
    if (result.ok) {
      json(res, 200, chatPayload(result));
      return;
    }
  }
  // A short message that only mentions an order is treated as an order question too.
  if (loggedIn) {
    const loose = detectLooseOrderIntent(body.message);
    if (loose) {
      const result = await this.handleAccountChatIntent(loose, body.message, claims.userId);
      if (result.ok) {
        json(res, 200, chatPayload(result));
        return;
      }
    }
  }
  // Keep the last six turns the app sent. If it sent none, load recent saved turns.
  let history = Array.isArray(body.conversationHistory) ? body.conversationHistory : [];
  if (history.length > 6) history = history.slice(-6);
  if (loggedIn && history.length === 0) history = await this.recentChat(claims.userId);
  let aiResponse = "";
  let recommendedProducts = [];
  if (String(this.cfg.ragServiceURL || "").trim()) {
    try {
      const ans = await this.askRAG(body.message, history);
      if (!String(ans?.response || "").trim()) throw new Error("empty rag response");
      aiResponse = ans.response;
      recommendedProducts = await this.productsBySlugs(ans.productSlugs);
    } catch (err) {
      // The advice service is down, so use a canned care reply and search the shop.
      console.log(`[CHAT] RAG unavailable, using canned reply: ${err.message || err}`);
      aiResponse = getFallbackResponse(body.message);
      const relevant = await this.findRelevantProducts(body.message, 6);
      recommendedProducts = await this.extractProductRecommendations(body.message, aiResponse, relevant);
    }
  } else {
    aiResponse = getFallbackResponse(body.message);
    const relevant = await this.findRelevantProducts(body.message, 6);
    recommendedProducts = await this.extractProductRecommendations(body.message, aiResponse, relevant);
  }
  // A message that asks for a plant we do not sell can become a product request for staff.
  await this.maybeAutoCreateRequestedProduct(body.message, aiResponse, recommendedProducts);
  for (const product of recommendedProducts) {
    if (!product.imageUrl) {
      const url = await this.displayPhotoURL(product.id, "");
      if (url) product.imageUrl = url;
    }
  }
  await this.finishChat(claims, loggedIn, body.message, aiResponse, false);
  json(res, 200, chatPayload({
    response: aiResponse,
    recommendedProducts,
    careHint: careHintFor(body.message),
  }));
}

// Saves the turn for a signed-in customer and sends an inbox notice.
// A handoff notice says a person will follow up. A normal reply says Dootha answered.
export async function finishChat(claims, loggedIn, userMessage, reply, handoff) {
  if (!loggedIn || !claims) return;
  await this.saveChatTurn(claims.userId, "user", userMessage);
  await this.saveChatTurn(claims.userId, "assistant", reply);
  if (handoff) {
    await this.pushNotice(
      claims.userId, "dootha", "A person will follow up",
      "Your order question was passed to the Growman team.",
      "/support", `handoff:${localHour()}`, null, null, null,
    );
    return;
  }
  await this.pushNotice(
    claims.userId, "dootha", "Dootha replied", this.clipText(reply, 180),
    "/chat", `dootha:${localMinute()}`, null, null, null,
  );
}

// A small hint for the app: offer a reminder for pests or yellow leaves, or offer to save a plant.
function careHintFor(message) {
  const lower = String(message || "").toLowerCase();
  const hint = {};
  if (lower.includes("pest") || lower.includes("bug")) hint.status = "pests";
  else if (lower.includes("yellow")) hint.status = "yellowing";
  else if (lower.includes("rot") || lower.includes("wilt")) hint.status = "wilting";
  if (hint.status) hint.suggestReminder = true;
  else hint.suggestReminder = false;
  hint.suggestAddPlant = false;
  if (lower.includes("balcony") || lower.includes("what should i buy") || lower.includes("recommend") || lower.startsWith("what is ")) {
    hint.suggestAddPlant = true;
    if (lower.startsWith("what is ")) {
      let name = lower.slice("what is ".length);
      const cut = name.indexOf(" and ");
      if (cut > 0) name = name.slice(0, cut);
      const plantName = [...name.trim()].slice(0, 80).join("").trim();
      if (plantName) hint.plantName = plantName;
    }
  }
  if (!hint.status && !hint.suggestAddPlant) return null;
  if (!hint.status) delete hint.status;
  return hint;
}

// Reads a login token from the Authorization header or from the chat body. Either one is enough.
export function optionalClaimsFromRequest(req, bodyToken) {
  const candidates = [];
  const header = req.get("Authorization") || "";
  if (header) {
    const parts = header.split(/ (.+)/);
    if (parts.length >= 2 && parts[0].toLowerCase() === "bearer") candidates.push(parts[1]);
  }
  const token = String(bodyToken || "").trim();
  if (token) candidates.push(token);
  for (const raw of candidates) {
    try {
      const claims = parseToken(this.cfg.jwtSecret, raw);
      if (claims) return [claims, true];
    } catch { /* try the next token */ }
  }
  return [null, false];
}

// "In order to water" is plant care, not a shop order. Those phrases are not order intent.
function isPlantCareOrderPhrase(lower) {
  if (lower.includes("in order to")) return true;
  if (lower.includes("order of") && (lower.includes("water") || lower.includes("fertil") || lower.includes("repot"))) return true;
  return false;
}

// The order number in a message, or null when the customer did not name one.
export function extractOrderIDFromMessage(msg) {
  for (const re of orderIDPatterns) {
    const m = re.exec(String(msg || ""));
    if (m && m[1]) {
      const id = Number(m[1]);
      if (Number.isInteger(id) && id > 0 && id <= 0xffffffff) return id;
    }
  }
  return null;
}

// Chat intent: "wishlist", "orders", "order_status", or blank when this is not an account question.
function detectAccountIntent(msg) {
  const lower = String(msg || "").trim().toLowerCase();
  if (isPlantCareOrderPhrase(lower)) return "";
  for (const term of [
    "wishlist", "wish list", "saved items", "saved plants",
    "favourites", "favorites", "heart list", "liked items",
  ]) {
    if (lower.includes(term)) return "wishlist";
  }
  if (orderShortPhrase.test(lower)) {
    return extractOrderIDFromMessage(msg) != null ? "order_status" : "orders";
  }
  for (const term of [
    "my order", "my orders", "order status", "order history",
    "track order", "track my order", "where is my order",
    "delivery status", "order delivery", "recent orders", "past orders",
    "my purchase", "my purchases", "shipment status", "order update",
    "for orders", "for my order", "about orders", "about my order",
    "regarding order", "regarding my order", "with my order",
    "order refund", "refund my order", "cancel order", "cancel my order",
    "track package", "track shipment", "track delivery",
    "where is my package", "where is my delivery",
    "order delay", "delayed order", "late order",
    "order problem", "order issue", "wrong order", "growman orders",
    "order details", "order info", "order number", "order tracking",
  ]) {
    if (lower.includes(term)) {
      return extractOrderIDFromMessage(msg) != null ? "order_status" : "orders";
    }
  }
  if (orderForAbout.test(lower)) {
    return extractOrderIDFromMessage(msg) != null ? "order_status" : "orders";
  }
  if (extractOrderIDFromMessage(msg) != null && (lower.includes("order") || lower.includes("track") || lower.includes("status"))) {
    return "order_status";
  }
  if (orderListIntent.test(lower)) return "orders";
  if (orderSupportKeyword.test(lower) && (lower.includes("order") || lower.includes("my "))) {
    return extractOrderIDFromMessage(msg) != null ? "order_status" : "orders";
  }
  return "";
}

// Chat intent for a short message that mentions an order without a fuller phrase.
function detectLooseOrderIntent(msg) {
  const lower = String(msg || "").trim().toLowerCase();
  if (isPlantCareOrderPhrase(lower)) return "";
  if (!looseOrder.test(lower)) return "";
  if (lower.length > 80) return "";
  return extractOrderIDFromMessage(msg) != null ? "order_status" : "orders";
}

// Runs the account intent: wishlist, one order, or the two newest active orders.
export async function handleAccountChatIntent(intent, userMessage, userId) {
  if (intent === "wishlist") {
    const [text, products] = await this.buildWishlistChatResponse(userId);
    return { ok: true, response: text, recommendedProducts: products };
  }
  if (intent === "order_status") {
    const orderID = extractOrderIDFromMessage(userMessage);
    if (orderID == null) return this.buildOrdersChatResponse(userId);
    return this.buildSingleOrderChatResponse(userId, orderID);
  }
  if (intent === "orders") return this.buildOrdersChatResponse(userId);
  return { ok: false };
}

// Finds this customer's orders by account id, and also by the email or phone on the order.
export async function userOrdersQuery(userId) {
  const user = await User.findByPk(userId, { attributes: ["email", "phone"] });
  if (!user) return { userId };
  const email = emailOrEmpty(user).trim().toLowerCase();
  const phone = phoneOrEmpty(user).trim();
  if (email && phone) {
    return { [Op.or]: [{ userId }, literal(`LOWER(customer_email) = ${this.sequelize.escape(email)}`), { customerPhone: phone }] };
  }
  if (email) return { [Op.or]: [{ userId }, literal(`LOWER(customer_email) = ${this.sequelize.escape(email)}`)] };
  if (phone) return { [Op.or]: [{ userId }, { customerPhone: phone }] };
  return { userId };
}

// Unpaid, failed, and cancelled checkouts are hidden from the "my orders" chat answer.
function isVisibleOrder(order) {
  const payment = String(order.paymentStatus || "").trim().toLowerCase();
  const status = String(order.status || "").trim().toLowerCase();
  if (payment === "created" || (status === "pending" && (payment === "" || payment === "created"))) return false;
  if (payment === "failed" || status === "failed" || status === "cancelled") return false;
  return payment === "paid" || status === "paid" || status === "confirmed" || status === "shipped" ||
    status === "out_for_delivery" || status === "delivered";
}

// One order turned into the small card the chat shows.
export async function orderToChatCard(order) {
  const items = this.resolveOrderItemImageURLsSlice(order.items || []);
  const card = {
    id: order.id,
    status: displayOrderStatus(order),
    amount: order.amount,
    createdAt: utcLong(order.createdAt),
    itemCount: items.length,
    itemPreview: "",
  };
  if (order.expectedDeliveryDate) card.expectedDeliveryDate = utcLong(order.expectedDeliveryDate);
  if (items.length) {
    card.itemPreview = formatOrderItems(order.items || []);
    if (items[0].imageUrl) card.imageUrl = items[0].imageUrl;
  }
  return card;
}

// A status phrase the customer can read, such as "Out for delivery" or "Confirmed".
export function displayOrderStatus(order) {
  const status = String(order?.status || "").trim().toLowerCase();
  const payment = String(order?.paymentStatus || "").trim().toLowerCase();
  if (status === "out_for_delivery") return "Out for delivery";
  if (status === "shipped") return "Shipped";
  if (status === "delivered") return "Delivered";
  if (status === "confirmed") return "Confirmed";
  if (payment === "paid" || status === "paid") return "Confirmed";
  return humanOrderStatus(order?.status);
}

// The two newest paid or active orders, or a message when there are none.
export async function buildOrdersChatResponse(userId) {
  let all = [];
  try {
    all = await Order.findAll({
      where: await this.userOrdersQuery(userId),
      include: [{ association: "items" }],
      order: [["createdAt", "DESC"]],
      limit: 40,
    });
  } catch (err) {
    console.log(`[CHAT] Error fetching orders for user ${userId}: ${err.message || err}`);
    return { ok: true, response: "Sorry, I couldn't load your orders right now. Try again or email **growman.live@gmail.com**." };
  }
  const visible = [];
  for (const order of all) {
    if (!isVisibleOrder(order)) continue;
    visible.push(order);
    if (visible.length >= 2) break;
  }
  if (!visible.length) {
    return {
      ok: true,
      response: "You don't have any **active paid orders** right now. Unpaid checkouts are hidden — complete payment in **Shop**, or ask **\"status of order #123\"** for a specific order.",
    };
  }
  const orders = [];
  for (const order of visible) orders.push(await this.orderToChatCard(order));
  const response = orders.length === 1
    ? "Here is your **most recent active order**:"
    : "Here are your **2 most recent active orders**:";
  return { ok: true, response, orders };
}

// One named order, including a pending payment the general list would hide.
export async function buildSingleOrderChatResponse(userId, orderId) {
  const scope = await this.userOrdersQuery(userId);
  const order = await Order.findOne({
    where: { [Op.and]: [scope, { id: orderId }] },
    include: [{ association: "items" }],
  });
  if (!order) {
    return {
      ok: true,
      response: `**Order #${orderId}** was not found on your account. Double-check the number or email **growman.live@gmail.com**.`,
    };
  }
  const card = await this.orderToChatCard(order);
  let response = `**Order #${order.id}** — ${card.status}`;
  if (!isVisibleOrder(order)) {
    response = `**Order #${order.id}** — payment is still **pending**. Complete checkout to confirm this order.`;
  }
  return { ok: true, response, orders: [card] };
}

// The customer's wishlist as chat text, plus up to three product cards.
export async function buildWishlistChatResponse(userId) {
  let items = [];
  try {
    items = await Wishlist.findAll({
      where: { userId },
      include: [{ association: "product" }],
      order: [["createdAt", "DESC"]],
      limit: 20,
    });
  } catch (err) {
    console.log(`[CHAT] Error fetching wishlist for user ${userId}: ${err.message || err}`);
    return ["Sorry, I couldn't load your wishlist right now. Try again from **Account → Wishlist**.", null, true];
  }
  if (!items.length) return ["Your **wishlist is empty**. Tap the heart on any product to save it for later.", null, true];
  let text = `**Your wishlist** (${items.length} items):\n\n`;
  const recommendations = [];
  for (let i = 0; i < items.length; i++) {
    const p = items[i].product || {};
    text += `- **${p.name}** — ₹${Math.round(Number(p.price) || 0)}\n`;
    if (i < 3) {
      const imageUrl = await this.displayPhotoURL(p.id, p.imageKey);
      recommendations.push({ id: p.id, name: p.name, slug: p.slug, price: p.price, imageUrl });
    }
  }
  if (items.length > 3) text += "\n_Tap a product card below or open **Account → Wishlist** to see all._";
  return [text, recommendations, true];
}

// Plant names on an order, with a quantity when they bought more than one.
export function formatOrderItems(items) {
  return (items || []).map((item) => {
    const name = item.name || "Item";
    return item.quantity > 1 ? `${name} × ${item.quantity}` : name;
  }).join(", ");
}

// Turns a status code such as "out_for_delivery" into "Out For Delivery".
export function humanOrderStatus(status) {
  const s = String(status || "").trim().toLowerCase();
  if (!s) return "pending";
  return s.replaceAll("_", " ").split(/\s+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

// Up to six useful words from a message, for searching product names and tags.
function extractSearchTerms(text) {
  const parts = String(text || "").toLowerCase().split(/[^a-z0-9]+/);
  const seen = new Set();
  const terms = [];
  for (const part of parts) {
    if (part.length < 3 || chatStopWords.has(part) || seen.has(part)) continue;
    seen.add(part);
    terms.push(part);
    if (terms.length >= 6) break;
  }
  return terms;
}

// A case-insensitive "contains" test across the named product columns.
function likeClause(sequelize, term, columns) {
  const pattern = sequelize.escape(`%${term}%`);
  return columns.map((column) => `${column} ILIKE ${pattern}`).join(" OR ");
}

// Shop products that match the customer's words, or featured products when nothing matches.
export async function findRelevantProducts(userMessage, limit) {
  const terms = extractSearchTerms(userMessage);
  const attributes = ["id", "name", "slug", "price", "imageKey", "shortDesc", "description", "tags"];
  if (!terms.length) {
    return Product.findAll({
      attributes,
      where: { featured: true, status: "active" },
      limit,
    });
  }
  const ors = terms.map((term) => `(${likeClause(this.sequelize, term, ["name", "short_desc", "description", "tags::text"])})`).join(" OR ");
  let products = await Product.findAll({
    attributes,
    where: { status: "active", [Op.and]: [literal(ors)] },
    limit,
  });
  if (!products.length) {
    products = await Product.findAll({
      attributes,
      where: { featured: true, status: "active" },
      limit,
    });
  }
  return products;
}

// A canned care answer used when the plant-advice service is not available.
function getFallbackResponse(userMessage) {
  const lower = String(userMessage || "").toLowerCase();
  if (lower.includes("water") || lower.includes("watering")) {
    return "**Watering:** Check the top 2 cm of soil — water only when dry. Most indoor plants need watering every 5–10 days in summer, less in monsoon/winter. Ensure drainage holes; empty the saucer after watering.";
  }
  if (lower.includes("light") || lower.includes("sunlight") || lower.includes("sun")) {
    return "**Light:** Bright indirect light suits most houseplants. South/east windows work well in India; avoid harsh midday sun on delicate leaves. Low-light picks: pothos, snake plant, zz plant.";
  }
  if (lower.includes("yellow") || lower.includes("brown") || lower.includes("dying")) {
    return "**Leaf problems:** Yellow leaves often mean overwatering or poor drainage; brown tips suggest low humidity or salt buildup. Trim damaged leaves, adjust watering, and improve airflow.";
  }
  if (lower.includes("soil") || lower.includes("potting") || lower.includes("repot")) {
    return "**Soil & pots:** Use well-draining potting mix — not garden soil. Repot when roots circle the pot or water runs straight through. Go one pot size up with drainage holes.";
  }
  if (lower.includes("fertilizer") || lower.includes("fertilize")) {
    return "**Feeding:** Fertilize monthly in spring/summer with diluted balanced liquid feed; pause in winter. Over-fertilizing burns roots — always follow label dilution.";
  }
  if (lower.includes("pest") || lower.includes("bug") || lower.includes("mealy")) {
    return "**Pests:** Isolate affected plants. Wipe mealybugs with alcohol swabs; spray neem oil for aphids/mites. Repeat weekly until clear; improve airflow to prevent recurrence.";
  }
  if (lower.includes("gift") || lower.includes("office") || lower.includes("beginner")) {
    return "**Easy picks:** For gifts or beginners try pothos, snake plant, or money plant — low maintenance and tolerate indoor Indian conditions. Browse gift-tagged plants on Growman.";
  }
  return "Ask me about **watering**, **light**, **soil**, **pests**, or **plant picks** for your space. I can suggest matching products from Growman too.";
}

// Up to three shop cards. Plants named in the reply are preferred, then a search of the reply's words.
export async function extractProductRecommendations(userMessage, aiResponse, preloaded) {
  let products = preloaded;
  if (!products?.length) products = await this.findRelevantProducts(userMessage, 5);
  const lowerAI = String(aiResponse || "").toLowerCase();
  const productMap = new Map();
  const ordered = [];
  // Adds a product once, in the order it was first seen.
  const addProduct = (product) => {
    const key = String(product.id);
    if (productMap.has(key)) return;
    productMap.set(key, product);
    ordered.push(key);
  };
  for (const product of products) addProduct(product);
  for (const product of products) {
    if (lowerAI.includes(String(product.name || "").toLowerCase())) addProduct(product);
  }
  if (ordered.length < 3) {
    for (const term of extractSearchTerms(aiResponse)) {
      if (ordered.length >= 3) break;
      const pattern = this.sequelize.escape(`%${term}%`);
      const extra = await Product.findAll({
        attributes: ["id", "name", "slug", "price", "imageKey"],
        where: { status: "active", [Op.and]: [literal(`(name ILIKE ${pattern} OR tags::text ILIKE ${pattern})`)] },
        limit: 2,
      });
      for (const product of extra) {
        addProduct(product);
        if (ordered.length >= 3) break;
      }
    }
  }
  const recommendations = [];
  for (const id of ordered) {
    if (recommendations.length >= 3) break;
    const product = productMap.get(id);
    const imageUrl = await this.displayPhotoURL(product.id, product.imageKey);
    recommendations.push({
      id: product.id, name: product.name, slug: product.slug, price: product.price, imageUrl,
    });
  }
  return recommendations;
}

// When the chat cannot find a plant the customer asked to add, save a request for staff.
export async function maybeAutoCreateRequestedProduct(userMessage, aiResponse, recommendations) {
  const lower = `${userMessage || ""} ${aiResponse || ""}`.trim().toLowerCase();
  if (!lower) return;
  const signals = ["exact product", "request to add", "add it to", "add this product", "cannot find", "not available", "out of stock"];
  // A request is only saved when the reply found no shop cards and the words ask for a missing product.
  if (!signals.some((signal) => lower.includes(signal)) || (recommendations && recommendations.length > 0)) return;
  let name = extractRequestedProductName(userMessage);
  if (!name) name = clipBytes(String(userMessage || "").trim(), 120);
  let details = String(userMessage || "").trim();
  if (!details) details = "Requested from chatbot conversation";
  try {
    await RequestedProduct.create({ productName: name, details, status: "pending", source: "chatbot_auto" });
  } catch (err) {
    console.log(`[CHAT] Failed to auto-create requested product: ${err.message || err}`);
  }
}

// A product name pulled from quotes, or from the words after "looking for", "need", "want", or "find".
function extractRequestedProductName(message) {
  const trimmed = String(message || "").trim();
  if (!trimmed) return "";
  const quoted = /"([^"]+)"/.exec(trimmed);
  if (quoted) return quoted[1].trim();
  const lower = trimmed.toLowerCase();
  for (const phrase of ["looking for", "need", "want", "find"]) {
    const idx = lower.indexOf(phrase);
    if (idx >= 0) {
      let candidate = trimmed.slice(idx + phrase.length).trim().replace(/^[ .,;:!?]+|[ .,;:!?]+$/g, "");
      if (candidate) return clipBytes(candidate, 120);
    }
  }
  return clipBytes(trimmed, 120);
}
