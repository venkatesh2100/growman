# Auth

Say this first: four ways to prove identity, one `users` row, one JWT shape. The route picks the middleware. The handler does not re-decode the header.

## Why four methods

Customers in India sign in with email, Google, an SMS OTP (MSG91), or Truecaller one-tap. The shop should not grow a user table per provider. `users.provider` records how they first signed in. Email and phone are unique. A later login with the same email attaches to the same row.

Alternative: a separate `identities` table. That is cleaner when one person has three emails. This shop treats email and phone as the account. A second table was not worth it yet.

## The token

`internal/auth/jwt.js` signs HS256 with `userId`, `role`, and `scope`.

| Scope | Who gets it | What it can open |
|---|---|---|
| `full` | Password, Google, finished phone, Truecaller | Orders, wishlist, profile, plants |
| `onboarding` | Phone OTP before name and profile are saved | Only `POST /auth/profile/complete` |
| admin role | `admin` or `superadmin` on a full token | Catalog writes, refunds, coupons, stock |

A missing scope is treated as `full`, so older tokens still work. `userId` is stored as a number.

Why a scope instead of a second token type: the same secret and the same middleware code can reject an unfinished signup on `/orders` without a special case in every handler.

## Which middleware, and why

| Middleware | Used on | Why |
|---|---|---|
| none | Catalog, tags, brands | Browsing is public |
| `optionalAuth` | Checkout, consent, guest order lookup | A guest proceeds. A bearer token is still read so a logged-in user is not treated as a guest |
| `onboardingAuth` | Complete phone profile | A full token must not be required before the profile exists, and a full token is the wrong scope here |
| `fullAuth` | Account routes | An onboarding token must not read someone else’s orders |
| `admin` | Product create, refunds, coupons, uploads | Role check after a valid full token |

The table is `internal/server/router.js`. If you add a route, pick the row from this table before writing the handler.

## Guest checkout proof

A guest does not have a JWT. Checkout still has to know the email was typed by that person. `verify-email-otp` stores a short-lived proof. `create-order` requires that proof for the address and email on the request. The alternative, trusting the email field, lets anyone create an order in someone else’s name.

## Password and OTP

Passwords are bcrypt hashes. `present()` drops `passwordHash` from every JSON response. OTP send is rate-limited in the auth group (20 per minute per IP) and again inside MSG91 so a script cannot spend the SMS budget. When Redis is down, that limiter still counts in the process (`strictIPRateLimiter`). Letting the request through would be fail-open on a paid API.

## Interview traps

- “Where is the session stored?” It is not. The JWT is the session. Revocation is expiry, not a server-side session list. A denylist in Redis is the alternative if you must log someone out immediately.
- “Does the RAG service see the JWT?” No. Node resolves orders and wishlist itself. Python receives the message text and a shared secret.
- “Why not put the user id in a header the client sets?” Because the client can set anything. The signature is the check.
