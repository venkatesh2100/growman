# Interview guide: Growman and Dootha hybrid RAG

Use this before an interview. Speak from the resume bullets, then back every claim with the code in `apps/ai`. Two RAG systems appear on the resume. Keep their numbers separate.

| | Find Me LLC (job) | Growman / Dootha (this repo) |
|---|---|---|
| Stack | LangChain, AWS Bedrock, PostgreSQL, Redis | FastAPI, LangGraph, local BGE, BM25, Gemini, Go catalog API |
| Retrieval | Semantic + keyword | BM25 + dense cosine, fused with RRF, then a cross-encoder |
| Eval you can quote | Recall@5 from 60% to 90% on 100 queries | 80% hit rate@5 on 10 hand-written questions, ~60-plant corpus |
| Tracing | Langfuse (latency and token cost) | Answer cache in Redis; `usedLlm` on every reply |
| What the model is allowed to do | Agentic tool calling | Almost nothing. Prices come from the catalog. The model runs only for comparisons, and as a route fallback |

---

## 1. Ninety-second pitch for Growman

Growman (`growman.live`) is a live plant shop I built and operate. Customers browse a Next.js storefront, pay with Razorpay, and use an Expo Android app (300+ downloads). The commerce API is Go, with 30+ PostgreSQL models. A separate Python FastAPI service, Dootha, answers plant-care and shopping questions. Dootha never opens the database. The shop calls it with a shared secret.

The hard parts I want to be asked about:

- **Hybrid RAG.** BM25 and local BGE embeddings, fused with Reciprocal Rank Fusion, then a cross-encoder that cuts the pool from 20 chunks to 4. A LangGraph router tries rules first and calls Gemini only when every rule declines.
- **Prices stay live.** Corpus prices are stripped at ingest. The reply’s rupee amounts come from the Go catalog on that turn, and a scrubber deletes any other amount.
- **Stock under concurrency.** The last unit is reserved with one atomic conditional `UPDATE`. The loser gets HTTP 409. A 30-minute hold returns stock from an abandoned checkout.
- **Payments.** Razorpay with server-side pricing, HMAC webhook verification, and idempotent webhook handling.
- **Auth.** Email, Google, MSG91 OTP, and Truecaller one-tap collapse into one scoped JWT. Rate limits fail closed.
- **Catalog latency.** In-process L1 and Redis L2, singleflight so a stampede shares one fetch, per-resource TTLs, and `ETag`/`304`. If Redis is down, L1 still serves. Measured p95 of 45 ms at 100 req/s.

### How to draw the system

```
Android (Expo)          Next.js storefront (Cloudflare Workers)
        \                         /
         \                       /
          Go / Node commerce API  (Cloud Run)
          PostgreSQL + Redis
          Razorpay, Shiprocket, Pl@ntNet, MSG91, Truecaller
                    |
                    |  X-Growman-RAG-Secret
                    v
          Python FastAPI  (Dootha RAG)
          corpus/growman.txt  +  live catalog over HTTP
          BM25 + BGE + RRF + MiniLM reranker
          Gemini only for route fallback and comparisons
```

Say this if they ask why the RAG service is separate: the model process must not read orders, users, or Postgres. It sees the public catalog over HTTP and a curated text file. A prompt injection cannot become a database query.

---

## 2. Walk the resume bullets (what to say, what they will poke)

### System design

**Say:** Go owns commerce and identity. Python owns retrieval and answers. Next.js is on Cloudflare Workers, the API is on Cloud Run, and the app is Expo. The RAG process authenticates with `secrets.compare_digest` on `X-Growman-RAG-Secret`. An empty secret rejects every call.

**They will poke:** Why not one service? Why not give the RAG service a DB role?

**Answer:** Blast radius and data. Care answers and price answers have different failure modes. If Gemini is down, policy FAQs still answer from retrieved text. If the catalog API is down, the last good listing stays in memory (`HttpCatalog.refresh` returns the previous list on `httpx.HTTPError`). Orders are refused in the RAG service on purpose: “Please log in… I can’t see your account from here.”

### Hybrid RAG (Dootha)

**Say the pipeline in this order.** Interviewers listen for the order.

