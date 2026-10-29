"""Schema, read like a Prisma model.

    email = String(255, optional=True, unique=True)   String?  @unique
    price = Float(default=0)                          Float    @default(0)
    category_id = BigInt(link="categories")           relation

Every model also has id, created_at, updated_at, and deleted_at.
create_all adds missing tables. It does not alter one that already exists.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import BigInteger as _BigInt
from sqlalchemy import Boolean as _Bool
from sqlalchemy import CheckConstraint, DateTime as _DateTime
from sqlalchemy import Float as _Float
from sqlalchemy import ForeignKey, Index, Integer as _Int
from sqlalchemy import String as _String
from sqlalchemy import Text as _Text
from sqlalchemy import func, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import DeclarativeBase, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def alive(model):
    return model.deleted_at.is_(None)


def String(size, default="", *, optional=False, unique=False, index=False, secret=False):
    kw = {"nullable": optional, "unique": unique, "index": index}
    if secret:
        kw["deferred"] = True
    if not optional:
        kw["default"] = default
        kw["server_default"] = default
    return mapped_column(_String(size), **kw)


def Text(default="", *, secret=False):
    kw = {"nullable": False, "default": default, "server_default": default}
    if secret:
        kw["deferred"] = True
    return mapped_column(_Text, **kw)


def Int(default=0, *, optional=False):
    if optional:
        return mapped_column(_Int, nullable=True)
    return mapped_column(_Int, nullable=False, default=default, server_default=str(default))


def Boolean(default=False, *, optional=False):
    if optional:
        return mapped_column(_Bool, nullable=True)
    bit = "true" if default else "false"
    return mapped_column(_Bool, nullable=False, default=default, server_default=text(bit))


def Float(*, optional=False, default=0):
    if optional:
        return mapped_column(_Float, nullable=True)
    return mapped_column(_Float, nullable=False, default=default, server_default=str(default))


def DateTime(*, optional=False, now=False, onupdate=False, index=False):
    kw = {"nullable": optional, "index": index}
    if now:
        kw["nullable"] = False
        kw["default"] = utcnow
        kw["server_default"] = func.now()
    if onupdate:
        kw["onupdate"] = utcnow
    return mapped_column(_DateTime, **kw)


def StringList():
    return mapped_column(ARRAY(_Text), nullable=False, default=list, server_default=text("'{}'"))


def BigInt(*, primary=False, link=None, optional=False, index=False, unique=False, column=None):
    if primary:
        return mapped_column(_BigInt, primary_key=True)
    args = [column, _BigInt] if column else [_BigInt]
    if link:
        args.append(ForeignKey(f"{link}.id"))
    return mapped_column(*args, nullable=optional, index=index, unique=unique)


def HasMany(model, back=None):
    return relationship(model, back_populates=back)


def HasOne(model, back=None):
    return relationship(model, back_populates=back)


def unique_if_set(index_name, column):
    # @@unique, but an empty string is not a value, so blanks do not collide.
    return Index(index_name, column, unique=True, postgresql_where=text(f"{column} <> ''"))


class Base(DeclarativeBase):
    pass


class IdMixin:
    id = BigInt(primary=True)
    created_at = DateTime(now=True)
    updated_at = DateTime(now=True, onupdate=True)
    deleted_at = DateTime(optional=True, index=True)


class User(IdMixin, Base):
    __tablename__ = "users"
    __table_args__ = (unique_if_set("idx_users_referral", "referral_code"),)

    name              = String(200)
    email             = String(255, optional=True, unique=True)
    phone             = String(32, optional=True, unique=True)
    password_hash     = String(255, optional=True, secret=True)
    phone_verified_at = DateTime(optional=True)
    email_verified    = Boolean(default=False)
    provider          = String(32, default="local")
    role              = String(32, default="user")
    address_line      = Text()
    city              = String(120)
    state             = String(120)
    pincode           = String(12)
    country           = String(80)
    latitude          = Float(optional=True)
    longitude         = Float(optional=True)
    referral_code     = String(12)
    referred_by       = BigInt(optional=True)

    def __repr__(self) -> str:
        return f"User(id={self.id!r})"


class Category(IdMixin, Base):
    __tablename__ = "categories"
    __table_args__ = (Index("uq_categories_slug", "slug", unique=True),)

    name           = String(160)
    slug           = String(180)
    description    = Text()
    subcategories  = HasMany("Subcategory", back="category")


class Subcategory(IdMixin, Base):
    __tablename__ = "subcategories"
    __table_args__ = (Index("ix_subcategories_slug", "slug"),)

    name         = String(160)
    slug         = String(180)
    description  = Text()
    category_id  = BigInt(link="categories", index=True)
    category     = HasOne("Category", back="subcategories")


class Brand(IdMixin, Base):
    __tablename__ = "brands"
    __table_args__ = (Index("uq_brands_slug", "slug", unique=True),)

    name = String(160)
    slug = String(180)


class Product(IdMixin, Base):
    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint("stock >= 0", name="ck_products_stock"),
        Index("uq_products_slug", "slug", unique=True),
    )

    name                = String(200)
    slug                = String(180)
    description         = Text()
    short_desc          = Text()
    full_desc           = Text()
    specifications      = Text()
    tax_info            = Text()
    price               = Float(default=0)
    mrp                 = Float(default=0)
    currency            = String(8, default="INR")
    image_key           = String(500)
    status              = String(32, default="active")
    featured            = Boolean(default=False)
    tags                = StringList()
    stock               = Int(default=0)  # unused once the product has sizes
    track_inventory     = Boolean(default=True)
    low_stock_threshold = Int(default=5)
    rating_average      = Float(default=0)
    rating_count        = Int(default=0)
    hsn_code            = String(16)
    gst_rate            = Float(default=0)
    size_class          = String(16, default="small")  # small, medium, large, xl
    bulky               = Boolean(default=False)
    category_id         = BigInt(link="categories", optional=True)
    subcategory_id      = BigInt(link="subcategories", optional=True)
    brand_id            = BigInt(link="brands", optional=True)
    category            = HasOne("Category")
    subcategory         = HasOne("Subcategory")
    brand               = HasOne("Brand")
    sizes               = HasMany("ProductSize", back="product")
    attributes          = HasMany("Attribute")
    reviews             = HasMany("Review")


class ProductSize(IdMixin, Base):
    __tablename__ = "product_sizes"
    __table_args__ = (CheckConstraint("stock >= 0", name="ck_product_sizes_stock"),)

    label       = String(80)
    price       = Float(default=0)
    stock       = Int(default=0)
    product_id  = BigInt(link="products", index=True)
    size_class  = String(16, optional=True)
    bulky       = Boolean(optional=True)
    image_keys  = StringList()
    product     = HasOne("Product", back="sizes")


class Attribute(IdMixin, Base):
    __tablename__ = "attributes"

    name        = String(80)
    value       = String(200)
    product_id  = BigInt(link="products", index=True)


class Review(IdMixin, Base):
    __tablename__ = "reviews"
    __table_args__ = (
        Index("idx_reviews_user_product", "product_id", "user_id", unique=True),
        CheckConstraint("rating BETWEEN 1 AND 5", name="ck_reviews_rating"),
    )

    rating             = Int(default=5)
    title              = String(160)
    comment            = Text()
    product_id         = BigInt(link="products")
    user_id            = BigInt(link="users")
    status             = String(16, default="pending")
    verified_purchase  = Boolean(default=False)
    image_keys         = StringList()
    admin_notes        = Text()
    user               = HasOne("User")


class Order(IdMixin, Base):
    __tablename__ = "orders"
    __table_args__ = (
        unique_if_set("idx_orders_public_token", "public_token"),
        unique_if_set("idx_orders_invoice_number", "invoice_number"),
        CheckConstraint("amount >= 0 AND refunded_amount >= 0", name="ck_orders_money"),
    )

    user_id                  = BigInt(link="users", optional=True, index=True)
    razorpay_order_id        = String(64, unique=True)
    razorpay_payment_id      = String(64)
    payment_status           = String(32, default="created")
    status                   = String(32, default="pending", index=True)
    amount                   = Float(default=0)
    currency                 = String(8, default="INR")
    expected_delivery_date   = DateTime(optional=True)
    public_token             = String(64)
    customer_name            = String(200)
    customer_email           = String(255)
    customer_phone           = String(32)
    client_ip                = String(64)
    user_agent               = String(512)
    address_line             = Text()
    city                     = String(120)
    state                    = String(120)
    pincode                  = String(12)
    fulfillment_channel      = String(32)
    fulfillment_zone         = String(32)
    subtotal                 = Float(default=0)
    delivery_fee             = Float(default=0)
    delivery_fee_waived      = Boolean(default=False)
    distance_km              = Float(optional=True)
    distance_source          = String(32)
    latitude                 = Float(optional=True)
    longitude                = Float(optional=True)
    courier_provider         = String(64)
    courier_service          = String(64)
    courier_cost             = Float(optional=True)
    shipment_id              = String(64)
    awb_number               = String(64, index=True)
    tracking_url             = String(300)
    shipped_at               = DateTime(optional=True)
    delivered_at             = DateTime(optional=True)
    pickup_booked_at         = DateTime(optional=True)
    taxable_value            = Float(default=0)
    tax_amount               = Float(default=0)
    invoice_number           = String(32)
    invoice_date             = DateTime(optional=True)
    coupon_id                = BigInt(optional=True)
    coupon_code              = String(32)
    discount_total           = Float(default=0)
    review_requested_at      = DateTime(optional=True)
    cancelled_at             = DateTime(optional=True)
    cancel_reason            = Text()
    refunded_amount          = Float(default=0)
    inventory_released       = Boolean(default=False)
    gift_wrap                = Boolean(default=False)
    gift_note                = String(300)
    hide_price               = Boolean(default=False)
    gift_fee                 = Float(default=0)
    delivery_slot            = String(16)
    preferred_delivery_date  = DateTime(optional=True)
    delivery_rating          = Int(optional=True)
    delivery_feedback        = String(500)
    credit_applied           = Float(default=0)
    shipping_address         = Text()
    billing_address          = Text()
    items                    = HasMany("OrderItem", back="order")

    def is_cancellable(self) -> bool:
        if self.cancelled_at or self.awb_number or self.shipped_at:
            return False
        return self.status in {"pending", "paid", "confirmed", "processing"}


class OrderItem(IdMixin, Base):
    __tablename__ = "order_items"
    __table_args__ = (CheckConstraint("quantity >= 1", name="ck_order_items_qty"),)

    order_id         = BigInt(link="orders", index=True)
    product_id       = BigInt(link="products")
    product_size_id  = BigInt(link="product_sizes", optional=True, column="product_size")
    quantity         = Int(default=1)
    price            = Float(default=0)
    name             = String(200)
    image_key        = String(500)
    order            = HasOne("Order", back="items")


class Payment(IdMixin, Base):
    __tablename__ = "payments"
    __table_args__ = (Index("uq_payments_razorpay_payment_id", "razorpay_payment_id", unique=True),)

    order_id              = BigInt(link="orders", index=True)
    razorpay_order_id     = String(64)
    razorpay_payment_id   = String(64)
    amount                = Float(default=0)
    currency              = String(8, default="INR")
    status                = String(32, default="created")
    method                = String(32)
    description           = Text()


class Wishlist(IdMixin, Base):
    __tablename__ = "wishlists"
    __table_args__ = (Index("idx_user_product", "user_id", "product_id", unique=True),)

    user_id       = BigInt(link="users")
    product_id    = BigInt(link="products")
    price_at_add  = Float(default=0)
    product       = HasOne("Product")


class RequestedProduct(IdMixin, Base):
    __tablename__ = "requested_products"

    product_name      = String(200)
    details           = Text()
    status            = String(32, default="pending")
    source            = String(32, default="manual")
    requested_by_id   = BigInt(optional=True)
    requester_name    = String(200)
    requester_email   = String(255)
    requester_phone   = String(32)
    admin_notes       = Text()


class DoothaWaitlist(IdMixin, Base):
    __tablename__ = "dootha_waitlists"
    __table_args__ = (Index("ix_dootha_waitlists_phone", "phone"),)

    name         = String(200)
    phone        = String(32)
    email        = String(255)
    address      = Text()
    status       = String(32, default="pending")
    source       = String(64, default="homepage_popup")
    user_id      = BigInt(optional=True)
    ip           = String(64)
    user_agent   = String(512)
    signups      = Int(default=1)
    admin_notes  = Text()


class OrderSupportRequest(IdMixin, Base):
    __tablename__ = "order_support_requests"

    order_id           = BigInt(optional=True, index=True)
    user_id            = BigInt(optional=True, index=True)
    customer_name      = String(200)
    customer_email     = String(255)
    customer_phone     = String(32)
    issue_type         = String(64, default="order_support")
    priority           = String(16, default="high")
    user_message       = Text()
    order_status       = String(32)
    payment_status     = String(32)
    order_amount       = Float(default=0)
    order_items        = Text()
    expected_delivery  = String(64)
    status             = String(32, default="pending")
    source             = String(32, default="chatbot")
    admin_notes        = Text()


class WebhookEvent(IdMixin, Base):
    __tablename__ = "webhook_events"
    __table_args__ = (Index("uq_webhook_events_event_id", "event_id", unique=True),)

    provider      = String(32)
    event_id      = String(128)
    event_type    = String(64)
    status        = String(16, default="received")
    payload       = Text(secret=True)
    error         = Text()
    attempts      = Int(default=0)
    processed_at  = DateTime(optional=True)


class Refund(IdMixin, Base):
    __tablename__ = "refunds"
    __table_args__ = (unique_if_set("idx_refunds_razorpay_refund_id", "razorpay_refund_id"),)

    order_id              = BigInt(link="orders", index=True)
    razorpay_refund_id    = String(64)
    razorpay_payment_id   = String(64)
    amount                = Float(default=0)
    currency              = String(8, default="INR")
    status                = String(16, default="pending")
    reason                = String(64)
    notes                 = Text()
    initiated_by          = BigInt(optional=True)
    processed_at          = DateTime(optional=True)
    restocked_inventory   = Boolean(default=False)


class Coupon(IdMixin, Base):
    __tablename__ = "coupons"
    __table_args__ = (Index("uq_coupons_code", "code", unique=True),)

    code              = String(32)
    description       = Text()
    type              = String(16, default="fixed")
    value             = Float(default=0)
    max_discount      = Float(default=0)
    min_subtotal      = Float(default=0)
    usage_limit       = Int(default=0)
    per_user_limit    = Int(default=1)
    usage_count       = Int(default=0)
    category_ids      = StringList()
    product_ids       = StringList()
    first_order_only  = Boolean(default=False)
    starts_at         = DateTime(optional=True)
    expires_at        = DateTime(optional=True)
    active            = Boolean(default=True)


class CouponRedemption(IdMixin, Base):
    __tablename__ = "coupon_redemptions"

    coupon_id  = BigInt(link="coupons", index=True)
    user_id    = BigInt(optional=True, index=True)
    email      = String(255)
    order_id   = BigInt(optional=True, index=True)
    amount     = Float(default=0)


class Address(IdMixin, Base):
    __tablename__ = "addresses"

    user_id       = BigInt(link="users", index=True)
    label         = String(40)
    name          = String(200)
    phone         = String(32)
    address_line  = Text()
    city          = String(120)
    state         = String(120)
    pincode       = String(12)
    latitude      = Float(optional=True)
    longitude     = Float(optional=True)
    is_default    = Boolean(default=False)


class ConsentRecord(IdMixin, Base):
    """Append-only. A withdrawal is a new row with granted false."""

    __tablename__ = "consent_records"

    user_id          = BigInt(optional=True, index=True)
    email            = String(255)
    purpose          = String(32, default="essential")
    granted          = Boolean(default=True)
    notice_version   = String(16, default="1")
    ip               = String(64)
    user_agent       = String(512)


class BackInStockRequest(IdMixin, Base):
    __tablename__ = "back_in_stock_requests"

    product_id       = BigInt(link="products", index=True)
    product_size_id  = BigInt(optional=True)
    email            = String(255)
    user_id          = BigInt(optional=True)
    notified_at      = DateTime(optional=True)


class OwnedPlant(IdMixin, Base):
    __tablename__ = "owned_plants"

    user_id                = BigInt(link="users", index=True)
    name                   = String(80)
    location               = String(80)
    notes                  = String(1000)
    water_every_days       = Int(default=7)
    fertilize_every_days   = Int(default=30)
    water_next_at          = DateTime(optional=True)
    fertilize_next_at      = DateTime(optional=True)
    water_reminder         = Boolean(default=True)
    fertilize_reminder     = Boolean(default=True)
    photo_url              = String(500)
    product_id             = BigInt(optional=True)
    product_slug           = String(180)
    room                   = String(40)
    mist_every_days        = Int(default=0)
    rotate_every_days      = Int(default=0)
    repot_every_days       = Int(default=0)
    prune_every_days       = Int(default=0)
    mist_reminder          = Boolean(default=False)
    rotate_reminder        = Boolean(default=False)
    repot_reminder         = Boolean(default=False)
    prune_reminder         = Boolean(default=False)
    mist_next_at           = DateTime(optional=True)
    rotate_next_at         = DateTime(optional=True)
    repot_next_at          = DateTime(optional=True)
    prune_next_at          = DateTime(optional=True)
    snoozed_until          = DateTime(optional=True)


class PlantHealthLog(IdMixin, Base):
    __tablename__ = "plant_health_logs"

    owned_plant_id  = BigInt(link="owned_plants", index=True)
    user_id         = BigInt(optional=True, index=True)
    status          = String(32, default="ok")
    notes           = String(1000)
    photo_url       = String(500)
    recorded_at     = DateTime(now=True)
    follow_up_at    = DateTime(optional=True)


class NotificationPreference(IdMixin, Base):
    __tablename__ = "notification_preferences"

    user_id            = BigInt(link="users", unique=True)
    order_updates      = Boolean(default=True)
    promotions         = Boolean(default=False)
    care_reminders     = Boolean(default=True)
    weather_alerts     = Boolean(default=True)
    dootha_alerts      = Boolean(default=True)
    reminder_hour      = Int(default=8)
    quiet_start_hour   = Int(default=22)
    quiet_end_hour     = Int(default=7)
    vacation_until     = DateTime(optional=True)
    push_token         = String(255, secret=True)


class AppNotification(IdMixin, Base):
    __tablename__ = "app_notifications"
    __table_args__ = (Index("uq_app_notifications_dedupe_key", "dedupe_key", unique=True),)

    user_id          = BigInt(link="users", index=True)
    kind             = String(32, default="info")
    title            = String(140)
    body             = String(500)
    owned_plant_id   = BigInt(optional=True)
    order_id         = BigInt(optional=True)
    product_id       = BigInt(optional=True)
    href             = String(200)
    read_at          = DateTime(optional=True)
    dedupe_key       = String(120)


class SavedItem(IdMixin, Base):
    __tablename__ = "saved_items"
    __table_args__ = (Index("idx_saved_user_product", "user_id", "product_id", unique=True),)

    user_id          = BigInt(link="users")
    product_id       = BigInt(link="products")
    product_size_id  = BigInt(optional=True)
    pot              = String(80)
    quantity         = Int(default=1)
    product          = HasOne("Product")


class StoreCredit(IdMixin, Base):
    __tablename__ = "store_credits"
    __table_args__ = (CheckConstraint("balance >= 0", name="ck_store_credits_balance"),)

    user_id  = BigInt(link="users", unique=True)
    balance  = Float(default=0)


class CreditEntry(IdMixin, Base):
    __tablename__ = "credit_entries"

    user_id   = BigInt(link="users", index=True)
    amount    = Float(default=0)
    reason    = String(40)
    order_id  = BigInt(optional=True)


class SavedPaymentMethod(IdMixin, Base):
    """A label the customer recognises. A full card number is never stored."""

    __tablename__ = "saved_payment_methods"

    user_id     = BigInt(link="users", index=True)
    kind        = String(16, default="upi")
    label       = String(40)
    detail      = String(80)
    is_default  = Boolean(default=False)


class RecentView(IdMixin, Base):
    __tablename__ = "recent_views"
    __table_args__ = (Index("idx_recent_user_product", "user_id", "product_id", unique=True),)

    user_id     = BigInt(link="users")
    product_id  = BigInt(link="products")
    viewed_at   = DateTime(now=True)
    product     = HasOne("Product")


class CartSnapshot(IdMixin, Base):
    __tablename__ = "cart_snapshots"

    user_id      = BigInt(link="users", unique=True)
    items_json   = Text(default="[]")
    item_count   = Int(default=0)
    notified_at  = DateTime(optional=True)


class ChatTurn(IdMixin, Base):
    __tablename__ = "chat_turns"

    user_id  = BigInt(link="users", index=True)
    role     = String(16, default="user")
    content  = Text()


class QuoteRequest(IdMixin, Base):
    __tablename__ = "quote_requests"

    user_id      = BigInt(optional=True, index=True)
    estimate_no  = String(40)
    name         = String(100)
    phone        = String(20)
    email        = String(160)
    summary      = String(300)
    amount       = Float(default=0)
    status       = String(16, default="sent")
