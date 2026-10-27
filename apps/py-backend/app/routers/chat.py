"""Dootha chat.

Orders, wishlist, and support are answered here, from Postgres. They never
go to the RAG service. Everything else is posted to ``POST /v1/answer``.
If that service is down or unset, the reply is a canned care answer — a
chat widget should not 500 because the model is down.

Product cards are loaded again from the catalog by slug, so the price on
the card is the live price, not a number the model wrote. The card the
widget renders is ``id``, ``name``, ``slug``, ``price``, ``imageUrl``.
"""

from __future__ import annotations

import logging
import re

import httpx
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.auth import optional_claims, parse_token
from app.models import AppNotification, ChatTurn, Order, OrderSupportRequest, Product, RequestedProduct, User, Wishlist, alive, utcnow
from app.present import image_url
from app.ratelimit import limit
from app.routers.deps import get_db

log = logging.getLogger("growman.chat")
router = APIRouter(dependencies=[Depends(limit("chat", 30, 60, fail_closed=True))])

_ORDER_ID = [
    re.compile(r"(?i)order\s*(?:#|no\.?|number|id)?\s*(\d{1,10})"),
    re.compile(r"(?i)#\s*(\d{1,10})\b"),
]
_SHORT_ORDER = re.compile(r"(?i)^(?:show\s+|list\s+|view\s+|check\s+|see\s+|get\s+)?(?:my\s+)?orders?[\s!.?]*$")
_LOOSE = re.compile(r"(?i)\b(orders?|delivery|refund|tracking|shipment|parcel)\b")


class ChatIn(BaseModel):
    message: str
    conversationHistory: list[dict] = []
    token: str = ""


def _claims(request: Request, body: ChatIn, header_claims):
    if header_claims is not None:
        return header_claims
    token = (body.token or "").strip()
    if not token:
        return None
    try:
        return parse_token(request.app.state.settings.jwt_secret, token)
    except Exception:  # noqa: BLE001 — a bad body token is just a guest
        return None


def _order_id(message: str) -> int | None:
    for pattern in _ORDER_ID:
        match = pattern.search(message)
        if match:
            return int(match.group(1))
    return None


def _care_phrase(text: str) -> bool:
    # "In order to water my snake plant" is care, not an order lookup.
    if "in order to" in text:
        return True
    return "order of" in text and any(word in text for word in ("water", "fertil", "repot"))


def _account_intent(message: str) -> str:
    lower = message.lower().strip()
    if _care_phrase(lower):
        return ""
    if any(term in lower for term in ("wishlist", "wish list", "saved items", "saved plants", "favourites", "favorites")):
        return "wishlist"
    order_terms = (
        "my order", "my orders", "order status", "order history", "track order", "track my order",
        "where is my order", "delivery status", "recent orders", "past orders", "my purchase",
        "shipment status", "order update", "track package", "track shipment", "order details",
        "order tracking", "where is my package", "where is my delivery",
    )
    if _SHORT_ORDER.match(lower) or any(term in lower for term in order_terms):
        return "order_status" if _order_id(message) else "orders"
    if _order_id(message) and any(word in lower for word in ("order", "track", "status")):
        return "order_status"
    return ""


def _support_intent(message: str) -> bool:
    lower = message.lower()
    terms = (
        "delivery support", "support for order", "escalate", "order delay", "delayed delivery",
        "late delivery", "not delivered", "need support", "help with order", "order problem",
        "order issue", "customer support", "contact support", "support team",
    )
    if any(term in lower for term in terms):
        return True
    if _order_id(message) and any(word in lower for word in ("support", "help", "delay", "delivery", "escalat", "refund", "track")):
        return True
    return "refund" in lower and "order" in lower


def _care_hint(message: str) -> dict | None:
    lower = message.lower()
    hint: dict = {}
    if "pest" in lower or "bug" in lower:
        hint["status"] = "pests"
    elif "yellow" in lower:
        hint["status"] = "yellowing"
    elif "rot" in lower or "wilt" in lower:
        hint["status"] = "wilting"
    if hint.get("status"):
        hint["suggestReminder"] = True
    if any(phrase in lower for phrase in ("balcony", "what should i buy", "recommend")) or lower.startswith("what is "):
        hint["suggestAddPlant"] = True
        if lower.startswith("what is "):
            name = lower[len("what is ") :]
            hint["plantName"] = name.split(" and ")[0][:80]
    if not hint:
        return None
    hint.setdefault("suggestReminder", False)
    hint.setdefault("suggestAddPlant", False)
    return hint


