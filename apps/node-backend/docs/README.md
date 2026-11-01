# Node backend and Python RAG — interview docs

These notes are the production backend: the Express API in `apps/node-backend` and the FastAPI RAG service in `apps/ai`. The storefront and the Expo app call Node only. Node calls Python for Dootha.

`apps/go-backend/internal/docs` is the same shop, written for Go. Those files are the reference. They are not edited here, and that process is not what production runs. The topics below match that set, rewritten for Prisma, Express, and `apps/ai`.

The diagram is [system-design.png](./system-design.png) (and [system-design.svg](./system-design.svg) if you want to zoom). Start with [SYSTEM-DESIGN.md](./SYSTEM-DESIGN.md), then the numbered files. [12-spoken-answers.md](./12-spoken-answers.md) is the short version you can say out loud.

| Doc | What an interviewer is really asking |
|---|---|
| [SYSTEM-DESIGN.md](./SYSTEM-DESIGN.md) | Why the system is shaped this way, and what you would change at 10× traffic |
| [01-architecture.md](./01-architecture.md) | How the process boots, where each folder lives, and why there is no extra service layer |
| [02-auth.md](./02-auth.md) | Four login methods, one JWT, which middleware guards which route |
| [03-catalog-and-search.md](./03-catalog-and-search.md) | How a product page is loaded, and how search ranks a name |
| [04-caching.md](./04-caching.md) | L1, Redis, singleflight, ETag, and what is deliberately not cached |
| [05-orders-checkout-payments.md](./05-orders-checkout-payments.md) | Server-side price, stock, Razorpay, coupons, refunds, invoices |
| [06-chat-and-python-rag.md](./06-chat-and-python-rag.md) | What Node answers itself, and what it sends to Python |
| [07-images-and-storage.md](./07-images-and-storage.md) | Why the database stores a key and the URL is computed later |
| [08-middleware-and-security.md](./08-middleware-and-security.md) | Rate limits, webhook signatures, headers, health checks |
| [09-external-integrations.md](./09-external-integrations.md) | Razorpay, Shiprocket, MSG91, Truecaller, Google, Pl@ntNet, email |
| [10-database-prisma.md](./10-database-prisma.md) | Tables, soft delete, indexes, and why stock stays raw SQL |
| [11-python-rag.md](./11-python-rag.md) | Hybrid RAG end to end: BM25, BGE, RRF, rerank, guards, Gemini |
| [12-spoken-answers.md](./12-spoken-answers.md) | 60–120 second answers |

The shorter operator guide is still [../GUIDE.md](../GUIDE.md). The live API reference is Swagger and ReDoc, mounted from `internal/docs`.

## How to use these in an interview

Say the decision, then the file, then the alternative you rejected.

Example: “Stock is a conditional `UPDATE` in Postgres, in `internal/handlers/inventory.js`. I did not take a Redis lock, because a lock that fails open sells the same plant twice.”

Keep two RAG numbers apart if your resume has both. Growman Dootha is an 80% hit rate at 5 on about 60 plants. The Find Me LLC Bedrock work is Recall@5 from 60% to 90% on 100 queries. They are different systems.
