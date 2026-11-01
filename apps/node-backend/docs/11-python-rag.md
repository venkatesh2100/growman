# Python RAG (`apps/ai`)

Say this first, in one breath: Dootha retrieves with BM25 and local BGE, fuses the ranks with reciprocal rank fusion, reranks 20 chunks to 4 with a cross-encoder, and calls Gemini only to classify an unclear route or to write a comparison. Prices come from Node’s catalog HTTP API. The corpus prices are stripped.

This is Growman’s RAG, not the Find Me LLC Bedrock RAG. If both are on your resume, say the numbers once and name the system.

| | Find Me LLC | Growman Dootha (`apps/ai`) |
|---|---|---|
| Retrieval | Keyword + dense on AWS Bedrock | BM25 + BGE, RRF, MiniLM cross-encoder |
| Eval | Recall@5, 100 queries, 60% to 90% | Hit rate@5, 10 questions, 80%, ~60 plants |
| Model | Tool-calling agent, Langfuse traces | Gemini for two narrow jobs. Most replies never call it |
| Data | That product’s corpus | `apps/ai/corpus/growman.txt` plus the live catalog over HTTP |

## Why this process exists

Plant answers need embeddings and a guardrail. Checkout needs a transaction. Those failure modes should not share a process. `apps/ai` has no `DATABASE_URL`. It cannot read `orders`. Node is the only caller, and it sends `X-Growman-RAG-Secret`.

Alternative: one Python monolith for the shop. You would reimplement Razorpay and stock. Alternative: LangChain inside Node. You would ship PyTorch weights in the API container and give the model the Prisma client. Both were rejected.

## File map

| File | Why it is its own file |
|---|---|
| `app/main.py` | HTTP only. Secret check, lifespan loads models once |
| `app/ingest.py` | Chunking and price stripping. Tested without a model |
| `app/hybrid.py` | BM25, cosine, RRF, rerank |
| `app/router.py` | Regex routes. No I/O |
| `app/graph.py` | LangGraph order: guard, route, retrieve, ground, compose |
| `app/answers.py` | Templates and “copy the passage” |
| `app/guards.py` | Input refusal and rupee scrub |
| `app/llm.py` | The only Gemini calls |
| `app/catalog.py` | HTTP to Node’s public catalog |
| `app/service.py` | Answer cache and care-sheet parsing |
| `corpus/growman.txt` | The knowledge file. Not the database |

Tests inject `HashEmbedder` and `OverlapReranker` so CI does not download weights.

## Ingest, and why the prices are deleted

Sections start with a line of `=====`. A plant is `### PLANT:`. A FAQ is `Q:` / `A:`. Guides are windowed at about 900 characters. The price-index section is dropped. Rupee amounts are removed from the text a model can see and kept only as metadata so a test can prove they were stripped.

Why: an embedding of “Rs 50” will be quoted six months later. Live price is a column in Postgres, read at answer time.

Startup also indexes live product names and descriptions from `GET /api/v1/products`. Prices are not copied into that text.

## Hybrid search, why each stage

**BM25** (`rank_bm25`) finds rare tokens: `Razorpay`, `Dypsis`, `patharchatta`. It does not understand paraphrases.

**BGE** `bge-small-en-v1.5` is a bi-encoder. Chunks are embedded once and cached in `.cache/vectors.json`, keyed by a hash of chunk ids and the embedder name. The query is one vector. Cosine is a NumPy dot product. A zero vector matches nothing.

Why local weights: no embedding API bill, and the corpus fits in memory. Why not pgvector yet: about 60 plants. A vector database would be an extra service with the same neighbors.

**Reciprocal rank fusion.** BM25 scores and cosine scores are not on one scale. RRF uses rank only:

```
score(d) += 1 / (60 + rank)
```

`k = 60` stops rank 1 from crushing rank 10. A chunk in the top of both lists beats a chunk that only one list loves.

Worked example: BM25 order A, B. Dense order B, C. B wins, then A, then C.

Alternative: min-max normalize and add with a weight. That weight needs a labeled set. Ten questions cannot tune it.

**Cross-encoder** `ms-marco-MiniLM-L-6-v2` reads the query and the chunk together. It is too expensive for the whole corpus and cheap on 20 short passages. We keep 4. Those 4 are the context and the citations.

Why 20 then 4: bi-encoder is one vector plus a scan. Cross-encoder is one forward pass per candidate. Pool size is the cost knob.