1. **Ingest.** `corpus/growman.txt` is split on `=====` section headers. Plant blocks start at `### PLANT:`. FAQs are `Q:` / `A:` pairs. Guides are windowed at 900 characters. Rupee amounts are removed from model-visible text and kept only as `snapshot_prices` metadata. The price-index section is dropped entirely. Live product names and descriptions are added as `kind=catalog` chunks, still without prices.
2. **Index.** `BM25Okapi` over a light stemmer (`ing` / `ed` / `es` / trailing `s`). Dense vectors from `BAAI/bge-small-en-v1.5` via LangChain `HuggingFaceEmbeddings`. Vectors are cached in JSON, keyed by a SHA-256 of chunk ids plus the embedder name, so a corpus edit rebuilds them and a restart does not.
3. **Retrieve.** Query is scored by BM25 and by cosine similarity. Each list keeps its top 20 ids with score `> 0`. Reciprocal Rank Fusion merges them: `score(d) += 1 / (60 + rank)`.
4. **Rerank.** `cross-encoder/ms-marco-MiniLM-L-6-v2` through LangChain `CrossEncoderReranker`, `top_n=4`. The cross-encoder reads the query and the chunk together. BM25 and cosine never do that.
5. **Route.** Regex rules run first (`policy`, `product_discovery`, `medicinal`, `plant_care`, greeting, orders). Gemini structured output runs only when every rule returns `None`. If that call throws, the route becomes `plant_care`.
6. **Ground.** Product questions call the catalog tool. Care and policy answers copy a retrieved passage. The model is called only when the question is a comparison (`vs`, `versus`, `compare`, `difference between`) and retrieval actually returned hits.
7. **Guard the output.** Any rupee amount not present on this turn’s product payload is deleted. Medicinal routes always end with the practitioner disclaimer.

**Eval sentence, say it once:** On a ~60-plant corpus I checked 10 questions and got an 80% hit rate at 5. Hit means the right plant or FAQ chunk is in the top 5. The set is small because the corpus is small; I would not quote this number next to a 100-query Bedrock benchmark.

**Code map if they ask “show me”:**

| Step | File |
|---|---|
| Chunking and price strip | `app/ingest.py` |
| BM25, cosine, RRF, rerank | `app/hybrid.py` |
| Rules | `app/router.py` |
| LangGraph | `app/graph.py` |
| Reply composition | `app/answers.py` |
| Input and price guards | `app/guards.py` |
| Gemini classifier and synthesizer | `app/llm.py` |
| Catalog HTTP client | `app/catalog.py` |
| Cache and `/v1/care` | `app/service.py` |
| Auth and routes | `app/main.py` |

**Honest detail about backends.** `config.py` defaults to `embedding_backend=bge` and `rerank_backend=minilm`. Tests inject `HashEmbedder` and `OverlapReranker` so CI never downloads weights. The Docker image preloads both models, and its `ENV` currently sets `EMBEDDING_BACKEND=hash` and `RERANK_BACKEND=overlap` unless Cloud Run overrides them. If they have read the Dockerfile, say that plainly: the design is BGE + MiniLM; the container can boot on the lightweight backends; the weights are already in the image.

### Plant ID

**Say:** A photo goes to Pl@ntNet. The free tier is 500 images per day, so the handler is quota-aware and the plant route is rate-limited (the API docs use 20 requests per minute, fail closed). The species name, common names, and GBIF origin countries are sent to `POST /v1/care`. Dootha retrieves care chunks and parses `Light:`, `Water:`, `Soil:`, `Temperature:`, `Fertilizer:` lines. If those fields are missing and Gemini is configured, it writes a short sheet from the passages only. The shop caches that sheet for 14 days.

### Two-layer cache

**Say:** L1 is in-process. L2 is Redis. Singleflight means concurrent misses for the same key share one upstream call. Each resource has its own TTL. Responses carry an `ETag`; a matching `If-None-Match` returns 304. Redis errors fall through to L1, they do not fail the request. I measured p95 catalog latency of 45 ms at 100 req/s.

**Dootha’s own cache is smaller.** `DoothaRAG.answer` caches a reply for 600 seconds only when there is no chat history. The key is `rag:v1:` plus the SHA-256 of the normalized tokens. History-bearing turns skip the cache because the reply can depend on prior turns. Redis failure falls back to an in-process `MemoryCache`.

### Payments and stock

