# Growman API

The running code is this package. Start at `app/main.py`.

One FastAPI process. A route checks the token, asks Postgres, and returns
camelCase JSON the web app already understands. Prices, stock, coupons,
and the paid transition live in `app/shop.py`. Delivery fees live in
`app/delivery.py` and do not touch the database. Redis is optional.

```bash
cd apps/py-backend
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
cp example.env .env
uvicorn app.main:app --port 8081
```

`GET /healthz` is liveness. `GET /readyz` needs Postgres. Port 8081 so the
Go API can keep 8080.

## Where each feature lives

| If they ask about | Open |
| --- | --- |
| Who is calling | `app/security.py` |
| What delivery costs | `app/delivery.py` |
| Why the charged amount is ours | `app/shop.py` `place_order` |
| Why stock cannot be oversold | `app/shop.py` `_hold` |
| Why a payment is confirmed once | `app/shop.py` `mark_paid` |
| Why a webhook retry is safe | `app/routers/webhooks.py` |
| What happens with no Redis | `app/codes.py`, `app/http.py` |
| What happens with no Razorpay key | `app/shop.py` `_razorpay` |
| The tables | `app/models.py` |

`pytest` covers those decisions without a live database.