`config.py` defaults to `bge` and `minilm`. The Docker image preloads those weights and its `ENV` may set `hash` and `overlap` unless the platform overrides them. Say that if someone has read the Dockerfile. The design is BGE plus MiniLM. The lightweight backends exist so tests and a cold box can boot.

## Routes, and why rules go first

`app/router.py` returns a route or `None`. Gemini’s structured output runs only on `None`. If that call throws, the route becomes `plant_care`, which still has to pass the overlap check or the bot abstains.

| Route | What is returned | Model? |
|---|---|---|
| greeting, off-topic, injection, dosage | Fixed text | No |
| orders | “Log in. I can’t see your account.” Node usually answers this before Python | No |
| product price or stock | Sentences built from `LiveProduct` | No |
| FAQ with token overlap ≥ 0.34 | The answer line, copied | No |
| care or policy with overlap < 0.2 | “I’m not sure from Growman’s guides.” | No |
| comparison (`vs`, `compare`, `difference between`) with hits | Gemini, temperature 0.2, max about 350 tokens, passages capped | Yes |
| anything else with hits | Top passage, clipped | No |

Why abstain: a made-up watering schedule kills a plant. A refusal does not.

Why not an agent loop: there is no tool the model is allowed to choose. The catalog read is ordinary Python in the `ground` node. Tool calling and Langfuse belong to the other job on the resume. Name which system you mean.

## Guards

Input, before retrieve: injection phrases, dosage and “cure my”, off-topic with no nursery word, empty and oversized messages.

Output: delete any rupee amount that is not on this turn’s catalog payload. Medicinal text always gets the practitioner disclaimer, even if the model forgot it.

The tests lock this. A payment FAQ does not set `usedLlm`. A snake plant price is the catalog price, not the corpus snapshot. A comparison that says “Rs 99999” loses that number.

## Care sheets

`POST /v1/care` retrieves on the species and common names and parses `Light:`, `Water:`, `Soil:`, `Temperature:`, `Fertilizer:`. Node caches the JSON for 14 days. If the fields are missing and Gemini is configured, one short call may write them from the passages only. No passage and no key returns 404. Node then shows the scan without a care block.

## Cache and auth

History-free answers are cached 10 minutes under `rag:v1:` plus a hash of the normalized tokens. History skips the cache because the reply can depend on earlier turns. Redis errors fall back to memory.

`Depends` on the shared-secret header runs before the body. Endpoints are sync `def` so FastAPI runs PyTorch in a threadpool. Models load in the lifespan, not on the first request.

## Eval words

- Hit rate@k: fraction of questions where at least one right chunk is in the top k.
- Recall@k: fraction of all right chunks that appear in the top k. Use this when several passages are relevant.
- MRR: mean of `1 / rank of the first hit`.

Do not swap the Growman 80% hit rate with the Bedrock Recall@5 number.

## If you did the eval again

Freeze question, expected chunk id, and split care vs policy vs exact names. Report BM25 alone, dense alone, RRF, and RRF plus rerank. The gain of hybrid search shows up on paraphrases, not on the exact plant name, which BM25 already hits.

## Python questions they attach to this code

- `secrets.compare_digest` for the shared secret. `==` can return early.
- `hashlib.sha256` for cache keys. Built-in `hash()` is salted per process and must not be a Redis key.
- Pydantic `Field(default_factory=list)` because a mutable default list is shared across requests.
- NumPy cosine: mask zero norms so you do not divide by zero.
- FastAPI `lifespan` loads weights once. Sync endpoints for PyTorch.
- Swallowed Redis exceptions are a cache miss. A bug in compose is still a 503 to Node.

## Two-minute script

“Dootha is Growman’s plant assistant. Node handles login, orders, and wishlist. Python retrieves. I chunk the nursery file by plant and strip prices. At query time I run BM25 and BGE, fuse the top 20 with reciprocal rank fusion, k equals 60, and a MiniLM cross-encoder keeps 4 passages. Rules route the question. Gemini classifies only when the rules decline, and Gemini writes only for comparisons. Prices are read from the Node catalog over HTTP, and any other rupee amount is deleted. If retrieval does not overlap the question, the bot abstains. On 10 questions the hit rate at 5 was 80 percent. Separately, at Find Me LLC, hybrid retrieval on Bedrock moved Recall at 5 from 60 to 90 on 100 queries. Those are different systems.”
