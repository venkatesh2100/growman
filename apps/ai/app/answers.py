"""Turn a route plus retrieved passages and live products into a reply.

Price and stock sentences are built only from the catalog tool. Care and
policy sentences are copied from a retrieved passage unless the question
compares two things, which is the one case that calls the model.
"""

from __future__ import annotations

import re

from app.catalog import LiveProduct
from app.guards import (
    ABSTAIN_REPLY,
    GREETING_REPLY,
    INJECTION_REPLY,
    NO_PRICE_REPLY,
    OFF_TOPIC_REPLY,
    ORDERS_REPLY,
    ensure_disclaimer,
    has_support,
    scrub_prices,
)
from app.llm import extract_faq
from app.router import is_comparison
from app.textutil import content_tokens, support, tokenize

FAQ_SUPPORT = 0.34
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
UNDER_RE = re.compile(
    r"(?:under|below|less than|up to)\s*(?:rs\.?|₹|inr)?\s*(\d+)",
    re.IGNORECASE,
)


def select_products(query: str, catalog, hits: list[dict]) -> list[LiveProduct]:
    lowered = (query or "").lower()
    listings = [product for product in catalog.listings() if product.status == "active" and product.price > 0]

    if re.search(r"\b(cheapest|lowest)\b", lowered):
        chosen = sorted(listings, key=lambda product: product.price)[:3]
        return _enrich(catalog, chosen)

    under = UNDER_RE.search(lowered)
    if under:
        limit = float(under.group(1))
        named = _named(lowered, listings, hits)
        pool = named or listings
        chosen = [product for product in pool if product.price <= limit]
        chosen.sort(key=lambda product: product.price)
        return _enrich(catalog, chosen[:3])

    found = catalog.search(query, limit=8)
    if not found:
        found = _named(lowered, listings, hits)
    # Prefer a name hit over a loose tag hit when the question names a plant.
    named = _named(lowered, found or listings, hits)
    chosen = named or found
    return _enrich(catalog, chosen[:3])


def _named(query: str, products: list[LiveProduct], hits: list[dict]) -> list[LiveProduct]:
    tokens = {tok for tok in tokenize(query) if len(tok) > 3}
    for hit in hits:
        plant = hit.get("plant") or ""
        tokens.update(tok for tok in tokenize(plant) if len(tok) > 3)
    if not tokens:
        return []
    scored: list[tuple[int, LiveProduct]] = []
    for product in products:
        name_tokens = set(tokenize(product.name))
        score = len(tokens & name_tokens)
        if score:
            scored.append((score, product))
    scored.sort(key=lambda item: item[0], reverse=True)
    seen: set[str] = set()
    out: list[LiveProduct] = []
    for _, product in scored:
        if product.slug in seen:
            continue
        seen.add(product.slug)
        out.append(product)
        if len(out) >= 3:
            break
    return out


def _enrich(catalog, products: list[LiveProduct]) -> list[LiveProduct]:
    enriched = []
    for product in products:
        full = catalog.by_slug(product.slug)
        enriched.append(full or product)
    return enriched


def inr(amount: float) -> str:
    if amount == int(amount):
        return f"Rs {int(amount):,}"
    return f"Rs {amount:,.2f}"


def price_and_stock(product: LiveProduct) -> str:
    if product.sizes:
        parts = []
        for size in product.sizes:
            label = size.get("label") or "one size"
            price = float(size.get("price") or 0)
            stock = int(size.get("stock") or 0)
            bit = f"{label}"
            if price:
                bit += f" at {inr(price)}"
            bit += " (out of stock)" if stock <= 0 else f" ({stock} in stock)"
            parts.append(bit)
        return "; ".join(parts)
    price = inr(product.price) if product.price else "price on the product page"
    if product.mrp and product.mrp > product.price:
        price = f"{price} (MRP {inr(product.mrp)})"
    if not product.track_inventory:
        return f"{price}, available"
    if product.stock <= 0:
        return f"{price}, out of stock"
    return f"{price}, {product.stock} in stock"


def product_reply(products: list[LiveProduct], hits: list[dict]) -> str:
    if not products:
        care = _care_sentence(hits)
        if care:
            return f"{NO_PRICE_REPLY}\n\n{care}"
        return NO_PRICE_REPLY
    lines = [f"- **{product.name}** — {price_and_stock(product)}" for product in products[:3]]
    care = _care_sentence(hits)
    body = "Here is what the shop lists right now:\n" + "\n".join(lines)
    if care:
        body += "\n\n" + care
    return body


