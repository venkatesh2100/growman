# External integrations

Say this first: every third party is optional at boot except Postgres. Each client returns a clear 503 or a fallback when its credentials are empty. Razorpay is the exception in production: both secrets should be required or the process should not listen.

## Razorpay

Two secrets, two messages.

| Secret | Signs | Checked in |
|---|---|---|
| `RAZORPAY_KEY_SECRET` | `order_id|payment_id` from the browser | `payments.js` verify |
| `RAZORPAY_WEBHOOK_SECRET` | Raw POST body | `webhooks.js` |

Events that matter: `payment.captured` moves the order to paid once. `payment.failed` releases stock once. Refund events update the `refunds` row that was written before the API call. Unknown events are acknowledged so Razorpay does not retry forever, and they are stored on `webhook_events` for a human.

Why Razorpay and not Stripe: Indian UPI, cards, and netbanking on one order id, and the shop’s customers already pay that way.

## Shiprocket

`internal/shiprocket` logs in with email and password, caches the token, and asks serviceability for a pincode. `internal/fulfillment` turns distance and the courier answer into a channel: pickup, courier, own vehicle, or bulk quote. If Shiprocket is down or unconfigured, the quote uses static fee bands so checkout still completes. Booking a shipment is skipped when the client is null. The 15-minute worker is the backstop when a tracking webhook is missed.

Alternative: only the static fee. Simpler, and wrong for a pincode the courier does not serve. The shopper would pay and then get a support ticket. The serviceability check exists to say no before payment.

## MSG91

OTP SMS. Throttled in `internal/msg91/throttle.js` as well as the auth rate limit, because the bill is per message. Phone numbers are normalized to the Indian 10-digit form in `internal/phoneutil` before lookup, so `+91`, `0`, and `91` hit the same user.

## Truecaller

One-tap login. The client exchanges the Truecaller payload for a verified phone, then `findOrCreate` on that phone. Same `users` row as OTP.

## Google

`google-auth-library` checks the ID token against `GOOGLE_CLIENT_ID`. The email is trusted only after that check. Matching email attaches to the existing user instead of creating a duplicate.

## Email

SMTP in `internal/services/email.js`. Order mail, OTP, invoices, abandoned checkout, back-in-stock. If SMTP is empty, the handler logs and the order still exists. Mail is not inside the payment transaction. A slow Gmail must not roll back a captured payment.

## Pl@ntNet

Photo to species. Quota is 500 images a day on the free key. Node tracks the remainder and refuses when it is spent. Care text is a second call, to Python, and is cached 14 days so a popular species does not call Gemini or the retriever on every scan.

## Discord and Cloudflare

Discord is an optional webhook for shop alerts (abandoned checkout, support). Cloudflare Analytics feeds the admin map of request volume by region. Neither is on the checkout critical path.

## Gemini

Lives in `apps/ai`, not in Node. Node does not hold `GEMINI_API_KEY` for Dootha. If the key is absent, Python still answers from retrieval. See [11-python-rag.md](./11-python-rag.md).

## Interview line

“Integrations fail soft, except payment verification, which fails closed. I can name which secret signs which bytes.”
