"""Bulk quotation pricing.

The buyer sends product ids and quantities. The rate is the catalog price,
never the number in the request. Custom lines (plants we do not sell yet)
are printed as "on request" with a zero rate. Freight, loading, and labour
stay unpriced until the nursery fills them in; the JSON uses ``null`` for
those amounts, which the bulk page renders as "To be quoted".
"""

from __future__ import annotations

import re
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.documents import finalize_quotation, quotation_item_code
from app.errors import APIError
from app.models import Product, alive
from app.phone import ten_digit

IST = ZoneInfo("Asia/Kolkata")
PINCODE = re.compile(r"^[1-9][0-9]{5}$")
GSTIN = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
MAX_LINES = 200
MAX_QTY = 100_000


def _line(value: str, limit: int) -> str:
    text = " ".join((value or "").split())
    return text[:limit]


def next_estimate_no(redis, now: datetime) -> str:
    """``GMQ-2609-0042``. The counter resets each month. Without Redis the suffix is the clock."""
    prefix = "GMQ-" + now.strftime("%y%m")
    if redis is not None:
        key = "quotation:seq:" + now.strftime("%Y%m")
        try:
            number = int(redis.incr(key))
            if number == 1:
                redis.expire(key, 40 * 24 * 3600)
            return f"{prefix}-{number:04d}"
        except Exception:  # noqa: BLE001 — a missing counter must not drop the enquiry
            pass
    return prefix + "-" + now.strftime("%d%H%M")


def price(db, body, now: datetime, estimate_no: str) -> dict:
    if (getattr(body, "website", "") or "").strip():
        # A hidden field. A person leaves it blank; a bot fills it.
        raise APIError(400, "invalid request")
    requester = {
        "name": _line(body.name, 100),
        "company": _line(getattr(body, "company", ""), 120),
        "phone": ten_digit(body.phone),
        "email": _line(getattr(body, "email", ""), 160),
        "gstin": _line(getattr(body, "gstin", ""), 15).upper(),
        "address": _line(getattr(body, "address", ""), 300),
        "city": _line(getattr(body, "city", ""), 80),
        "state": _line(getattr(body, "state", ""), 60),
        "pincode": _line(getattr(body, "pincode", ""), 6),
        "requiredBy": _line(getattr(body, "requiredBy", ""), 40),
        "notes": (getattr(body, "notes", "") or "").strip()[:1500],
    }
    if len(requester["name"]) < 2:
        raise APIError(400, "Please enter your name.")
    if not requester["phone"]:
        raise APIError(400, "Please enter a valid 10-digit mobile number.")
    if len(requester["address"]) < 5:
        raise APIError(400, "Please enter the delivery address.")
    if requester["pincode"] and not PINCODE.match(requester["pincode"]):
        raise APIError(400, "Please enter a valid 6-digit pincode.")
    if requester["gstin"] and not GSTIN.match(requester["gstin"]):
        raise APIError(400, "Please enter a valid 15-character GSTIN, or leave it blank.")
    if requester["email"] and ("@" not in requester["email"] or "." not in requester["email"].split("@")[-1]):
        raise APIError(400, "Please enter a valid email address.")

    quantities: dict[tuple[int, int], int] = {}
    order: list[tuple[int, int]] = []
    for item in getattr(body, "items", []) or []:
        product_id = int(getattr(item, "productId", 0) or 0)
        size_id = int(getattr(item, "sizeId", 0) or 0)
        quantity = int(getattr(item, "quantity", 0) or 0)
        if product_id <= 0 or quantity <= 0:
            continue
        key = (product_id, size_id)
        if key not in quantities:
            order.append(key)
        quantities[key] = min(quantities[key] + quantity, MAX_QTY)

    custom = []
    for item in getattr(body, "customItems", []) or []:
        name = _line(getattr(item, "name", ""), 120)
        quantity = int(getattr(item, "quantity", 0) or 0)
        if len(name) < 2 or quantity <= 0:
            continue
        custom.append(
            {
                "itemCode": "",
                "name": name,
                "size": _line(getattr(item, "size", ""), 40),
                "quantity": min(quantity, MAX_QTY),
                "unit": "Nos",
                "rate": 0,
                "requested": True,
            }
        )
    if not order and not custom:
        raise APIError(400, "Add at least one plant with a quantity.")
    if len(order) + len(custom) > MAX_LINES:
        raise APIError(400, f"A quotation can include up to {MAX_LINES} plants.")

    products = {}
    if order:
        ids = list({product_id for product_id, _size in order})
        rows = db.scalars(select(Product).where(Product.id.in_(ids), alive(Product)).options(selectinload(Product.sizes))).all()
        products = {row.id: row for row in rows}

    lines = []
    for product_id, size_id in order:
        product = products.get(product_id)
        if product is None:
            continue
        rate = product.price
        size_label = ""
        if size_id:
            size = next((row for row in product.sizes if row.id == size_id), None)
            if size is None:
                continue
            rate = size.price
            size_label = size.label
        lines.append(
            {
                "itemCode": quotation_item_code(product.id, size_id),
                "name": product.name,
                "size": size_label,
                "quantity": quantities[(product_id, size_id)],
                "unit": "Nos",
                "rate": rate,
                "requested": False,
            }
        )
    lines.extend(custom)
    if not lines:
        raise APIError(400, "The selected plants are no longer available. Please refresh and try again.")

    services = getattr(body, "services", None)
    charges = [
        {"label": "Freight Charges", "requested": bool(getattr(services, "delivery", False)), "amount": None},
        {"label": "Loading & Unloading", "requested": bool(getattr(services, "loading", False)), "amount": None},
        {"label": "Plantation Labour Charges", "requested": bool(getattr(services, "plantation", False)), "amount": None},
    ]
    place = ", ".join(part for part in (requester["city"], requester["state"]) if part) or requester["address"]
    return finalize_quotation(lines, charges, requester, estimate_no, now, place)