def _care_sentence(hits: list[dict]) -> str:
    for hit in hits:
        if hit.get("kind") not in {"plant", "guide"}:
            continue
        for line in (hit.get("text") or "").splitlines():
            if re.match(r"^(?:-\s*)?(light|water|soil)\b", line.strip(), re.IGNORECASE):
                return line.strip().lstrip("- ").strip()[:220]
    return ""


def compose(message: str, route: str, hits: list[dict], products: list[dict], synthesizer) -> tuple[str, bool, str]:
    """Return reply text, whether a model was called, and the route actually used."""
    if route == "greeting":
        return GREETING_REPLY, False, route
    if route == "orders_refused_here":
        return ORDERS_REPLY, False, route
    if route == "off_topic":
        return OFF_TOPIC_REPLY, False, route
    if route == "injection":
        return INJECTION_REPLY, False, route
    if route == "product_discovery":
        live = [_product_from_dict(row) for row in products]
        return product_reply(live, hits), False, route

    faq = _faq_hit(message, hits)
    if faq and route in {"policy", "plant_care", "medicinal"}:
        text = extract_faq(faq.get("text") or "")
        if route == "medicinal":
            text = ensure_disclaimer(text)
        return text, False, route

    if route in {"plant_care", "medicinal", "policy"} and not has_support(message, hits):
        return ABSTAIN_REPLY, False, route

    if is_comparison(message) and synthesizer and hits:
        passages = [hit.get("text") or "" for hit in hits[:4]]
        try:
            text = synthesizer.synthesize(message, [], passages, route, products)
        except Exception:
            text = ""
        if text.strip():
            if route == "medicinal":
                text = ensure_disclaimer(text)
            return text.strip(), True, route

    if hits:
        text = _clip(hits[0].get("text") or "")
        if route == "medicinal":
            text = ensure_disclaimer(text)
        return text, False, route
    return ABSTAIN_REPLY, False, route


def _faq_hit(message: str, hits: list[dict]) -> dict | None:
    faqs = [hit for hit in hits if hit.get("kind") == "faq"]
    if not faqs:
        return None
    best = max(faqs, key=lambda hit: support(message, hit.get("text") or ""))
    if support(message, best.get("text") or "") >= FAQ_SUPPORT:
        return best
    return None


def finish(text: str, route: str, products: list[dict]) -> tuple[str, list[str]]:
    cleaned = scrub_prices(text, products)
    if route == "medicinal":
        cleaned = ensure_disclaimer(cleaned)
    slugs: list[str] = []
    if route in {"plant_care", "medicinal", "product_discovery"}:
        for product in products:
            slug = product.get("slug") or ""
            if SLUG_RE.match(slug) and slug not in slugs:
                slugs.append(slug)
            if len(slugs) >= 3:
                break
    return cleaned, slugs


def matching_care_products(message: str, hits: list[dict], catalog) -> list[dict]:
    """Attach a card when the question itself names the plant we retrieved."""
    if not hits:
        return []
    plant = hits[0].get("plant") or ""
    if not plant:
        return []
    plant_tokens = {tok for tok in tokenize(plant) if len(tok) > 3}
    if not plant_tokens & content_tokens(message) and not plant_tokens & set(tokenize(message)):
        return []
    products = select_products(plant, catalog, hits)
    return [product.as_dict() for product in products[:1]]


def _clip(text: str, limit: int = 700) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    stop = cut.rfind(". ")
    if stop > 200:
        return cut[: stop + 1]
    return cut.rstrip() + "…"


def _product_from_dict(row: dict) -> LiveProduct:
    return LiveProduct(
        name=row.get("name") or "",
        slug=row.get("slug") or "",
        price=float(row.get("price") or 0),
        mrp=float(row.get("mrp") or 0),
        stock=int(row.get("stock") or 0),
        status=row.get("status") or "active",
        track_inventory=bool(row.get("trackInventory", True)),
        short_desc=row.get("shortDescription") or "",
        tags=list(row.get("tags") or []),
        sizes=list(row.get("sizes") or []),
        category=row.get("category") or "",
    )