def _visible(order: Order) -> bool:
    payment = (order.payment_status or "").lower()
    status = (order.status or "").lower()
    if payment == "created" or status in {"failed", "cancelled"} or payment == "failed":
        return False
    return payment == "paid" or status in {"paid", "confirmed", "shipped", "out_for_delivery", "delivered"}


def _status_label(order: Order) -> str:
    status = (order.status or "").lower()
    labels = {
        "out_for_delivery": "Out for delivery",
        "shipped": "Shipped",
        "delivered": "Delivered",
        "confirmed": "Confirmed",
        "paid": "Confirmed",
    }
    if status in labels:
        return labels[status]
    if (order.payment_status or "").lower() == "paid":
        return "Confirmed"
    return (order.status or "Processing").replace("_", " ").title()


def _card(order: Order, base: str) -> dict:
    preview = ", ".join(f"{item.name} x{item.quantity}" for item in order.items[:3])
    image = image_url(base, order.items[0].image_key) if order.items else ""
    card = {
        "id": order.id,
        "status": _status_label(order),
        "amount": order.amount,
        "createdAt": order.created_at.strftime("%-d %b %Y") if order.created_at else "",
        "itemCount": len(order.items),
        "itemPreview": preview,
    }
    if order.expected_delivery_date:
        card["expectedDeliveryDate"] = order.expected_delivery_date.strftime("%-d %b %Y")
    if image:
        card["imageUrl"] = image
    return card


def _product_card(product: Product, base: str) -> dict:
    return {
        "id": product.id,
        "name": product.name,
        "slug": product.slug,
        "price": product.price,
        "imageUrl": image_url(base, product.image_key),
    }


def _notice(db: Session, user_id: int, title: str, body: str, href: str, dedupe: str) -> None:
    if db.scalar(select(AppNotification.id).where(AppNotification.dedupe_key == dedupe)):
        return
    db.add(AppNotification(user_id=user_id, kind="dootha", title=title, body=body[:500], href=href, dedupe_key=dedupe))


@router.post("/chat")
def chat(body: ChatIn, request: Request, db: Session = Depends(get_db), claims=Depends(optional_claims)):
    message = body.message.strip()
    if not message:
        return {"response": "Ask me about a plant, an order, or your wishlist.", "recommendedProducts": []}
    claims = _claims(request, body, claims)
    base = request.app.state.settings.image_base_url
    logged_in = claims is not None

    if _support_intent(message):
        reply, orders = _support(db, claims, message, base)
        _save(db, claims, message, reply, handoff=True)
        return {"response": reply, "recommendedProducts": [], "orders": orders, "handoff": True}

    intent = _account_intent(message)
    if not intent and logged_in and len(message) <= 80 and _LOOSE.search(message) and not _care_phrase(message.lower()):
        intent = "order_status" if _order_id(message) else "orders"
    if intent:
        if not logged_in:
            return {"response": "Please **log in** to view your orders or wishlist. Open **Account**, sign in, then ask me again."}
        reply, products, orders = _account(db, claims, intent, message, base)
        return {"response": reply, "recommendedProducts": products, "orders": orders}

    history = body.conversationHistory[-6:]
    if logged_in and not history:
        turns = db.scalars(
            select(ChatTurn).where(ChatTurn.user_id == claims.user_id).order_by(ChatTurn.created_at.desc()).limit(6)
        ).all()
        history = [{"role": turn.role, "content": turn.content} for turn in reversed(turns)]
    reply, slugs = _ask_rag(request, message, history)
    products = _by_slugs(db, slugs, base) if slugs else _search_products(db, message, base)
    _maybe_request(db, message, reply, products)
    _save(db, claims, message, reply, handoff=False)
    response = {"response": reply, "recommendedProducts": products}
    hint = _care_hint(message)
    if hint:
        response["careHint"] = hint
    return response


