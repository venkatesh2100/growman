# Chat Assistant ("Dootha") & Plant Identification

## Overview

`POST /api/v1/chat` (`internal/handlers/chat.go`) is a single endpoint that
serves several very different purposes behind one conversational interface:
general plant-care Q&A (LLM-backed), order-status/wishlist lookups from the
user's own account, and support-ticket escalation — routed by keyword/regex
intent detection *before* any LLM call is made. It's rate-limited to 30
requests/minute per IP (`internal/server/router.go`, group `"chat"`).

## Request shape

```go
type ChatRequest struct {
    Message             string
    ConversationHistory []ChatMessage  // last 6 turns are kept
    Token               string         // optional fallback JWT
}
```

`optionalClaimsFromRequest` accepts the JWT from **either** the
`Authorization` header **or** the `token` field in the JSON body — the
second exists for chat-widget contexts where attaching a custom header isn't
convenient. Auth is optional for chat overall; being logged in just unlocks
the account-aware branches.

## Intent routing (evaluated in this order)

```
1. detectOrderSupportIntent(msg)        → escalate to a support ticket
2. detectAccountIntent(msg)             → "wishlist" | "order_status" | "orders"
3. (logged-in only) detectLooseOrderIntent(msg)  → catches short/vague order asks
4. otherwise                             → general LLM chat with product context
```

- **Order-support escalation** (`detectOrderSupportIntent`,
  `internal/handlers/order_support.go`) fires on phrases like "escalate",
  "order delay", "customer support", or any message that both mentions an
  order number (`extractOrderIDFromMessage` — regex for `order #123` /
  `#123`) and a support-flavored word ("help", "delay", "refund", "track").
  Routes to `handleOrderSupportChat` (see
  [05-orders-checkout-payments.md](./05-orders-checkout-payments.md)) and
  returns immediately — never reaches the LLM.
- **Account intent** (`detectAccountIntent`) — wishlist keywords
  ("wishlist", "saved items", "favourites", …) or a wide net of order-related
  phrasing, matched via a mix of substring checks and a few compiled
  regexes (`orderShortPhrasePattern` for bare "orders?", `orderForAboutPattern`,
  `orderListIntentPattern`). `isPlantCareOrderPhrase` is a deliberate
  exclusion filter so phrases like "in order to..." or "order of watering"
  (plant-care advice, not e-commerce orders) don't get misrouted.
  - If not logged in, returns a canned "please log in" message without
    hitting the LLM or the DB.
  - If logged in, `handleAccountChatIntent` dispatches to
    `buildWishlistChatResponse`, `buildOrdersChatResponse`, or
    `buildSingleOrderChatResponse` (when an order number was mentioned).
- **Loose order intent** (`detectLooseOrderIntent`) — a looser net that only
  applies to already-logged-in users and short messages (≤80 chars)
  containing an order/delivery/refund/tracking word, so a logged-in user
  typing just "delivery?" still gets their real order data instead of a
  generic LLM answer that can't see their account.

## Account-aware responses

- **`buildOrdersChatResponse`** — fetches up to 40 recent orders matched by
  `user_id` **or** matching email/phone (`userOrdersQuery` — covers orders
  placed as a guest with the same email/phone before the user had an
  account), filters to `isVisibleOrder` (hides orders still in
  `payment_status: created`/pending-unpaid, and hides `failed`/`cancelled`),
  and returns the 2 most recent as `OrderChatCard`s.
- **`buildSingleOrderChatResponse`** — same visibility rule for one specific
  order ID scoped to the user.
- **`buildWishlistChatResponse`** — lists wishlist items (up to 20), attaches
  up to 3 as `ProductRecommendation` cards so the chat UI can render product
  tiles inline.
- **`displayOrderStatus`** maps the raw `status`/`payment_status` DB fields
  to a small set of human labels (Out for delivery / Shipped / Delivered /
  Confirmed / …) — the same status-normalization logic used for
  order-support ticket replies (`displayOrderStatusFromFields`).

## General LLM chat

For everything else, the handler builds a **grounded system prompt**:

1. `findRelevantProducts(message, 6)` — extracts search terms from the
   user's message (`extractSearchTerms`: lowercases, splits on non-alnum,
   drops a stopword list that includes generic chat words like "help",
   "plant", "growman", filters words <3 chars, caps at 6 terms), then does an
   `ILIKE`-based OR search across name/short_desc/description/tags. Falls
   back to featured active products if no terms or no matches — the LLM
   always gets *some* catalog context to ground product mentions in.
2. `buildSystemPrompt` — a template that: names the assistant "Dootha",
   instructs a direct-answer-then-bullets format, caps the response at ~110
   words, requires markdown formatting, nudges toward Indian context
   (monsoon humidity, AC dryness, ₹ prices), explicitly tells the model
   **not** to guess order/tracking/wishlist info (that's handled by the
   intent-routing above, never by the LLM), and appends the matched catalog
   products as a bullet list. `detectQuestionFocus` picks one line of
   guidance (watering / light / soil / pests / symptoms / recommendations)
   based on keywords, folded into the prompt's "answer this specifically"
   instruction.
3. Last 6 turns of conversation history are appended, then the current
   message.

### Provider selection (`callAI`)

```
AI_PROVIDER=gemini  → Gemini if GEMINI_API_KEY set, else canned fallback
AI_PROVIDER=openai  → OpenAI if OPENAI_API_KEY set, else canned fallback
(anything else)     → Gemini if configured, else OpenAI if configured, else fallback
```

- **Gemini** (`callGeminiAPI`) — `gemini-flash-latest` (the free-tier model),
  system instruction passed via the `systemInstruction` field (not folded
  into `contents`), temperature 0.35, max 350 output tokens.
- **OpenAI** (`callOpenAIAPI`) — `gpt-3.5-turbo`, temperature 0.35, max 280
  tokens, system prompt as a normal `system`-role message.
- Both go through a shared `postJSON` helper (25s client timeout) and treat
  a non-200 response or malformed body as "fall back," never as a hard
  error surfaced to the user — `getFallbackResponse` provides
  keyword-matched canned advice (watering/light/leaf-problems/soil/
  fertilizer/pests/beginner-picks) so the chat still answers *something*
  useful if no AI provider is configured or a provider call fails.

### Product recommendations from the reply

`extractProductRecommendations` re-uses the products already matched for the
system prompt, **boosts** ones whose exact name appears in the AI's reply
text, and if fewer than 3 are found, does a couple of small supplementary
DB searches using terms extracted from the *AI's own reply* — capped at 3
recommendations total, each with a resolved image URL.

### Auto-creating "requested products"

`maybeAutoCreateRequestedProduct` — if the combined user+AI text contains
signal phrases ("cannot find", "not available", "out of stock", "add this
product", …) **and** no product was actually recommended, it silently
inserts a `RequestedProduct` row (`Source: "chatbot_auto"`) so the catalog
team gets a demand signal without the user having to fill out a form. Name
extraction (`extractRequestedProductName`) prefers a quoted phrase in the
message, then falls back to text after "looking for"/"need"/"want"/"find",
then the raw (truncated) message.

## Plant identification (`internal/handlers/plants.go`)

`POST /api/v1/images/identify-plant` (rate-limited 20/min per IP) proxies to
the **Pl@ntNet** API (`my-api.plantnet.org/v2/identify/all`), not an LLM:

- Accepts 1–5 images (`image`/`images` multipart fields), up to 50MB total,
  optional per-image `organs` hints (`auto`/`flower`/`leaf`/`fruit`/`bark`).
- Rebuilds the multipart body to forward to Pl@ntNet, appending
  `nb-results`/`lang` if provided.
- **Silently uploads the submitted images to Google Cloud Storage in a
  background goroutine** (`GenerateImageKey("plants", filename)` — see
  [07-images-and-storage.md](./07-images-and-storage.md)), purely for the
  business to build a dataset/log of what users are photographing; failures
  there are logged and otherwise ignored, never surfaced to the caller.
- Returns Pl@ntNet's raw JSON response body unchanged — no reshaping,
  intentionally, to stay compatible with whatever the frontend already
  expects from Pl@ntNet's own response schema.