**Say:** The client never sends the price we charge. The server prices the cart. Razorpay webhooks are verified with HMAC and handled idempotently, so a retry does not double-apply. Stock reservation is one conditional update: `UPDATE … SET reserved = reserved + 1 WHERE id = ? AND stock - reserved >= 1`. Zero rows updated means someone else took the last unit, and that buyer gets 409. A reservation expires after 30 minutes and the stock returns.

**They will poke:** Why not `SELECT` then `UPDATE`? Because two transactions can both see `stock = 1`. The condition has to live in the same statement that writes.

### Authentication and delivery

**Say:** Four login methods (email, Google, MSG91 OTP, Truecaller one-tap) mint the same scoped JWT shape, so handlers do not care how the user proved identity. Rate limits fail closed: if the limiter store is down, the request is rejected, not allowed through. Baseline is 250 requests per minute per IP. Delivery quotes use distance from the dispatch point plus Shiprocket serviceability. If that lookup fails, a static fee is quoted so checkout still completes.

---

## 3. How hybrid RAG works (the explanation to give)

### Why hybrid at all

Dense retrieval finds paraphrases. “Leaves going yellow in the monsoon” can match a chunk that says “overwatering causes chlorosis” even when the words differ. BM25 finds rare exact tokens: `Razorpay`, `Dypsis lutescens`, `patharchatta`, a pot size. Each method fails on the other’s easy cases. Hybrid search runs both and merges the lists.

### BM25, in one minute

BM25Okapi scores a document by how often the query terms appear, damped so a term repeated 20 times is not 20 times more useful, and weighted by inverse document frequency so `tulsi` beats `water`. It does not understand synonyms. In this service the text is lowercased, split on `[a-z0-9]+`, and lightly stemmed before it is indexed (`app/textutil.py`).

### Dense retrieval, in one minute

`bge-small-en-v1.5` maps a string to a vector (384 dimensions). At index time every chunk is embedded once. At query time only the question is embedded. Cosine similarity is the dot product divided by both L2 norms. A zero query vector returns zeros, so an empty query cannot match everything. Scores `<= 0` are dropped before fusion, so a chunk has to beat a zero baseline to enter the pool.

BGE is a bi-encoder: the query and the document are encoded separately. That is cheap at query time (one embedding, then a matrix-vector multiply) and weaker than a model that reads both texts together.

### Reciprocal Rank Fusion

BM25 scores and cosine scores are not on the same scale. A BM25 score of 12 and a cosine of 0.82 cannot be added. RRF ignores the raw scores and uses rank:

```
RRF(d) = sum over lists of  1 / (k + rank_d)
k = 60
```

Rank 1 contributes `1/61 ≈ 0.0164`. Rank 20 contributes `1/80 = 0.0125`. A document in the top of both lists beats a document that only one list loves. `k = 60` is the Cormack et al. constant; it keeps rank 1 from crushing rank 10. The implementation is `_rrf` in `app/hybrid.py`.

Work a tiny example out loud:

- BM25 order: chunk A, chunk B
- Dense order: chunk B, chunk C
- A: `1/61`
- B: `1/62 + 1/61`
- C: `1/62`
- Fused order: B, A, C

### Cross-encoder rerank

The fused list is 20 chunks. MiniLM-L-6 (`ms-marco`) scores each pair `(query, chunk)` with a model that attends across both. That is too expensive to run on the whole corpus and cheap enough on 20 short nursery chunks. We keep 4. Those 4 become the context, the citations, and the input to the comparison prompt.

Say the cost shape: bi-encoder is O(1) model calls per query plus a vector scan; cross-encoder is O(pool) forward passes. Pool size is the knob.

### What “hit rate@5” and “Recall@5” mean

- **Hit rate@k:** fraction of questions where at least one correct chunk appears in the top k. One relevant chunk is enough.
- **Recall@k:** fraction of all relevant chunks that appear in the top k. Use this when a question has several right passages.
- **MRR:** mean of `1 / rank_of_first_hit`. Rewards putting the hit at rank 1, not just somewhere in the top 5.

Find Me LLC: Recall@5, 100 queries, 60% to 90% after adding keyword retrieval beside dense retrieval on Bedrock. Growman: hit rate@5, 10 questions, 80%, on a 60-plant corpus. If you swap the numbers, the interviewer will notice.

### Where the LLM sits (this is the part that sounds senior)

Most Dootha replies never call Gemini.