def _account(db, claims, intent: str, message: str, base: str):
    if intent == "wishlist":
        rows = db.scalars(select(Wishlist).where(Wishlist.user_id == claims.user_id).options(selectinload(Wishlist.product))).all()
        products = [_product_card(row.product, base) for row in rows if row.product and row.product.deleted_at is None]
        if not products:
            return "Your wishlist is empty.", [], []
        return f"You have {len(products)} saved plant{'s' if len(products) != 1 else ''}.", products, []
    wanted = _order_id(message) if intent == "order_status" else None
    query = select(Order).where(Order.user_id == claims.user_id, alive(Order)).options(selectinload(Order.items)).order_by(Order.created_at.desc())
    if wanted:
        order = db.scalar(query.where(Order.id == wanted))
        if order is None:
            return f"**Order #{wanted}** was not found on your account.", [], []
        text = f"**Order #{order.id}** — {_status_label(order)}"
        if not _visible(order):
            text = f"**Order #{order.id}** — payment is still **pending**. Complete checkout to confirm this order."
        return text, [], [_card(order, base)]
    rows = [order for order in db.scalars(query.limit(40)).all() if _visible(order)][:2]
    if not rows:
        return "You don't have any **active paid orders** right now.", [], []
    text = "Here is your **most recent active order**:" if len(rows) == 1 else "Here are your **2 most recent active orders**:"
    return text, [], [_card(order, base) for order in rows]


def _support(db, claims, message: str, base: str) -> tuple[str, list]:
    order_id = _order_id(message)
    order = None
    user = db.get(User, claims.user_id) if claims else None
    if order_id and claims:
        order = db.scalar(
            select(Order).where(Order.id == order_id, Order.user_id == claims.user_id, alive(Order)).options(selectinload(Order.items))
        )
    if claims and order_id:
        existing = db.scalar(
            select(OrderSupportRequest).where(
                OrderSupportRequest.order_id == order_id,
                OrderSupportRequest.user_id == claims.user_id,
                OrderSupportRequest.status == "pending",
            )
        )
        if existing:
            return _support_text(existing, order, True), [_card(order, base)] if order else []
    lower = message.lower()
    if "refund" in lower:
        issue = "refund"
    elif "track" in lower:
        issue = "tracking"
    elif any(word in lower for word in ("delay", "late", "not delivered")):
        issue = "delivery_delay"
    else:
        issue = "order_support"
    row = OrderSupportRequest(
        order_id=order_id,
        user_id=claims.user_id if claims else None,
        customer_name=(user.name if user else "") or (order.customer_name if order else ""),
        customer_email=(user.email if user else "") or (order.customer_email if order else ""),
        customer_phone=(user.phone if user else "") or (order.customer_phone if order else ""),
        issue_type=issue,
        priority="high",
        user_message=message[:4000],
        order_status=order.status if order else "",
        payment_status=order.payment_status if order else "",
        order_amount=order.amount if order else 0,
        order_items=", ".join(f"{item.name} x{item.quantity}" for item in order.items) if order else "",
        expected_delivery=order.expected_delivery_date.strftime("%-d %b %Y") if order and order.expected_delivery_date else "",
        status="pending",
        source="chatbot",
    )
    db.add(row)
    db.flush()
    return _support_text(row, order, False), [_card(order, base)] if order else []


def _support_text(row: OrderSupportRequest, order: Order | None, existing: bool) -> str:
    parts = []
    if row.order_id:
        parts.append(f"**Order #{row.order_id} status**")
        if row.order_status or row.order_items:
            parts.append(f"- **Status:** {row.order_status or 'Processing'}")
            if row.payment_status:
                parts.append(f"- **Payment:** {row.payment_status}")
            if row.order_amount:
                parts.append(f"- **Amount:** Rs. {row.order_amount:.0f}")
            if row.order_items:
                parts.append(f"- **Items:** {row.order_items}")
        else:
            parts.append(f"**Order #{row.order_id}** — we will verify details with our support team.")
    if existing:
        parts.append(f"Your request is **already raised with our support team** (ticket **#{row.id}**).")
    else:
        parts.append(f"Your request has been **raised to our support team** (priority ticket **#{row.id}**). We will review it within **24–48 hours**.")
    parts.append("**Support contact:** growman.live@gmail.com")
    return "\n\n".join(parts)


