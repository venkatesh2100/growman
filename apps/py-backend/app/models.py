"""Postgres schema.

These classes are the source of truth, the same role GORM models play in
the Go service. ``create_all`` on boot adds missing tables; it does not
drop columns. Search indexes that SQLAlchemy cannot express as columns
live in ``db.ensure_indexes``.

Three ideas show up over and over:

* Snapshot at order time. ``OrderItem`` copies the name and image key, so
  a later edit or delete of the product does not rewrite a receipt.
* Store an image *key*, not a URL. The public URL is built at read time
  from ``IMAGE_BASE_URL``, so swapping storage does not rewrite rows.
* A unique index is a lock. ``webhook_events.event_id``, one review per
  user per product, and ``payments.razorpay_payment_id`` make "do this
  once" a property of the insert, not of application code.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    # Naive UTC matches Postgres ``timestamp`` columns (no time zone),
    # which is what the Go service writes.
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class IdMixin:
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    # Soft delete. Queries that customers see must filter ``deleted_at IS NULL``.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, index=True, default=None)


def alive(model):
    """SQL expression: this row has not been soft-deleted."""
    return model.deleted_at.is_(None)


class User(IdMixin, Base):
    __tablename__ = "users"

    name: Mapped[str] = mapped_column(String(200), default="")
    email: Mapped[str | None] = mapped_column(String(255), unique=True)
    phone: Mapped[str | None] = mapped_column(String(32), unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    phone_verified_at: Mapped[datetime | None] = mapped_column(DateTime)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    provider: Mapped[str] = mapped_column(String(32), default="local")
    role: Mapped[str] = mapped_column(String(32), default="user")
    address_line: Mapped[str] = mapped_column(Text, default="")
    city: Mapped[str] = mapped_column(String(120), default="")
    state: Mapped[str] = mapped_column(String(120), default="")
    pincode: Mapped[str] = mapped_column(String(12), default="")
    country: Mapped[str] = mapped_column(String(80), default="")
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    referral_code: Mapped[str] = mapped_column(String(12), default="")
    referred_by: Mapped[int | None] = mapped_column(BigInteger)


class Category(IdMixin, Base):
    __tablename__ = "categories"

    name: Mapped[str] = mapped_column(String(160), default="")
    slug: Mapped[str] = mapped_column(String(180), unique=True)
    description: Mapped[str] = mapped_column(Text, default="")
    subcategories: Mapped[list[Subcategory]] = relationship(back_populates="category")


class Subcategory(IdMixin, Base):
    __tablename__ = "subcategories"

    name: Mapped[str] = mapped_column(String(160), default="")
    slug: Mapped[str] = mapped_column(String(180), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"))
    category: Mapped[Category] = relationship(back_populates="subcategories")


class Brand(IdMixin, Base):
    __tablename__ = "brands"

    name: Mapped[str] = mapped_column(String(160), default="")
    slug: Mapped[str] = mapped_column(String(180), unique=True)


class Product(IdMixin, Base):
    __tablename__ = "products"

    name: Mapped[str] = mapped_column(String(200), default="")
    slug: Mapped[str] = mapped_column(String(180), unique=True)
    description: Mapped[str] = mapped_column(Text, default="")
    short_desc: Mapped[str] = mapped_column(Text, default="")
    full_desc: Mapped[str] = mapped_column(Text, default="")
    specifications: Mapped[str] = mapped_column(Text, default="")
    tax_info: Mapped[str] = mapped_column(Text, default="")
    price: Mapped[float] = mapped_column(Float, default=0)
    mrp: Mapped[float] = mapped_column(Float, default=0)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    image_key: Mapped[str] = mapped_column(String(500), default="")
    status: Mapped[str] = mapped_column(String(32), default="active")
    featured: Mapped[bool] = mapped_column(Boolean, default=False)
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    # Ignored when the product has sizes — stock then lives on each size.
    stock: Mapped[int] = mapped_column(Integer, default=0)
    # False means always available (seeds, made-to-order).
    track_inventory: Mapped[bool] = mapped_column(Boolean, default=True)
    low_stock_threshold: Mapped[int] = mapped_column(Integer, default=5)
    rating_average: Mapped[float] = mapped_column(Float, default=0)
    rating_count: Mapped[int] = mapped_column(Integer, default=0)
    hsn_code: Mapped[str] = mapped_column(String(16), default="")
    gst_rate: Mapped[float] = mapped_column(Float, default=0)
    # small / medium go by courier; large needs the van; xl is quote-only.
    size_class: Mapped[str] = mapped_column(String(16), default="small")
    bulky: Mapped[bool] = mapped_column(Boolean, default=False)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"))
    subcategory_id: Mapped[int | None] = mapped_column(ForeignKey("subcategories.id"))
    brand_id: Mapped[int | None] = mapped_column(ForeignKey("brands.id"))

    category: Mapped[Category | None] = relationship()
    subcategory: Mapped[Subcategory | None] = relationship()
    brand: Mapped[Brand | None] = relationship()
    sizes: Mapped[list[ProductSize]] = relationship(back_populates="product")
    attributes: Mapped[list[Attribute]] = relationship()
    reviews: Mapped[list[Review]] = relationship()


class ProductSize(IdMixin, Base):
    __tablename__ = "product_sizes"

    label: Mapped[str] = mapped_column(String(80), default="")
    price: Mapped[float] = mapped_column(Float, default=0)
    stock: Mapped[int] = mapped_column(Integer, default=0)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    size_class: Mapped[str | None] = mapped_column(String(16))
    bulky: Mapped[bool | None] = mapped_column(Boolean)
    image_keys: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    product: Mapped[Product] = relationship(back_populates="sizes")


class Attribute(IdMixin, Base):
    __tablename__ = "attributes"

    name: Mapped[str] = mapped_column(String(80), default="")
    value: Mapped[str] = mapped_column(String(200), default="")
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)


class Review(IdMixin, Base):
    __tablename__ = "reviews"
    __table_args__ = (
        Index("idx_reviews_user_product", "product_id", "user_id", unique=True),
    )

    rating: Mapped[int] = mapped_column(Integer, default=5)
    title: Mapped[str] = mapped_column(String(160), default="")
    comment: Mapped[str] = mapped_column(Text, default="")
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    verified_purchase: Mapped[bool] = mapped_column(Boolean, default=False)
    image_keys: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    admin_notes: Mapped[str] = mapped_column(Text, default="")
    user: Mapped[User] = relationship()


class Order(IdMixin, Base):
    __tablename__ = "orders"
    __table_args__ = (
        # Empty string would collide with itself; only real tokens are unique.
        Index(
            "idx_orders_public_token",
            "public_token",
            unique=True,
            postgresql_where=text("public_token <> ''"),
        ),
        Index(
            "idx_orders_invoice_number",
            "invoice_number",
            unique=True,
            postgresql_where=text("invoice_number <> ''"),
        ),
    )

    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    razorpay_order_id: Mapped[str] = mapped_column(String(64), unique=True, default="")
    razorpay_payment_id: Mapped[str] = mapped_column(String(64), default="")
    # created, paid, failed, refunded, partially_refunded
    payment_status: Mapped[str] = mapped_column(String(32), default="created")
    # Legacy mirror of payment_status, plus fulfillment words (abandoned, shipped).
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    amount: Mapped[float] = mapped_column(Float, default=0)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    expected_delivery_date: Mapped[datetime | None] = mapped_column(DateTime)
    # Unguessable handle for the guest post-payment page. Sequential ids are not.
    public_token: Mapped[str] = mapped_column(String(64), default="")
    customer_name: Mapped[str] = mapped_column(String(200), default="")
    customer_email: Mapped[str] = mapped_column(String(255), default="")
    customer_phone: Mapped[str] = mapped_column(String(32), default="")
    client_ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(512), default="")
    address_line: Mapped[str] = mapped_column(Text, default="")
    city: Mapped[str] = mapped_column(String(120), default="")
    state: Mapped[str] = mapped_column(String(120), default="")
    pincode: Mapped[str] = mapped_column(String(12), default="")
    fulfillment_channel: Mapped[str] = mapped_column(String(32), default="")
    fulfillment_zone: Mapped[str] = mapped_column(String(32), default="")
    subtotal: Mapped[float] = mapped_column(Float, default=0)
    delivery_fee: Mapped[float] = mapped_column(Float, default=0)
    delivery_fee_waived: Mapped[bool] = mapped_column(Boolean, default=False)
    distance_km: Mapped[float | None] = mapped_column(Float)
    distance_source: Mapped[str] = mapped_column(String(32), default="")
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    courier_provider: Mapped[str] = mapped_column(String(64), default="")
    courier_service: Mapped[str] = mapped_column(String(64), default="")
    courier_cost: Mapped[float | None] = mapped_column(Float)
    shipment_id: Mapped[str] = mapped_column(String(64), default="")
    awb_number: Mapped[str] = mapped_column(String(64), default="", index=True)
    tracking_url: Mapped[str] = mapped_column(String(300), default="")
    shipped_at: Mapped[datetime | None] = mapped_column(DateTime)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime)
    pickup_booked_at: Mapped[datetime | None] = mapped_column(DateTime)
    taxable_value: Mapped[float] = mapped_column(Float, default=0)
    tax_amount: Mapped[float] = mapped_column(Float, default=0)
    invoice_number: Mapped[str] = mapped_column(String(32), default="")
    invoice_date: Mapped[datetime | None] = mapped_column(DateTime)
    coupon_id: Mapped[int | None] = mapped_column(BigInteger)
    coupon_code: Mapped[str] = mapped_column(String(32), default="")
    discount_total: Mapped[float] = mapped_column(Float, default=0)
    review_requested_at: Mapped[datetime | None] = mapped_column(DateTime)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime)
    cancel_reason: Mapped[str] = mapped_column(Text, default="")
    refunded_amount: Mapped[float] = mapped_column(Float, default=0)
    # Claim flag: stock is returned at most once, even if two workers race.
    inventory_released: Mapped[bool] = mapped_column(Boolean, default=False)
    gift_wrap: Mapped[bool] = mapped_column(Boolean, default=False)
    gift_note: Mapped[str] = mapped_column(String(300), default="")
    hide_price: Mapped[bool] = mapped_column(Boolean, default=False)
    gift_fee: Mapped[float] = mapped_column(Float, default=0)
    delivery_slot: Mapped[str] = mapped_column(String(16), default="")
    preferred_delivery_date: Mapped[datetime | None] = mapped_column(DateTime)
    delivery_rating: Mapped[int | None] = mapped_column(Integer)
    delivery_feedback: Mapped[str] = mapped_column(String(500), default="")
    credit_applied: Mapped[float] = mapped_column(Float, default=0)
    shipping_address: Mapped[str] = mapped_column(Text, default="")
    billing_address: Mapped[str] = mapped_column(Text, default="")
    items: Mapped[list[OrderItem]] = relationship(back_populates="order")

    def is_cancellable(self) -> bool:
        if self.cancelled_at or self.awb_number or self.shipped_at:
            return False
        return self.status in {"pending", "paid", "confirmed", "processing"}


class OrderItem(IdMixin, Base):
    __tablename__ = "order_items"

    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    # Column name matches the Go schema (``product_size``), not ``product_size_id``.
    product_size_id: Mapped[int | None] = mapped_column("product_size", BigInteger)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    price: Mapped[float] = mapped_column(Float, default=0)
    name: Mapped[str] = mapped_column(String(200), default="")
    image_key: Mapped[str] = mapped_column(String(500), default="")
    order: Mapped[Order] = relationship(back_populates="items")


class Payment(IdMixin, Base):
    __tablename__ = "payments"

    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    razorpay_order_id: Mapped[str] = mapped_column(String(64), default="")
    # Unique so a replayed payment updates the row instead of inserting a second one.
    razorpay_payment_id: Mapped[str] = mapped_column(String(64), unique=True)
    amount: Mapped[float] = mapped_column(Float, default=0)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    status: Mapped[str] = mapped_column(String(32), default="created")
    method: Mapped[str] = mapped_column(String(32), default="")
    description: Mapped[str] = mapped_column(Text, default="")


class Wishlist(IdMixin, Base):
    __tablename__ = "wishlists"
    __table_args__ = (Index("idx_user_product", "user_id", "product_id", unique=True),)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    price_at_add: Mapped[float] = mapped_column(Float, default=0)
    product: Mapped[Product] = relationship()


class RequestedProduct(IdMixin, Base):
    __tablename__ = "requested_products"

    product_name: Mapped[str] = mapped_column(String(200), default="")
    details: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(32), default="pending")
    source: Mapped[str] = mapped_column(String(32), default="manual")
    requested_by_id: Mapped[int | None] = mapped_column(BigInteger)
    requester_name: Mapped[str] = mapped_column(String(200), default="")
    requester_email: Mapped[str] = mapped_column(String(255), default="")
    requester_phone: Mapped[str] = mapped_column(String(32), default="")
    admin_notes: Mapped[str] = mapped_column(Text, default="")


class DoothaWaitlist(IdMixin, Base):
    __tablename__ = "dootha_waitlists"

    name: Mapped[str] = mapped_column(String(200), default="")
    phone: Mapped[str] = mapped_column(String(32), index=True)
    email: Mapped[str] = mapped_column(String(255), default="")
    address: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(32), default="pending")
    source: Mapped[str] = mapped_column(String(64), default="homepage_popup")
    user_id: Mapped[int | None] = mapped_column(BigInteger)
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(512), default="")
    signups: Mapped[int] = mapped_column(Integer, default=1)
    admin_notes: Mapped[str] = mapped_column(Text, default="")


class OrderSupportRequest(IdMixin, Base):
    __tablename__ = "order_support_requests"

    order_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    user_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    customer_name: Mapped[str] = mapped_column(String(200), default="")
    customer_email: Mapped[str] = mapped_column(String(255), default="")
    customer_phone: Mapped[str] = mapped_column(String(32), default="")
    issue_type: Mapped[str] = mapped_column(String(64), default="order_support")
    priority: Mapped[str] = mapped_column(String(16), default="high")
    user_message: Mapped[str] = mapped_column(Text, default="")
    order_status: Mapped[str] = mapped_column(String(32), default="")
    payment_status: Mapped[str] = mapped_column(String(32), default="")
    order_amount: Mapped[float] = mapped_column(Float, default=0)
    order_items: Mapped[str] = mapped_column(Text, default="")
    expected_delivery: Mapped[str] = mapped_column(String(64), default="")
    status: Mapped[str] = mapped_column(String(32), default="pending")
    source: Mapped[str] = mapped_column(String(32), default="chatbot")
    admin_notes: Mapped[str] = mapped_column(Text, default="")


class WebhookEvent(IdMixin, Base):
    """Idempotency ledger. The unique event_id is the lock."""

    __tablename__ = "webhook_events"

    provider: Mapped[str] = mapped_column(String(32), default="")
    event_id: Mapped[str] = mapped_column(String(128), unique=True)
    event_type: Mapped[str] = mapped_column(String(64), default="")
    status: Mapped[str] = mapped_column(String(16), default="received")
    payload: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str] = mapped_column(Text, default="")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime)


class Refund(IdMixin, Base):
    __tablename__ = "refunds"
    __table_args__ = (
        Index(
            "idx_refunds_razorpay_refund_id",
            "razorpay_refund_id",
            unique=True,
            postgresql_where=text("razorpay_refund_id <> ''"),
        ),
    )

    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), index=True)
    razorpay_refund_id: Mapped[str] = mapped_column(String(64), default="")
    razorpay_payment_id: Mapped[str] = mapped_column(String(64), default="")
    amount: Mapped[float] = mapped_column(Float, default=0)
    currency: Mapped[str] = mapped_column(String(8), default="INR")
    status: Mapped[str] = mapped_column(String(16), default="pending")
    reason: Mapped[str] = mapped_column(String(64), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    initiated_by: Mapped[int | None] = mapped_column(BigInteger)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime)
    restocked_inventory: Mapped[bool] = mapped_column(Boolean, default=False)


class Coupon(IdMixin, Base):
    __tablename__ = "coupons"

    code: Mapped[str] = mapped_column(String(32), unique=True)
    description: Mapped[str] = mapped_column(Text, default="")
    # percentage | fixed | free_shipping
    type: Mapped[str] = mapped_column(String(16), default="fixed")
    value: Mapped[float] = mapped_column(Float, default=0)
    max_discount: Mapped[float] = mapped_column(Float, default=0)
    min_subtotal: Mapped[float] = mapped_column(Float, default=0)
    usage_limit: Mapped[int] = mapped_column(Integer, default=0)
    per_user_limit: Mapped[int] = mapped_column(Integer, default=1)
    usage_count: Mapped[int] = mapped_column(Integer, default=0)
    category_ids: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    product_ids: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    first_order_only: Mapped[bool] = mapped_column(Boolean, default=False)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class CouponRedemption(IdMixin, Base):
    __tablename__ = "coupon_redemptions"

    coupon_id: Mapped[int] = mapped_column(ForeignKey("coupons.id"), index=True)
    user_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    email: Mapped[str] = mapped_column(String(255), default="")
    order_id: Mapped[int] = mapped_column(BigInteger, index=True)
    amount: Mapped[float] = mapped_column(Float, default=0)


class Address(IdMixin, Base):
    __tablename__ = "addresses"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    label: Mapped[str] = mapped_column(String(40), default="")
    name: Mapped[str] = mapped_column(String(200), default="")
    phone: Mapped[str] = mapped_column(String(32), default="")
    address_line: Mapped[str] = mapped_column(Text, default="")
    city: Mapped[str] = mapped_column(String(120), default="")
    state: Mapped[str] = mapped_column(String(120), default="")
    pincode: Mapped[str] = mapped_column(String(12), default="")
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)


class ConsentRecord(IdMixin, Base):
    """Append-only. A withdrawal is a new row with granted=False."""

    __tablename__ = "consent_records"

    user_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    email: Mapped[str] = mapped_column(String(255), default="")
    purpose: Mapped[str] = mapped_column(String(32), default="essential")
    granted: Mapped[bool] = mapped_column(Boolean, default=True)
    notice_version: Mapped[str] = mapped_column(String(16), default="1")
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(512), default="")


class BackInStockRequest(IdMixin, Base):
    __tablename__ = "back_in_stock_requests"

    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    product_size_id: Mapped[int | None] = mapped_column(BigInteger)
    email: Mapped[str] = mapped_column(String(255), default="")
    user_id: Mapped[int | None] = mapped_column(BigInteger)
    notified_at: Mapped[datetime | None] = mapped_column(DateTime)


class OwnedPlant(IdMixin, Base):
    __tablename__ = "owned_plants"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(80), default="")
    location: Mapped[str] = mapped_column(String(80), default="")
    notes: Mapped[str] = mapped_column(String(1000), default="")
    water_every_days: Mapped[int] = mapped_column(Integer, default=7)
    fertilize_every_days: Mapped[int] = mapped_column(Integer, default=30)
    water_next_at: Mapped[datetime | None] = mapped_column(DateTime)
    fertilize_next_at: Mapped[datetime | None] = mapped_column(DateTime)
    water_reminder: Mapped[bool] = mapped_column(Boolean, default=True)
    fertilize_reminder: Mapped[bool] = mapped_column(Boolean, default=True)
    photo_url: Mapped[str] = mapped_column(String(500), default="")
    product_id: Mapped[int | None] = mapped_column(BigInteger)
    product_slug: Mapped[str] = mapped_column(String(180), default="")
    room: Mapped[str] = mapped_column(String(40), default="")
    mist_every_days: Mapped[int] = mapped_column(Integer, default=0)
    rotate_every_days: Mapped[int] = mapped_column(Integer, default=0)
    repot_every_days: Mapped[int] = mapped_column(Integer, default=0)
    prune_every_days: Mapped[int] = mapped_column(Integer, default=0)
    mist_reminder: Mapped[bool] = mapped_column(Boolean, default=False)
    rotate_reminder: Mapped[bool] = mapped_column(Boolean, default=False)
    repot_reminder: Mapped[bool] = mapped_column(Boolean, default=False)
    prune_reminder: Mapped[bool] = mapped_column(Boolean, default=False)
    mist_next_at: Mapped[datetime | None] = mapped_column(DateTime)
    rotate_next_at: Mapped[datetime | None] = mapped_column(DateTime)
    repot_next_at: Mapped[datetime | None] = mapped_column(DateTime)
    prune_next_at: Mapped[datetime | None] = mapped_column(DateTime)
    snoozed_until: Mapped[datetime | None] = mapped_column(DateTime)


class PlantHealthLog(IdMixin, Base):
    __tablename__ = "plant_health_logs"

    owned_plant_id: Mapped[int] = mapped_column(ForeignKey("owned_plants.id"), index=True)
    user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    status: Mapped[str] = mapped_column(String(32), default="ok")
    notes: Mapped[str] = mapped_column(String(1000), default="")
    photo_url: Mapped[str] = mapped_column(String(500), default="")
    recorded_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    follow_up_at: Mapped[datetime | None] = mapped_column(DateTime)


class NotificationPreference(IdMixin, Base):
    __tablename__ = "notification_preferences"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)
    order_updates: Mapped[bool] = mapped_column(Boolean, default=True)
    promotions: Mapped[bool] = mapped_column(Boolean, default=False)
    care_reminders: Mapped[bool] = mapped_column(Boolean, default=True)
    weather_alerts: Mapped[bool] = mapped_column(Boolean, default=True)
    dootha_alerts: Mapped[bool] = mapped_column(Boolean, default=True)
    reminder_hour: Mapped[int] = mapped_column(Integer, default=8)
    quiet_start_hour: Mapped[int] = mapped_column(Integer, default=22)
    quiet_end_hour: Mapped[int] = mapped_column(Integer, default=7)
    vacation_until: Mapped[datetime | None] = mapped_column(DateTime)
    push_token: Mapped[str] = mapped_column(String(255), default="")


class AppNotification(IdMixin, Base):
    __tablename__ = "app_notifications"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(32), default="info")
    title: Mapped[str] = mapped_column(String(140), default="")
    body: Mapped[str] = mapped_column(String(500), default="")
    owned_plant_id: Mapped[int | None] = mapped_column(BigInteger)
    order_id: Mapped[int | None] = mapped_column(BigInteger)
    product_id: Mapped[int | None] = mapped_column(BigInteger)
    href: Mapped[str] = mapped_column(String(200), default="")
    read_at: Mapped[datetime | None] = mapped_column(DateTime)
    dedupe_key: Mapped[str] = mapped_column(String(120), unique=True)


class SavedItem(IdMixin, Base):
    __tablename__ = "saved_items"
    __table_args__ = (Index("idx_saved_user_product", "user_id", "product_id", unique=True),)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    product_size_id: Mapped[int | None] = mapped_column(BigInteger)
    pot: Mapped[str] = mapped_column(String(80), default="")
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    product: Mapped[Product] = relationship()


class StoreCredit(IdMixin, Base):
    __tablename__ = "store_credits"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)
    balance: Mapped[float] = mapped_column(Float, default=0)


class CreditEntry(IdMixin, Base):
    __tablename__ = "credit_entries"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    amount: Mapped[float] = mapped_column(Float, default=0)
    reason: Mapped[str] = mapped_column(String(40), default="")
    order_id: Mapped[int | None] = mapped_column(BigInteger)


class SavedPaymentMethod(IdMixin, Base):
    """A label the customer recognises. Full card numbers are never stored."""

    __tablename__ = "saved_payment_methods"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16), default="upi")
    label: Mapped[str] = mapped_column(String(40), default="")
    detail: Mapped[str] = mapped_column(String(80), default="")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)


class RecentView(IdMixin, Base):
    __tablename__ = "recent_views"
    __table_args__ = (Index("idx_recent_user_product", "user_id", "product_id", unique=True),)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    viewed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    product: Mapped[Product] = relationship()


class CartSnapshot(IdMixin, Base):
    __tablename__ = "cart_snapshots"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)
    items_json: Mapped[str] = mapped_column(Text, default="[]")
    item_count: Mapped[int] = mapped_column(Integer, default=0)
    notified_at: Mapped[datetime | None] = mapped_column(DateTime)


class ChatTurn(IdMixin, Base):
    __tablename__ = "chat_turns"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(String(16), default="user")
    content: Mapped[str] = mapped_column(Text, default="")


class QuoteRequest(IdMixin, Base):
    __tablename__ = "quote_requests"

    user_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    estimate_no: Mapped[str] = mapped_column(String(40), default="")
    name: Mapped[str] = mapped_column(String(100), default="")
    phone: Mapped[str] = mapped_column(String(20), default="")
    email: Mapped[str] = mapped_column(String(160), default="")
    summary: Mapped[str] = mapped_column(String(300), default="")
    amount: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(16), default="sent")
