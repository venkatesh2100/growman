# Orders, checkout, and payments

Say this first: the browser never sets the price. Postgres never lets two buyers take the last plant. Razorpay can call us twice and only one call changes the order.

## Create order

`POST /api/v1/checkout/create-order` in `internal/handlers/checkout.js`.

1. Validate the address and the fulfillment channel. The channel is required because the server re-quotes delivery for that channel. Omitting it must not skip the fee.
2. Load products and sizes from Postgres. Use the row’s price. Ignore the price in the JSON.
3. Recompute coupon and store credit on the server.
4. A guest must present the email OTP proof for that address.
5. One transaction: insert the order and items, decrement stock, record the coupon.

`OrderItem` stores the name and image key from that moment. Later edits to the product do not rewrite the receipt.

Why a transaction: an order without a stock hold oversells. A hold without an order leaks stock until the sweeper. They commit together or not at all.

## Stock

`internal/handlers/inventory.js`.

```sql
UPDATE products
SET stock = stock - $1, updated_at = NOW()
WHERE id = $2 AND (track_inventory = false OR stock >= $1)
RETURNING id
```

Sizes use `product_sizes`. No returned row throws `OutOfStockError`. Checkout answers 409.

`track_inventory = false` is for items that are always available. The flag is in the `WHERE`, so the database decides, not a branch that can be skipped.

Release is also conditional: set `inventory_released = true` only when it is still false, then add the quantities back. A second release adds nothing. The abandoned-order sweeper does this after 30 minutes for `payment_status = created`, with `FOR UPDATE SKIP LOCKED` so two API replicas do not release the same order.

Alternative: reserve in Redis, commit in Postgres. Two sources of truth. A crash between them oversells or loses a hold.

## Pay

`internal/handlers/payments.js` and `webhooks.js`.

The Razorpay order is created for the server amount. The client widget only confirms. Verify and the webhook both call `markOrderPaid`.

```sql
UPDATE orders
SET payment_status = 'paid', status = 'paid', ...
WHERE id = $1 AND payment_status <> 'paid'
```

One row updated means this caller sends the email and commits inventory. Zero rows means the other path already did. The payment row is inserted with `ON CONFLICT (razorpay_payment_id) DO UPDATE`, so a replay updates the same payment instead of failing the request.

If the customer paid and the plants are already gone, the stock statements run inside a savepoint. The savepoint rolls back. The payment stays captured. Staff get a support ticket. Cancelling the payment automatically would hide a real charge.

## Two Razorpay secrets

`RAZORPAY_KEY_SECRET` signs the browser verify payload (`orderId|paymentId`). `RAZORPAY_WEBHOOK_SECRET` signs the raw webhook body. They are not interchangeable. A missing webhook secret must not mean “skip verification”. Production boot should refuse to start without both. Otherwise the catalog looks healthy and checkout is silently unsafe.

Webhook bodies are the raw bytes, mounted outside the shopper JSON parser and outside the shopper rate limit. The signature is over those bytes. Re-serializing JSON changes the signature.

`webhook_events.event_id` is unique. The insert is the lock. A duplicate key returns 200 so Razorpay stops retrying, and the handler does not apply the event again.

## Coupons, refunds, invoices

Coupons: lock the row `FOR UPDATE`, then increment `usage_count` only while it is under the cap. Per-user limits use `coupon_redemptions`, including guests matched by email.

Refunds: write the `refunds` row before calling Razorpay. A timeout must leave a local record of money that might have moved. Restock is a flag on that row so a second refund does not add the plants twice.

Invoices: the number is assigned once, on the first transition to paid, and is unique. GST is extracted from tax-inclusive catalog prices. The financial year is April–March. The PDF is rendered in `internal/services/invoice_pdf.js`.

## Cancel

`isCancellable` is false after cancel, after an airway bill, or after ship. You cannot cancel a plant that is already on a truck from the app. The status list that can cancel is pending, paid, confirmed, processing.

## Workers

| Timer | File | Why in this process |
|---|---|---|
| 5 min inventory | `inventory.js` | Unpaid holds must expire even with no traffic |
| 15 min shipments | `shipments.js` | Book courier, refresh tracking if a webhook was missed, ask for a review after delivery |
| 24 h retention | `privacy.js` | DPDP delete of expired personal data |

They share one `AbortController`. Shutdown aborts them before `database.close()`.

## Interview line

“Every contested write is one SQL statement whose row count tells me if I won. I do not lock in the application.”