def _save(db, claims, message: str, reply: str, handoff: bool) -> None:
    if claims is None:
        return
    db.add(ChatTurn(user_id=claims.user_id, role="user", content=message[:4000]))
    db.add(ChatTurn(user_id=claims.user_id, role="assistant", content=reply[:4000]))
    stamp = utcnow().strftime("%Y-%m-%dT%H" if handoff else "%Y-%m-%dT%H:%M")
    if handoff:
        _notice(db, claims.user_id, "A person will follow up", "Your order question was passed to the Growman team.", "/support", "handoff:" + stamp)
    else:
        _notice(db, claims.user_id, "Dootha replied", reply[:180], "/chat", "dootha:" + stamp)


def _maybe_request(db, message: str, reply: str, products: list[dict]) -> None:
    blob = (message + " " + reply).lower()
    if products or not any(signal in blob for signal in ("exact product", "request to add", "add this product", "cannot find", "not available", "out of stock")):
        return
    quoted = re.search(r'"([^"]+)"', message)
    name = (quoted.group(1) if quoted else message).strip()[:120]
    if name:
        db.add(RequestedProduct(product_name=name, details=message[:4000], status="pending", source="chatbot_auto"))


def _fallback(message: str) -> str:
    text = message.lower()
    if any(word in text for word in ("water", "watering")):
        return "Check the top 2 cm of soil and water only when it is dry. Most indoor plants want water every 5–10 days in summer, less in the monsoon. Empty the saucer afterwards."
    if any(word in text for word in ("light", "sun")):
        return "Bright indirect light suits most houseplants. Keep them off harsh midday sun. Pothos, snake plant, and ZZ plant tolerate lower light."
    if any(word in text for word in ("yellow", "brown", "dying")):
        return "Yellow leaves often mean the pot stayed wet. Brown tips often mean dry air or salts in the soil. Trim the damaged leaf and water less until the top of the soil dries."
    if any(word in text for word in ("soil", "repot", "potting")):
        return "Use a draining potting mix, not garden soil. Repot when roots circle the pot, one size up, with a drainage hole."
    if any(word in text for word in ("fertil", "feed")):
        return "Feed monthly in spring and summer with a diluted liquid fertiliser. Pause in winter and in the monsoon while the soil stays wet."
    if any(word in text for word in ("pest", "bug", "mealy")):
        return "Isolate the plant. Wipe mealybugs off, then spray diluted neem and repeat weekly. More airflow stops most of them coming back."
    return "I can help with watering, light, soil, pests, and picking a plant. Ask about one of those, or tell me the room you want to fill."


def _ask_rag(request: Request, message: str, history: list[dict]) -> tuple[str, list[str]]:
    settings = request.app.state.settings
    if not settings.rag_service_url:
        return _fallback(message), []
    try:
        response = httpx.post(
            settings.rag_service_url.rstrip("/") + "/v1/answer",
            json={"message": message, "history": history[-6:]},
            headers={"X-Growman-RAG-Secret": settings.rag_shared_secret},
            timeout=20,
        )
        response.raise_for_status()
        body = response.json()
        return body.get("response") or _fallback(message), list(body.get("productSlugs") or [])
    except Exception as exc:  # noqa: BLE001
        log.info("rag unavailable, using canned reply: %s", exc)
        return _fallback(message), []


def _by_slugs(db, slugs: list[str], base: str) -> list[dict]:
    rows = db.scalars(select(Product).where(Product.slug.in_(slugs), Product.status == "active", alive(Product))).all()
    by_slug = {product.slug: product for product in rows}
    return [_product_card(by_slug[slug], base) for slug in slugs if slug in by_slug]


def _search_products(db, message: str, base: str) -> list[dict]:
    word = next((part for part in message.split() if len(part) >= 3), "")
    if not word:
        return []
    rows = db.scalars(select(Product).where(Product.name.ilike(f"%{word}%"), alive(Product)).limit(4)).all()
    return [_product_card(product, base) for product in rows]
