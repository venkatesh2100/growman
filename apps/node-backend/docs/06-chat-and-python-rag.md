# Chat and the Python RAG service

Say this first: the widget posts to Node `POST /api/v1/chat`. Node answers anything that needs the account. Python answers plant, policy, and product questions from retrieved text. Python never opens Postgres.

`docs/rag.md` at the repo root still says “Go” in a few sentences. Production is this Node path. The Python behavior is the same.

## Why the split

Orders and wishlist need the user id from the JWT. A model that can call those tools can be talked into dumping another customer’s order if the tool is sloppy. Node does those lookups in `internal/handlers/chat.js` with the authenticated user id, before HTTP to Python.

Plant care needs a corpus, a ranker, and a guardrail that refuses dosages. That code is `apps/ai`. Putting it in Node would load PyTorch into the commerce process and give the model the database client.

## Intent order

Evaluated in Node, in this order:

1. Support phrases (“escalate”, delay, refund trouble) create an `OrderSupportRequest`. A person follows up.
2. Wishlist, order status, and “my orders” read Prisma for the logged-in user. Logged out, the reply is “please log in”.
3. “In order to water…” is care, not an order. The phrase is excluded on purpose.
4. Everything else is posted to Python if `RAG_SERVICE_URL` is set. Empty URL means the canned reply in Node. Local dev works with no Python process.

Chat is limited to 30 requests per minute per IP, fail-closed onto an in-process counter if Redis is down.

## The HTTP contract

`internal/handlers/rag_client.js`

| Call | Python | Timeout |
|---|---|---|
| `askRAG` | `POST /v1/answer` `{ message, history }` | 20 seconds |
| `askRAGCare` | `POST /v1/care` species, common names, origin countries | caller’s signal |

Header: `X-Growman-RAG-Secret`. Compared on the Python side with `secrets.compare_digest`. An empty secret rejects every call. The browser never sees the header.

Python returns `response`, `productSlugs`, `route`, `usedLlm`. Node loads at most three active products by those slugs and fills price and image from Postgres again. The card does not trust a number in the model text.

Non-200 or a timeout: Node uses the canned plant reply. The shop stays up.

## Photo identify

`POST /api/v1/images/identify-plant` calls Pl@ntNet from Node. The free tier is 500 images a day, so the route is limited (20 per minute per IP) and the handler tracks the remaining quota. The species name then goes to `/v1/care`. Node caches that JSON for 14 days. Python does not store the photo.

## What Python does with the message

Full walkthrough: [11-python-rag.md](./11-python-rag.md).

Short version: guard, rules then optional Gemini classifier, hybrid retrieve top 20 fused to 4, catalog tool for prices, copy a passage unless the question is a comparison. Dosage and prompt injection never reach retrieval.

## Failure table

| Failure | User sees |
|---|---|
| Python down or secret mismatch | Canned reply from Node, shop still works |
| Gemini down or no key | Best passage, or “I’m not sure”. Prices still come from the catalog |
| Catalog API down | Python says it cannot confirm a live price. Care text from the file still works |
| Weak retrieval overlap | Abstain. No invented watering schedule |

## Interview line

“The model is behind a narrow HTTP API. Identity stays in Node. Grounding stays in Python. The product card is loaded a second time from Postgres so a hallucinated price cannot become a card.”