| Route | What is returned | Model? |
|---|---|---|
| greeting, off-topic, injection, dosage | Canned text | No |
| orders / wishlist | “Log in. I can’t see your account.” | No |
| product price / stock | Sentences built from `LiveProduct` | No |
| policy or care with a strong FAQ hit (token overlap ≥ 0.34) | The FAQ answer | No |
| care or policy with weak overlap (`support` < 0.2) | Abstain | No |
| comparison with hits | Gemini, temperature 0.2, max 350 output tokens, passages capped at 6000 chars, “do not mention prices” | Yes |
| everything else with hits | The top passage, clipped to ~700 chars | No |

Abstaining is a feature. A nursery bot that invents a watering schedule is worse than one that says it is not sure.

### Guardrails, said as a design

Three layers, all rules:

1. **Input.** Prompt-injection phrases, dosage / “cure my” language, and off-topic queries with no nursery word are refused before retrieve. Empty and oversized messages stop there too.
2. **Routing.** Orders never reach retrieval. Medicinal plant names take the medicinal route, which forces a disclaimer.
3. **Output.** `scrub_prices` deletes rupee amounts that are not in the live product payload. A comparison the model writes as “it costs Rs 99999” loses that amount. Medicinal text gets the disclaimer even if the model forgot it.

The tests in `tests/test_rag.py` lock this: payment FAQ does not call the model, snake-plant price is the catalog price (600) and not the corpus snapshot (50), dosage is refused, injection is refused, a comparison calls the synthesizer and the invented price is stripped.

---

## 4. LangGraph, in the order the nodes run

```
guard
  ├─ refusal already set → output_guard → END
  └─ route
        ├─ greeting / orders / off_topic → compose → output_guard → END
        └─ retrieve → ground → compose → output_guard → END
```

- `guard` — `inspect_input`
- `route` — rules, then Gemini classifier, then default `plant_care`
- `retrieve` — `index.retrieve(message, top_n=4, pool=20)` and citation metadata
- `ground` — catalog products for discovery; one matching product card for care when the question names the plant
- `compose` — `answers.compose`
- `output_guard` — price scrub, disclaimer, up to 3 product slugs

State is a `TypedDict`: message, history, route, hits, products, response, used_llm, product_slugs, citations.

If they ask “why LangGraph and not a function?”, say: the branch is the product. Refusals must skip retrieval. Greetings must skip the model. The graph makes that path visible and testable. It is a router with a state object, not an open-ended agent loop. There is no tool-calling loop in Dootha. Tool calling and Langfuse belong to the Find Me LLC work. Say that before they blend the two projects.

---

## 5. RAG questions, with answers from this project

**What is RAG?**
Retrieval-augmented generation fetches passages from your data and asks the model to answer from those passages. In Dootha the “generation” step is usually skipped: we return the passage or a catalog sentence. Retrieval is still the system.

**Chunking strategy?**
Structure-aware, not a blind token window. Sections, then plant entries, then FAQ pairs, then paragraph windows of 900 characters. Each plant chunk repeats the plant name because a chunk has to make sense alone. Prices are stripped so the model cannot quote a stale snapshot.

**Why not embed the whole catalog row including price?**
Price and stock change. An embedding index would be wrong until the next reindex. `POST /v1/reindex` rebuilds chunks and vectors; the shop still treats the catalog HTTP API as the only source for a number we show a customer.

**How do you stop hallucinations?**
Retrieve, require token overlap before trusting a passage, copy FAQ answers verbatim, call the model only for comparisons with the instruction “if the passages do not say it, say you are not sure”, and delete prices the catalog did not return. Dosage questions never reach the model.

**Bi-encoder vs cross-encoder?**
Bi-encoder embeds each side alone. You can precompute document vectors. Cross-encoder scores the pair. Better ranking, no precompute, so it runs on a shortlist. Dootha uses BGE as the bi-encoder and MS MARCO MiniLM as the cross-encoder.

**Why RRF instead of a weighted sum of normalized scores?**
Min-max normalizing BM25 against cosine needs a tuning weight and breaks when one list is empty or all scores are similar. RRF has one constant, `k=60`, and only needs ranks. I would switch to a learned weight only if I had a labeled set big enough to tune it. Ten questions is not that set.

**What is in the prompt?**
System: you are Dootha, answer only from the passages, no prices, at most 110 words, markdown, medicinal routes must end with the disclaimer. Human: route, question, passages. History is accepted by the API and trimmed to 6 turns of 500 characters, and the synthesizer currently ignores history. Say that if they read `llm.py`. The classifier is a second, smaller call: temperature 0, max 40 tokens, structured output constrained to the route enum.

