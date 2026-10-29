"""Decisions you can explain without a database: delivery, money words, tokens."""

from datetime import datetime
from types import SimpleNamespace

import jwt

from app.delivery import quote
from app.security import issue, ten_digit
from app.shop import financial_year, rupees, signature_ok


def test_nearby_hyderabad_suggests_the_store():
    quoted = quote([{"price": 299, "quantity": 1, "size": "small", "bulky": False}], pincode="500001")
    assert quoted["zone"] == "store_local"
    assert quoted["recommended"] == "store_pickup"
    assert quoted["bulkRequired"] is False


def test_a_mature_tree_is_a_quote_not_a_checkout():
    quoted = quote([{"price": 4000, "quantity": 1, "size": "xl", "bulky": False}], pincode="500001")
    assert quoted["bulkRequired"] is True
    assert quoted["recommended"] == "bulk_quote"
    courier = next(row for row in quoted["options"] if row["channel"] == "courier")
    assert courier["available"] is False


def test_delhi_is_outside_the_van():
    quoted = quote([{"price": 299, "quantity": 1, "size": "small", "bulky": False}], pincode="110001")
    assert quoted["zone"] == "outside"
    assert quoted["bulkRequired"] is True


def test_financial_year_starts_in_april():
    assert financial_year(datetime(2026, 4, 1)) == "2026-27"
    assert financial_year(datetime(2026, 3, 31)) == "2025-26"


def test_rupees_use_indian_grouping():
    assert rupees(8370) == "Eight thousand three hundred seventy rupees"
    assert rupees(800370) == "Eight lakh three hundred seventy rupees"
    assert rupees(546020) == "Five lakh forty six thousand twenty rupees"
    assert rupees(99.5) == "Ninety nine rupees and fifty paise"


def test_phone_accepts_the_three_ways_india_writes_a_mobile():
    assert ten_digit("+91 98765 43210") == "9876543210"
    assert ten_digit("919876543210") == "9876543210"
    assert ten_digit("5876543210") == ""


def test_payment_signature_accepts_hex_or_base64():
    import base64
    import hashlib
    import hmac
    secret, body = "topsecret", b"order_1|pay_1"
    digest = hmac.new(secret.encode(), body, hashlib.sha256).digest()
    assert signature_ok(secret, body, digest.hex())
    assert signature_ok(secret, body, base64.b64encode(digest).decode())
    assert not signature_ok(secret, body, "nope")


def test_onboarding_token_is_not_a_full_session():
    token = issue("s" * 32, SimpleNamespace(id=7, role="user"), scope="onboarding")
    claims = jwt.decode(token, "s" * 32, algorithms=["HS256"])
    assert claims["userId"] == 7
    assert claims["scope"] == "onboarding"


def test_invoice_pdf_is_a_pdf():
    from app.routers.orders import pdf
    item = SimpleNamespace(deleted_at=None, quantity=2, name="Money Plant", price=299)
    order = SimpleNamespace(
        invoice_number="GRW/2026-27/000001", customer_name="Asha", customer_phone="9876543210",
        address_line="Abids", city="Hyderabad", pincode="500001", items=[item],
        subtotal=598, delivery_fee=0, tax_amount=0, amount=598,
    )
    assert pdf(order).startswith(b"%PDF")

