"""Decisions the shop depends on, without a database.

These are the rules that cost money or leak stock if they are wrong:
signature checks, the Indian financial year, delivery zones, and phone
lookup. The handlers that use them are thin wrappers around this code.
"""

from datetime import datetime

from fastapi.testclient import TestClient

from app.auth import issue_token, parse_token
from app.fulfillment import Cart, CartItem, Policy, quote
from app.main import create_app
from app.payments import financial_year, verify_hmac
from app.phone import lookup_variants, ten_digit
from app.ratelimit import LocalLimiter


def test_rupees_use_the_indian_grouping():
    from app.documents import quotation_item_code, rupees_in_words
    from app.plantscan import plan

    assert rupees_in_words(8370) == "Eight Thousand Three Hundred and Seventy Rupees only"
    assert rupees_in_words(800370) == "Eight Lakh Three Hundred and Seventy Rupees only"
    assert rupees_in_words(546020) == "Five Lakh Forty Six Thousand and Twenty Rupees only"
    assert rupees_in_words(99.5) == "Ninety Nine Rupees and Fifty Paise only"
    assert quotation_item_code(12, 3) == "GM00120003"
    # Below the reserve, a care scan skips the extra credits.
    decision = plan("care", 10, True, 40)
    assert decision["disease"] is False
    assert decision["disease_skip"] == "quota_reserve"
    # The first scan of the day does not know the balance yet, so it may try.
    assert plan("care", 0, False, 40)["disease"] is True


def test_invoice_pdf_starts_with_the_pdf_header():
    from types import SimpleNamespace
    from datetime import datetime

    from app.documents import render_invoice_pdf

    order = SimpleNamespace(
        invoice_number="GRW/2026-27/000001",
        invoice_date=datetime(2026, 4, 2),
        created_at=datetime(2026, 4, 2),
        id=9,
        razorpay_payment_id="pay_1",
        customer_name="Asha",
        customer_email="a@example.com",
        customer_phone="9876543210",
        address_line="12 Road",
        city="Hyderabad",
        state="Telangana",
        pincode="500001",
        items=[SimpleNamespace(name="Snake plant", quantity=1, price=499)],
        subtotal=499,
        delivery_fee=0,
        discount_total=0,
        taxable_value=499,
        tax_amount=0,
        amount=499,
        refunded_amount=0,
    )
    pdf = render_invoice_pdf(order)
    assert pdf.startswith(b"%PDF")
    secret = "key-secret"
    message = "order_1|pay_1"
    import hashlib
    import hmac

    digest = hmac.new(secret.encode(), message.encode(), hashlib.sha256).digest()
    assert verify_hmac(secret, message, digest.hex())
    assert not verify_hmac("", message, digest.hex())
    assert not verify_hmac(secret, message, "00" * 32)


def test_financial_year_is_april_to_march():
    assert financial_year(datetime(2026, 1, 15)) == "2025-26"
    assert financial_year(datetime(2026, 4, 1)) == "2026-27"


def test_nearby_cart_recommends_a_store_visit():
    policy = Policy()
    cart = Cart([CartItem(size_class="small", quantity=1, unit_price=300)])
    # The default store is the Hyderabad centre. A point 2 km away is local.
    quoted = quote(policy, cart, 17.40, 78.49, "500001")
    assert quoted["zone"] == "store_local"
    assert quoted["recommended"] == "store_pickup"
    courier = next(opt for opt in quoted["options"] if opt["channel"] == "courier")
    assert courier["available"] is True
    assert courier["fee"] == 59


def test_xl_cart_is_a_quote_not_a_courier_order():
    quoted = quote(Policy(), Cart([CartItem(size_class="xl", quantity=1, unit_price=8000)]), None, None, "500001")
    assert quoted["bulkRequired"] is True
    assert quoted["recommended"] == "bulk_quote"
    courier = next(opt for opt in quoted["options"] if opt["channel"] == "courier")
    assert courier["available"] is False


def test_phone_variants_cover_the_legacy_shapes():
    assert ten_digit("+91 98765 43210") == "9876543210"
    assert lookup_variants("9876543210") == ["9876543210", "919876543210", "+919876543210"]
    assert ten_digit("12345") == ""


def test_onboarding_token_keeps_its_scope():
    token = issue_token("dev-secret-change-me", 7, "user", "onboarding")
    claims = parse_token("dev-secret-change-me", token)
    assert claims.user_id == 7
    assert claims.scope == "onboarding"


def test_local_limiter_resets_after_the_window():
    limiter = LocalLimiter()
    assert limiter.incr("ip", 60) == 1
    assert limiter.incr("ip", 60) == 2


def test_route_table_matches_the_go_service():
    client = TestClient(create_app())
    # OpenAPI is built from the mounted routers, including the ones FastAPI
    # keeps lazy until the first request.
    paths = set(client.get("/openapi.json").json()["paths"])
    expected = [
        "/healthz",
        "/readyz",
        "/webhooks/razorpay",
        "/webhooks/shiprocket",
        "/api/v1/auth/login",
        "/api/v1/auth/signup",
        "/api/v1/auth/otp/send",
        "/api/v1/checkout/quote",
        "/api/v1/checkout/create-order",
        "/api/v1/products",
        "/api/v1/products/{slug}",
        "/api/v1/razorpay/verify",
        "/api/v1/order",
        "/api/v1/orders",
        "/api/v1/wishlist",
        "/api/v1/privacy/erase",
        "/api/v1/chat",
        "/api/v1/images/identify-plant",
        "/api/v1/care/season",
        "/api/v1/me/plants",
    ]
    missing = [path for path in expected if path not in paths]
    assert missing == []


def test_liveness_does_not_need_postgres():
    client = TestClient(create_app())
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.headers["x-frame-options"] == "DENY"
