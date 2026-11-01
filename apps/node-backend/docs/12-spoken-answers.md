# Spoken answers

Use these as the first 60–90 seconds. Then stop and let them pick a branch. The longer version of each topic is the numbered doc.

## The whole system

Growman is a plant shop. The web app and the Android app talk only to a Node API. That API owns users, catalog, stock, and Razorpay, in Postgres, through Prisma. Redis caches catalog reads and counts rate limits. A separate Python service, Dootha, answers plant questions. It has no database password. Node calls it with a shared secret. I kept the model out of the commerce process so a prompt cannot read orders.

## Why not microservices

Checkout is one transaction: the order row, the stock decrement, and the coupon. Splitting those across services means a saga and a new way to oversell. I did split the thing that fails differently, which is the RAG process. It can be down and the shop still sells plants.

## Last plant in stock

The update itself checks `stock >= quantity` and returns a row only when it wins. The other buyer gets 409 and the transaction rolls back. I did not use a Redis lock. If Redis is down, a lock either blocks every checkout or allows the oversell. Postgres is already the source of truth.

## Why the client price is ignored

The browser is not a pricing service. The handler loads the product row and charges that price, plus a delivery quote the server recomputes. The Razorpay order is created for that amount. The webhook checks a different secret than the browser verify call, both on the raw bytes they actually signed.

## Cache

Catalog GETs hit an in-process map, then Redis, then one database load shared by every concurrent miss. TTLs are minutes, and an admin write deletes the keys. I do not cache checkout or a single order. Redis errors are a miss, not a 500.

## Auth

Email, Google, MSG91 OTP, and Truecaller all write the same user row and the same JWT. The token has a scope. An unfinished phone signup cannot open orders. Admin is a role on a full token. Guests get a short-lived email proof instead of a JWT, and checkout requires it.

## Dootha

Node answers wishlist and order status from Postgres for the logged-in user. Other questions go to Python. Python runs BM25 and BGE, fuses ranks with reciprocal rank fusion, reranks 20 down to 4, and calls Gemini only for an unclear route or a comparison. Prices are a catalog HTTP call. Corpus rupees are stripped, and any other rupee in the reply is deleted. Weak overlap abstains.

## Hybrid RAG, if they ask “why not just embeddings”

Dense search misses exact tokens like a botanical name or “Razorpay”. BM25 misses paraphrases. The scores are not comparable, so I fuse ranks, not raw scores. The cross-encoder is more accurate and too expensive to run on every chunk, so it only sees the shortlist.

## Prisma

The schema is `prisma/schema.prisma`, mapped onto the existing snake_case columns. Handlers still call `findAll` and `update`. Those go through Prisma. The stock statements stay SQL because I need the row count from a conditional update. Partial indexes also stay SQL, because Prisma cannot express `WHERE deleted_at IS NULL` on an index.

## What you would scale first

Catalog reads, with the cache and a CDN. Not the stock update. If chat traffic grows, scale the Python service on its own. If the corpus leaves the tens or hundreds of chunks, move vectors to pgvector. I would not add a queue for the 5-minute stock sweep until a deploy gap actually loses abandoned orders.

## A question to ask them

Where is the model allowed to speak, and where must the answer be a tool result? That is the line I drew between Node and Python.
