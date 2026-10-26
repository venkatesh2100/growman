# Dootha hybrid RAG

Dootha answers plant, shop, and policy questions from retrieved Growman text plus the live catalog. The browser still talks only to the Go API. Orders, wishlist, and support tickets never go to the model.

The knowledge file is [apps/ai/corpus/growman.txt](../apps/ai/corpus/growman.txt). It is a 4 October 2026 snapshot. Its rupee amounts are not quoted. Price, MRP, stock, and product cards come from the catalog API, which reads Postgres.

## What each process owns

```mermaid
flowchart TD
  widget[PlantChatbot]
  goApi[Go API]
  orders[Orders wishlist support]
  rag[FastAPI RAG]
  guard[Input guard]
  graph[LangGraph router]
  hybrid[Hybrid search plus rerank]
  tool[Live catalog tool]
  llm[Gemini Flash only when needed]
  widget --> goApi
  goApi --> orders
  goApi --> rag
  rag --> guard --> graph
  graph --> hybrid
  graph --> tool
  hybrid --> llm
  tool --> goApi
```

- **Web** ([PlantChatbot.tsx](../apps/web/components/chatbot/PlantChatbot.tsx)) still posts to `POST /api/v1/chat` and renders `response`, `recommendedProducts`, and `orders`.
- **Go** keeps the existing short-circuit for support tickets, wishlist, and orders, including the logged-out “please log in” reply. Every other message is sent to the RAG service. If that service is down or times out, Go uses the canned `getFallbackResponse`.
- **Python** (`apps/ai`) does retrieval, routing, guardrails, and the only model call.
- **Postgres** stays behind Go. The RAG service has no database password and does not read order rows.
- **Photo identify** stays on Pl@ntNet in Go. The care sheet for a scan is `POST /v1/care` on the RAG service, cached in Go for 14 days.

## A question, end to end

1. The widget sends `{ message, conversationHistory, token }`.
2. Go checks support, wishlist, and order intents first. “In order to water…” stays a care question. “Where is my order?” never reaches Python.
3. Otherwise Go posts the message and the last six turns to `POST /v1/answer` with the header `X-Growman-RAG-Secret`.
4. Python runs the LangGraph below.
5. Go loads any returned slugs from Postgres and fills `recommendedProducts` with the current price and image. The chat text and the cards are therefore both live, and the card price is read again from the database rather than trusted from the model.

If `RAG_SERVICE_URL` is empty, step 3 is skipped and the canned reply is used. Local development works without the Python process.

## Routes

Rules run first. A Gemini classifier runs only when no rule matches, and only when `GEMINI_API_KEY` is set. With no key, an unclear question is treated as plant care and then has to survive retrieval.

| Question | Route | What happens |
|---|---|---|
| Where is my parcel? | `orders_refused_here` | Ask the user to log in. No retrieval, no model. Go usually answers this itself before Python sees it. |
| How do I pay on Growman? | `policy` | Help-center Q&A from section 2. The matching answer is returned as written. No model. |
| How much does delivery cost? | `policy` | Same help-center path. “How much” does not make this a product search. |
| How often should I water indoor plants? | `plant_care` | Watering guide or the matching FAQ. One clear passage is copied. No model. |
| Which plant is best for a dark room? | `plant_care` | Selection guide / FAQ in sections 12 and 17. |
| Snake plant vs areca, which needs more water? | `plant_care` | Two passages, then one Gemini Flash call if a key is set. Otherwise the best passage is copied. |
| How much is the snake plant? | `product_discovery` | Hybrid search finds the plant. The catalog tool loads live price, MRP, stock, and slug. The reply is a template. No model. |
| Pet-safe plants under 500 | `product_discovery` | Same tool, filtered to live prices at or under 500. |
| How do I water tulsi? | `medicinal` | Care text plus “Consult a qualified practitioner… This is not medical advice.” |
| How much tulsi should I eat to cure a cold? | `medicinal_refusal` | Refused before retrieval. |
| Ignore previous instructions | `injection` | Short refusal. No retrieval, no model. |
| Who won the cricket world cup? | `off_topic` | Dootha says what it can help with. |

“In order to water my snake plant” is plant care. The same phrase shape is excluded in Go (`isPlantCareOrderPhrase`) so it is not mistaken for an order.

## Hybrid search

The catalog is about 60 plants plus the guides. The index lives in the Python process. It is rebuilt when the service starts and when `POST /v1/reindex` is called.

Chunking follows the file:

- A line of `=====` starts a section.
- Each `### PLANT:` block is one chunk, with the plant name, category, and botanical name stored beside the text.
- Each help-center `Q:` / `A:` pair is one chunk.
- Long guides are split into passages of about 900 characters.
- The price-index section is not indexed. Snapshot lines such as `Growman price … Rs 300` are removed from the text a model can see. The amounts are kept only as metadata so a test can prove they were stripped.

Startup also copies public product name, slug, tags, and short description from `GET /api/v1/products`. Prices are not copied into that text.

Search is three steps:

1. **BM25** over the chunk words (names, Indian common names, glossary, FAQs).
2. **Dense** vectors from local `BAAI/bge-small-en-v1.5` through LangChain. There is no embedding API bill. Vectors are cached on disk under `apps/ai/.cache/`.
3. **Reciprocal rank fusion** of the two lists, then LangChain `CrossEncoderReranker` with `cross-encoder/ms-marco-MiniLM-L-6-v2` on the top 20, keeping 4.

