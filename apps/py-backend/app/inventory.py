"""Stock: reserve at checkout, commit when paid, release if abandoned.

Stock is held from the moment the order is created, not from payment.
The window is minutes, and a customer on the payment screen should not
lose the plant to someone still browsing. The sweeper gives back stock
that was never paid for.

Every contested change is one SQL statement whose WHERE clause is the
check. Postgres serialises that. An application lock would be a second
thing that can fail, and a Redis lock can fail open — the wrong direction
for an oversell.

* Reserve: ``UPDATE ... WHERE stock >= quantity``. Zero rows means we lost.
* Release: set ``inventory_released`` first, and only credit stock if we
  won that update. A replay cannot add the units twice.
* Commit: if the sweeper already returned the units, take them again. The
  money has been captured, so a failed re-reserve does not un-pay the
  order; it raises a support ticket instead.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.errors import OutOfStock
from app.models import Order, OrderItem, utcnow

log = logging.getLogger("growman.inventory")

ABANDONED_AFTER = timedelta(minutes=30)


def reserve(db: Session, items: list[OrderItem]) -> None:
    for item in items:
        if item.quantity < 1:
            raise OutOfStock(name=item.name, product_id=item.product_id)
        if item.product_size_id:
            result = db.execute(
                text(
                    """
                    UPDATE product_sizes
                    SET stock = stock - :qty, updated_at = NOW()
                    WHERE id = :id AND stock >= :qty AND deleted_at IS NULL
                    """
                ),
                {"qty": item.quantity, "id": item.product_size_id},
            )
        else:
            # Untracked products stay available. The WHERE still matches the
            # row so Rows-style rowcount tells us the product exists.
            result = db.execute(
                text(
                    """
                    UPDATE products
                    SET stock = CASE WHEN track_inventory THEN stock - :qty ELSE stock END,
                        updated_at = NOW()
                    WHERE id = :id
                      AND deleted_at IS NULL
                      AND (track_inventory = false OR stock >= :qty)
                    """
                ),
                {"qty": item.quantity, "id": item.product_id},
            )
        if result.rowcount == 0:
            raise OutOfStock(name=item.name, product_id=item.product_id)


def release(db: Session, order: Order) -> bool:
    """Return reserved units. False when another caller already did."""
    claimed = db.execute(
        text(
            """
            UPDATE orders
            SET inventory_released = true, updated_at = NOW()
            WHERE id = :id AND inventory_released = false AND deleted_at IS NULL
            """
        ),
        {"id": order.id},
    )
    if claimed.rowcount == 0:
        return False
    items = order.items or db.query(OrderItem).filter(OrderItem.order_id == order.id).all()
    for item in items:
        if item.product_size_id:
            db.execute(
                text(
                    """
                    UPDATE product_sizes
                    SET stock = stock + :qty, updated_at = NOW()
                    WHERE id = :id
                    """
                ),
                {"qty": item.quantity, "id": item.product_size_id},
            )
        else:
            db.execute(
                text(
                    """
                    UPDATE products
                    SET stock = stock + :qty, updated_at = NOW()
                    WHERE id = :id AND track_inventory = true
                    """
                ),
                {"qty": item.quantity, "id": item.product_id},
            )
    order.inventory_released = True
    return True


def commit(db: Session, order: Order) -> None:
    """Make a reservation permanent, re-taking it if the sweep already ran."""
    held = db.execute(
        text(
            """
            UPDATE orders
            SET inventory_released = false, updated_at = NOW()
            WHERE id = :id AND inventory_released = false
            """
        ),
        {"id": order.id},
    )
    if held.rowcount == 1:
        return
    # Savepoint: a partial re-reserve must not undo the paid status the
    # caller already wrote in the outer transaction.
    nested = db.begin_nested()
    try:
        reserve(db, order.items)
        db.execute(
            text("UPDATE orders SET inventory_released = false, updated_at = NOW() WHERE id = :id"),
            {"id": order.id},
        )
        nested.commit()
    except Exception:
        nested.rollback()
        raise


def sweep_abandoned(db: Session) -> list[int]:
    """Give back stock from unpaid orders older than 30 minutes.

    ``payment_status`` stays ``created``. A slow bank redirect can still
    pay, and ``mark_order_paid`` knows how to re-reserve. ``SKIP LOCKED``
    lets two replicas sweep without blocking each other.
    """
    cutoff = utcnow() - ABANDONED_AFTER
    rows = db.execute(
        text(
            """
            WITH due AS (
                SELECT id FROM orders
                WHERE payment_status = 'created'
                  AND inventory_released = false
                  AND created_at < :cutoff
                  AND deleted_at IS NULL
                ORDER BY created_at
                LIMIT 200
                FOR UPDATE SKIP LOCKED
            )
            UPDATE orders AS o
            SET inventory_released = true,
                status = 'abandoned',
                updated_at = NOW()
            FROM due
            WHERE o.id = due.id
              AND o.payment_status = 'created'
              AND o.inventory_released = false
            RETURNING o.id
            """
        ),
        {"cutoff": cutoff},
    ).fetchall()
    if not rows:
        return []
    ids = [row[0] for row in rows]
    # Credit stock for the lines of the orders we actually claimed.
    db.execute(
        text(
            """
            UPDATE product_sizes AS s
            SET stock = s.stock + i.quantity, updated_at = NOW()
            FROM order_items AS i
            WHERE i.order_id = ANY(:ids)
              AND i.product_size = s.id
            """
        ),
        {"ids": ids},
    )
    db.execute(
        text(
            """
            UPDATE products AS p
            SET stock = p.stock + i.quantity, updated_at = NOW()
            FROM order_items AS i
            WHERE i.order_id = ANY(:ids)
              AND i.product_size IS NULL
              AND i.product_id = p.id
              AND p.track_inventory = true
            """
        ),
        {"ids": ids},
    )
    log.info("released stock for %s abandoned orders", len(ids))
    return ids


def notify_restock(db: Session, settings, product_id: int, size_id: int | None) -> None:
    """Email people who asked to hear when this shelf went from empty to available."""
    from sqlalchemy import or_, select

    from app.models import BackInStockRequest, Product
    from app.notify import send_email_now

    product = db.get(Product, product_id)
    if product is None:
        return
    query = select(BackInStockRequest).where(BackInStockRequest.product_id == product_id, BackInStockRequest.notified_at.is_(None))
    if size_id:
        query = query.where(or_(BackInStockRequest.product_size_id.is_(None), BackInStockRequest.product_size_id == size_id))
    else:
        query = query.where(BackInStockRequest.product_size_id.is_(None))
    now = utcnow()
    for row in db.scalars(query).all():
        if not row.email:
            continue
        try:
            send_email_now(
                settings,
                row.email,
                f"{product.name} is back in stock",
                f"{product.name} is available again.\nhttps://growman.live/product/{product.slug}\n",
            )
        except Exception as exc:  # noqa: BLE001 — leave notified_at empty so the next restock retries
            log.info("back-in-stock mail to %s failed: %s", row.email, exc)
            continue
        row.notified_at = now
