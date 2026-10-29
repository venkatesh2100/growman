# Growman API

One FastAPI process. A route checks who is calling, asks Postgres, and
returns the camelCase JSON the web app already speaks. Prices, stock,
coupons, and the single paid transition live in `app/shop.py`. Delivery
fees live in `app/delivery.py` and never touch the database.

Redis is a speed-up. If it is down, the catalog reads Postgres and login
limits fall back to a counter in this process. A missing third-party key
makes that one feature answer 503. The shop still serves.

```bash
cd apps/py-backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp example.env .env
uvicorn app.main:app --port 8081
```

`GET /healthz` does not check dependencies. `GET /readyz` needs Postgres.
Port 8081 so the Go API can keep 8080. Interactive docs are at `/docs`.

`SEED_ON_STARTUP=true` creates `admin@growman.local` / `admin12345` and one
plant, only when the users table is empty. In development, checkout works
without Razorpay keys (`order_dev_…`) and email codes are printed in the
log. Production will not boot without a long `JWT_SECRET` and both
Razorpay secrets.

## Where to look

| Question | File |
| --- | --- |
| Who is calling, and what may they do? | `app/security.py` |
| What does delivery cost? | `app/delivery.py` |
| Why is the charged amount ours? | `app/shop.py` `place_order` |
| Why can stock not be oversold? | `app/shop.py` `_hold` |
| Why is a payment confirmed once? | `app/shop.py` `mark_paid` |
| Why is a webhook retry safe? | `app/routers/webhooks.py` |
| What if Redis is down? | `app/codes.py`, `app/http.py` |
| The tables | `app/models.py` |

```bash
pytest
```

Those tests cover the money and delivery decisions, not a live Postgres.
