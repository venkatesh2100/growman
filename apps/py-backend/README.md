# Growman API — Python
#
# Same system as `apps/go-backend`: one process, handlers that talk to
# Postgres directly, an optional Redis cache, and three background workers.
# Read the comments in the modules below before the route files. They are
# the design, not a restatement of the syntax.

## Run it

```bash
cd apps/py-backend
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp example.env .env
# edit DATABASE_URL
uvicorn app.main:app --reload --port 8081
```

`GET http://localhost:8081/healthz` is liveness (no database).
`GET http://localhost:8081/readyz` is what an orchestrator should use.
Docs are at `http://localhost:8081/docs`.

With `SEED_ON_STARTUP=true` the database gets a few plants and
`admin@growman.local` / `admin12345`.

In development, checkout works without Razorpay keys: the order id is
`order_dev_…` and payment signatures are not checked. Production refuses
to boot without `JWT_SECRET`, `RAZORPAY_KEY_SECRET`, and
`RAZORPAY_WEBHOOK_SECRET`. Leave SMTP unset in development and the email
OTP is printed in the server log so you can finish a guest checkout.

## Where to read

| File | What it teaches |
|---|---|
| `app/main.py` | Boot, shutdown, middleware. Workers start before the listener. |
| `app/config.py` | Optional integrations. Production fails closed on payment secrets. |
| `app/models.py` | The schema. Snapshots, image keys, unique indexes as locks. |
| `app/cache.py` | In-process cache, then Redis, one database load per stampede. |
| `app/auth.py` | JWT scope. Onboarding tokens cannot read orders. |
| `app/ratelimit.py` | Catalogue reads fail open. Login and checkout fail closed. |
| `app/fulfillment.py` | Pure delivery rules. No database, no HTTP. |
| `app/inventory.py` | Reserve, commit, release. The check is inside the `UPDATE`. |
| `app/coupons.py` | The server prices the discount. The cap is a conditional update. |
| `app/payments.py` | One paid transition, even if verify and the webhook both arrive. |
| `app/routers/checkout.py` | The only way to start a payment. |
| `app/privacy.py` | Scrub now, keep the minimised order, delete it after a year. |
| `app/workers.py` | Abandoned stock, courier booking, retention. Same process. |

There is no repository or service layer. A handler opens a SQLAlchemy
session and queries it. Shared queries live as functions (`inventory.py`,
`coupons.py`) the same way the Go code shares `query.go`.

## Tests

```bash
pytest
```

They cover the decisions above, not a live Postgres.