**How is the service authenticated?**
Shared secret header, compared with `secrets.compare_digest` so the check does not leak the secret through timing. The browser never calls this process. Go/Node does, with a 20 second timeout, and falls back to canned replies if the status is not 200.

**How would you evaluate properly if you did it again?**
Freeze a golden set of questions with the chunk id that must appear. Report hit rate@5 and MRR for BM25 alone, dense alone, RRF, and RRF+rerank, so the gain of each stage is visible. Split care, policy, and exact-name queries, because hybrids look good on exact names and the gain shows up on paraphrases. The Find Me LLC result (Recall@5, 100 queries, 60 to 90) is that kind of comparison: keyword retrieval added to dense retrieval.

**Failure modes you should volunteer.**

- BM25 and dense can both miss a paraphrase that uses none of the chunk’s tokens and sits far in vector space. The abstain path covers that.
- The stemmer is crude (`watering` → `water` by stripping `ing`). It will also mangle some tokens. It is good enough for this corpus and it is not Porter.
- Catalog search and the vector index can disagree on which plant was meant. Prices still come from the catalog tool, not from the chunk.
- Caching answers for 10 minutes can serve a stale care sentence. It does not cache prices across a catalog change inside a history-free identical question. Mention the TTL if they push.
- The classifier can mis-label when rules decline. The default on exception is `plant_care`, which then has to pass the support check or abstain.

**Agentic workflows (Find Me LLC, not Dootha).**
An agent is a loop: the model chooses a tool, the runtime executes it, the observation goes back, until a stop condition. I used that for multi-step portfolio work, with Langfuse traces per run so a failure shows which tool, how many tokens, and where the latency sat. Dootha is deliberately not that loop. The catalog “tool” is ordinary Python called by the `ground` node. I can talk about both, and I name which system I mean.

---

## 6. Python questions they can ask from this code

Answer in the shape: concept, then the line in Dootha where it matters.

**Mutable default arguments.**
`def f(items=[])` shares one list across calls. Pydantic models in `main.py` use `Field(default_factory=list)` for `history` and `commonNames`. In `HybridIndex`, `tokenized = [tokenize(chunk.text) or ["empty"] for chunk in chunks]` builds a new `"empty"` list per chunk via the `or` expression inside the comprehension, so chunks do not share one sentinel by accident. Know the classic bug anyway.

**`secrets.compare_digest`.**
String `==` can return early on the first differing character. `compare_digest` compares in constant time. Used for the RAG shared secret. It still requires the expected secret to be non-empty; an empty configured secret is a rejection, not a match.

**Hashing for cache keys.**
`hashlib.sha256` of normalized tokens for the answer cache, and of chunk ids plus embedder name for the vector cache. Python’s built-in `hash()` is salted per process and must not be used for a cache that lives in Redis or on disk.

**Cosine similarity with NumPy.**
`norms * qnorm` is the denominator. A mask skips zero vectors so we do not divide by zero. `@` is matrix-vector multiply. This is the entire “vector database” : a NumPy array in memory. Say why that is acceptable: the corpus is about 60 plants plus help-center sections, not millions of chunks. A vector DB would add an operational component without changing retrieval quality at this size.

**`dataclass`.**
`Chunk` and `LiveProduct` are dataclasses. `snapshot_prices: list[str] = field(default_factory=list)` avoids a mutable default. `as_dict` is the boundary to JSON-ish state inside the graph.

**Type hints and `from __future__ import annotations`.**
Annotations are stored as strings, so a hint can refer to a class that is not imported at runtime (useful for the `Chunk` type in signatures). `list[str] | None` is the 3.10+ union. The project requires Python ≥ 3.11.

**FastAPI: `def` vs `async def`, `Depends`, lifespan.**
`answer` and `care` are sync `def` endpoints. FastAPI runs them in a threadpool, which is what you want when the body calls PyTorch and Redis. `Depends(require_secret)` runs the header check before the body. The `lifespan` context manager loads the embedder, reranker, catalog, and graph once per process, not once per request. Models must not load inside the request.

**Pydantic settings.**
`BaseSettings` reads environment variables and `.env`. `extra="ignore"` drops unknown keys. Field names map to env vars (`embedding_backend` → `EMBEDDING_BACKEND`).

