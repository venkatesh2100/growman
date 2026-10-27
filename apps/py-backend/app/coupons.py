"""Coupons are evaluated on the server. The client sends a code, never a price.

The same function runs for the preview and again inside the order
transaction. A global cap is a conditional update (``usage_count < limit``),
so two checkouts cannot both sneak past a code that has one use left.
Per-user limits are counts, so they are re-checked while the coupon row
is locked.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.errors import CouponRejected
from app.fulfillment import round2
from app.models import Coupon, CouponRedemption, Order, OrderItem, Product, alive, utcnow


@dataclass
class Discount:
    coupon: Coupon
    code: str
    type: str
    amount: float
    free_shipping: bool
    description: str


def evaluate(
    db: Session,
    code: str,
    subtotal: float,
    items: list[OrderItem],
    user_id: int | None,
    email: str,
) -> Discount:
    code = (code or "").strip().upper()
    if not code:
        raise CouponRejected("Enter a coupon code.")
    coupon = db.scalar(select(Coupon).where(Coupon.code == code, alive(Coupon)))
    if coupon is None:
        raise CouponRejected("That code isn't valid.")
    now = utcnow()
    if not coupon.active:
        raise CouponRejected("That code is no longer active.")
    if coupon.starts_at and now < coupon.starts_at:
        raise CouponRejected("That code isn't active yet.")
    if coupon.expires_at and now > coupon.expires_at:
        raise CouponRejected("That code has expired.")
    if coupon.usage_limit > 0 and coupon.usage_count >= coupon.usage_limit:
        raise CouponRejected("That code has been fully redeemed.")

    eligible = subtotal
    if coupon.category_ids or coupon.product_ids:
        eligible = _eligible(db, coupon, items)
        if eligible <= 0:
            raise CouponRejected("That code doesn't apply to anything in your cart.")
    if coupon.min_subtotal > 0 and eligible < coupon.min_subtotal:
        gap = round2(coupon.min_subtotal - eligible)
        raise CouponRejected(f"Add ₹{gap:g} more to use this code.")
    _check_usage(db, coupon, user_id, email)

    amount = 0.0
    free_shipping = False
    if coupon.type == "percentage":
        amount = eligible * coupon.value / 100
        if coupon.max_discount > 0:
            amount = min(amount, coupon.max_discount)
    elif coupon.type == "fixed":
        amount = coupon.value
    elif coupon.type == "free_shipping":
        free_shipping = True
    else:
        raise CouponRejected("That code isn't valid.")
    amount = round2(min(amount, eligible))
    return Discount(coupon, coupon.code, coupon.type, amount, free_shipping, coupon.description)


def _eligible(db: Session, coupon: Coupon, items: list[OrderItem]) -> float:
    products = {int(x) for x in coupon.product_ids or [] if str(x).isdigit()}
    categories = {int(x) for x in coupon.category_ids or [] if str(x).isdigit()}
    by_product: dict[int, int] = {}
    if categories:
        ids = [i.product_id for i in items]
        rows = db.execute(select(Product.id, Product.category_id).where(Product.id.in_(ids))).all()
        by_product = {row[0]: row[1] for row in rows}
    total = 0.0
    for item in items:
        if item.product_id in products or by_product.get(item.product_id) in categories:
            total += item.price * item.quantity
    return total


def _check_usage(db: Session, coupon: Coupon, user_id: int | None, email: str) -> None:
    if coupon.per_user_limit > 0 and (user_id or email):
        query = select(func.count()).select_from(CouponRedemption).where(CouponRedemption.coupon_id == coupon.id)
        if user_id:
            query = query.where(CouponRedemption.user_id == user_id)
        else:
            query = query.where(func.lower(CouponRedemption.email) == email.lower())
        used = db.scalar(query) or 0
        if used >= coupon.per_user_limit:
            raise CouponRejected("You've already used this code.")
    if coupon.first_order_only and (user_id or email):
        query = select(func.count()).select_from(Order).where(Order.payment_status == "paid", alive(Order))
        if user_id:
            query = query.where(Order.user_id == user_id)
        else:
            query = query.where(func.lower(Order.customer_email) == email.lower())
        if (db.scalar(query) or 0) > 0:
            raise CouponRejected("That code is for first orders only.")


def redeem(db: Session, discount: Discount | None, order: Order) -> None:
    if discount is None:
        return
    # Lock the coupon row so two checkouts of the same code cannot both
    # pass the per-user count.
    coupon = db.scalar(select(Coupon).where(Coupon.id == discount.coupon.id).with_for_update())
    if coupon is None:
        raise CouponRejected("That code isn't valid.")
    _check_usage(db, coupon, order.user_id, order.customer_email)
    if coupon.usage_limit > 0:
        result = db.execute(
            text(
                """
                UPDATE coupons
                SET usage_count = usage_count + 1, updated_at = NOW()
                WHERE id = :id AND usage_count < :limit
                """
            ),
            {"id": coupon.id, "limit": coupon.usage_limit},
        )
        if result.rowcount == 0:
            raise CouponRejected("That code has just been fully redeemed.")
    else:
        db.execute(
            text("UPDATE coupons SET usage_count = usage_count + 1, updated_at = NOW() WHERE id = :id"),
            {"id": coupon.id},
        )
    db.add(
        CouponRedemption(
            coupon_id=coupon.id,
            user_id=order.user_id,
            email=(order.customer_email or "").lower(),
            order_id=order.id,
            amount=discount.amount,
        )
    )