`EMBEDDING_BACKEND=hash` and `RERANK_BACKEND=overlap` skip the model download. Tests use those. Production and the Docker image use `bge` and `minilm`.

## When a model is called

Gemini Flash (`gemini-flash-latest`, low temperature, about 350 output tokens) runs only for a comparison that needs more than one passage, and only if `GEMINI_API_KEY` is set.

These never call the model:

- order, wishlist, and support replies in Go
- refusals (injection, off-topic, dosage, logged-out orders)
- a help-center answer whose question overlaps the user’s words
- price and stock, which are filled from the catalog tool
- a single care passage that already answers the question
- a repeat of the same question with no chat history, for 10 minutes (`ANSWER_CACHE_TTL_SECONDS`, Redis when `REDIS_URL` is set)

If the key is missing, the service still answers from retrieval and the catalog. It does not invent an ungrounded paragraph.

## Live price and stock

`HttpCatalog` calls the public Go API:

- `GET /api/v1/products/search?q=`
- `GET /api/v1/products/{slug}` for the rows that will be shown
- `GET /api/v1/products?pageSize=100` at startup, to name plants in the index

The reply may say `Rs 600` only when 600 is the price or MRP on that tool payload. Go then loads the slug again, so the product card uses the database price. A snapshot figure such as the October “Rs 50” for a snake plant cannot appear: it was removed from the chunk, and the output check deletes any rupee amount that was not in the tool payload.

If the catalog is down, Dootha says it cannot confirm a live price. It does not fall back to the snapshot.

## Guardrails

These are rules, not a second model.

**Input**

- Messages longer than 2000 characters are refused.
- “Ignore previous instructions”, requests for the system prompt, and requests for an API key are refused before retrieval.
- Dosage, “will this cure…”, and similar medical questions are refused. The reply says this is not medical advice.
- Cricket, elections, code, and similar topics are refused when the message is not about plants or the shop.

**Output**

- Any `Rs`, `₹`, `INR`, or “rupees” amount must match a live price from this turn.
- Care and policy answers with almost no word overlap with the retrieved text abstain: “I’m not sure from Growman’s guides.”
- A medicinal reply must contain the practitioner disclaimer used in the knowledge file.
- Product cards are only slugs the catalog tool returned. Go ignores any other name.

## Care sheets for a photo

`POST /v1/care` takes the species name, common names, and GBIF country codes. It retrieves the matching plant chunk and copies `Light`, `Water`, `Soil`, and common problems into the JSON Go already expects (`origin`, `light`, `water`, `soil`, `temperature`, `fertilizer`, `pests`, `diseases`).

If the species is not in the knowledge file and a Gemini key is set, one constrained call may fill the sheet and must not invent a precise number. With no key and no passage, the service returns 404 and Go shows the scan without a care block.

## Failure

| What failed | What the user gets |
|---|---|
| Python process down, or the secret does not match | Canned care reply from Go, plus catalog cards from the old keyword search |
| Gemini down, key missing, or the call errors | The best retrieved passage, or the abstain line. Price questions still use the catalog |
| Catalog API down | “I can’t confirm a live Growman price.” Care answers still work from the knowledge file |
| Retrieval does not match the question | “I’m not sure from Growman’s guides.” |

The RAG port is not called by the browser. Only Go sends `X-Growman-RAG-Secret`. An empty secret on the Python side rejects every answer, so the service is not accidentally open.

## Environment

Set these on **Go**:

- `RAG_SERVICE_URL` — for example `http://localhost:8090`. Empty uses canned replies.
- `RAG_SHARED_SECRET` — same value as the Python process.

Set these on **apps/ai**:

- `RAG_SHARED_SECRET`
- `CATALOG_API_URL` — default `http://localhost:8080/api/v1`
- `GEMINI_API_KEY` — optional. Omit it to run with no model spend.
- `REDIS_URL` — optional. Without it, the 10-minute answer cache is in memory.
- `EMBEDDING_BACKEND` — `bge` or `hash`
- `RERANK_BACKEND` — `minilm` or `overlap`
- `CORPUS_PATH` — default is `apps/ai/corpus/growman.txt` next to the package

Docker Compose starts the `ai` service on port 8090 and points the Go API at `http://ai:8090`. The shared secret defaults to `dev-rag-secret` for that compose file only. Set `RAG_SHARED_SECRET` in a real deployment.

## Run it locally

From `apps/ai`, with the Go API already on port 8080:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[models]"
export RAG_SHARED_SECRET=dev-rag-secret
export CATALOG_API_URL=http://localhost:8080/api/v1
export EMBEDDING_BACKEND=bge
export RERANK_BACKEND=minilm
uvicorn app.main:app --host 0.0.0.0 --port 8090
```

Point Go at it with `RAG_SERVICE_URL=http://localhost:8090` and the same secret.

Tests do not download the embedding or rerank models:

```bash
pip install -e ".[dev]"  # or: pip install -e . pytest
cd apps/ai && python -m pytest
```

The dev extra is not required; `pytest` plus the main dependencies is enough. Tests force the hash embedder and the overlap reranker.

## Reindex

Edit `apps/ai/corpus/growman.txt`, then either restart the process or:

```bash
curl -X POST http://localhost:8090/v1/reindex \
  -H "X-Growman-RAG-Secret: $RAG_SHARED_SECRET"
```

Restarting also refreshes the catalog names. Prices are never taken from the file, so a price change in the shop does not require a reindex. The catalog tool reads them on the question.

`GET /health` needs no secret. It reports how many chunks are loaded and which embedding and rerank backends are active.