**Exceptions you swallow on purpose.**
Redis `get`/`set` return `None` / return on any exception so a cache outage becomes a miss, not a 500. Catalog `refresh` keeps the last good list. The classifier’s exception becomes “rules declined”. The HTTP handler still turns an unexpected exception into 503 `rag unavailable`. Be ready to defend each swallow: cache and catalog degradation are isolated; a bug in compose is not hidden from the caller.

**`httpx` vs a live catalog.**
`HttpCatalog` paginates `/products` until `hasNext` is false, at most 20 pages. Search prefers the API and falls back to token overlap on the cached listings. `by_slug` does the same. Timeout is 5 seconds.

**Regex routing.**
Order matters. Greeting is anchored (`^…$`) so “hello, how do I water tulsi” is not a greeting. `in order to water` must not match the order/parcel rule; `PLANT_CARE_ORDER_RE` is checked first. “How much is delivery?” is policy. “How much is the snake plant?” is product discovery because a plant name plus a price word overrides the policy rule. Walk those three tests from `test_rules`. They are the bugs the regex exists to prevent.

**Dict `get` and `TypedDict`.**
Graph state uses `.get` because every key is optional (`total=False`). Missing `response` means “not refused yet”.

**JSON cache invalidation.**
Vector cache stores `{digest, backend, vectors}`. A changed chunk id or embedder name misses. A corrupted file is caught (`OSError`, `JSONDecodeError`) and recomputed.

**GIL, only if they push.**
The heavy work is NumPy and PyTorch, which release the GIL during native ops. The FastAPI app is still one process in the uvicorn command in the Dockerfile (`uvicorn app.main:app`, no `--workers`). Concurrency is threads for sync endpoints plus the model’s own threads. I would add workers only after measuring memory, because each worker loads BGE and MiniLM.

**Testing without the model.**
`HashEmbedder` maps tokens into a 64-d bag with SHA-256. `OverlapReranker` sorts by the same `support()` overlap the guards use. `StaticCatalog` replaces HTTP. `FakeSynth` returns a string with a fake price so the scrubber test does not need Gemini. This is the design I would describe if they ask how I test an LLM app.

**Other Python basics to review the night before.**

- LEGB scope, closures (the `classify` function closes over the LangChain chain).
- `is` vs `==`. Use `is` for `None`.
- Deep vs shallow copy. `listings()` returns `list(self._listings)`, a shallow copy of the list.
- Generators vs lists. Ingest builds real lists because they are indexed and embedded.
- `*args` is unused here. Know it anyway.
- Context managers: `@asynccontextmanager` on `lifespan`, and `httpx.Client`.
- f-strings, `str.join`, slicing `history[-6:]`.
- `try/except/else/finally` and `raise HTTPException(...) from exc` (exception chaining).
- Modules, packages, `pythonpath = ["."]` in pytest so `import app` works.
- Dataclasses vs Pydantic: dataclass for internal records, Pydantic for HTTP bodies and settings.

---

## 7. A two-minute hybrid RAG script you can memorize

“Dootha is Growman’s plant assistant. The knowledge base is a structured text file of about 60 plants plus the help center, chunked by section and plant, with prices stripped so the model cannot quote a stale number. At query time I run BM25 and a local BGE bi-encoder. I fuse the two top-20 lists with reciprocal rank fusion, k = 60, because the scores are not comparable. A MiniLM cross-encoder reranks that pool to 4 passages. A rule router handles greetings, orders, prices, policy, medicinal plants, and care. Gemini classifies only when the rules decline, and Gemini writes a reply only when the user asks for a comparison. Prices and stock are read from the Go catalog over HTTP at answer time, and any other rupee amount is scrubbed. If retrieval does not overlap the question, the bot abstains. On 10 questions that hit rate at 5 was 80 percent. Separately, at Find Me LLC I did hybrid retrieval on Bedrock and moved Recall at 5 from 60 to 90 on 100 queries, with Langfuse on the agent traces. Those are different systems.”

---

## 8. Questions to ask them

- How do you label a retrieval golden set, and who owns it when the corpus changes?
- Do you rerank, and what pool size are you willing to pay for?
- Where is the model allowed to speak, and where must the answer be a tool result?
- What do you trace per request: retrieval ids, token cost, or only the final answer?
