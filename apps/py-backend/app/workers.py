"""In-process background work.

Three loops share the API process, the same choice as the Go service.
A second deployable would be more to operate than it saves. Every replica
runs every loop. That is safe because each transition is a conditional
update: two sweepers cannot both return the same stock.

Correctness holds. The duplicated scanning is the first thing to move
out if the replica count grows.
"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.inventory import sweep_abandoned
from app.models import Order, alive, utcnow
from app.privacy import sweep_expired

log = logging.getLogger("growman.workers")


async def run_workers(app, stop: asyncio.Event) -> None:
    tasks = [
        asyncio.create_task(_every(stop, 5 * 60, lambda: _sweep_stock(app), "inventory")),
        asyncio.create_task(_every(stop, 15 * 60, lambda: _ship(app), "shipments")),
        asyncio.create_task(_every(stop, 24 * 60 * 60, lambda: _retain(app), "retention")),
    ]
    await stop.wait()
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


async def _every(stop: asyncio.Event, seconds: int, fn, name: str) -> None:
    while not stop.is_set():
        try:
            await asyncio.to_thread(fn)
        except Exception:
            log.exception("worker %s failed", name)
        try:
            await asyncio.wait_for(stop.wait(), timeout=seconds)
        except TimeoutError:
            continue


def _sweep_stock(app) -> None:
    from datetime import timedelta

    from app.models import utcnow
    from app.notify import alert_ops, send_email

    factory = app.state.session_factory
    db = factory()
    try:
        ids = sweep_abandoned(db)
        if ids:
            orders = db.scalars(select(Order).where(Order.id.in_(ids)).options(selectinload(Order.items))).all()
            # Stock is returned for every unpaid order past 30 minutes,
            # including a backlog. Only a checkout that just expired is
            # worth an email, and each address hears once per pass.
            earliest = utcnow() - timedelta(minutes=45)
            mailed: set[str] = set()
            for order in sorted(orders, key=lambda row: row.created_at or earliest, reverse=True):
                if order.created_at and order.created_at < earliest:
                    continue
                email = (order.customer_email or "").strip().lower()
                if "@" not in email or email in mailed or len(mailed) >= 8:
                    continue
                mailed.add(email)
                names = ", ".join(item.name for item in order.items) or "your plants"
                send_email(
                    app.state.settings,
                    email,
                    "Your Growman checkout is still here",
                    f"Hi {order.customer_name},\n\nWe released {names} because payment did not finish. You can add them again from the shop.\n",
                )
            alert_ops(app.state.settings, f"{len(ids)} unpaid checkouts were abandoned and their stock was returned.")
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _retain(app) -> None:
    factory = app.state.session_factory
    db = factory()
    try:
        sweep_expired(db)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _ship(app) -> None:
    """Book couriers for paid orders that do not have an AWB yet."""
    client = app.state.shiprocket
    settings = app.state.settings
    if client is None or not client.configured or not settings.shiprocket_pickup_location:
        return
    factory = app.state.session_factory
    db = factory()
    try:
        orders = db.scalars(
            select(Order)
            .where(
                Order.payment_status == "paid",
                Order.fulfillment_channel == "courier",
                Order.awb_number == "",
                Order.cancelled_at.is_(None),
                alive(Order),
            )
            .options(selectinload(Order.items))
            .limit(20)
        ).all()
        for order in orders:
            try:
                booked = client.book(order, settings.shiprocket_pickup_location)
            except Exception as exc:  # noqa: BLE001 — one bad order must not stop the batch
                log.warning("shipment for order %s failed: %s", order.id, exc)
                continue
            order.shipment_id = booked["shipmentId"]
            order.awb_number = booked["awb"]
            order.tracking_url = booked["trackingUrl"]
            order.courier_service = booked["courier"] or order.courier_service
            if booked["awb"] and order.status != "shipped":
                order.status = "shipped"
                order.shipped_at = utcnow()
                from app.notify import send_email

                send_email(
                    settings,
                    order.customer_email,
                    f"Growman order {order.id} shipped",
                    f"Hi {order.customer_name},\n\nOrder #{order.id} is with {order.courier_service or 'the courier'}.\nAWB {order.awb_number}\n{order.tracking_url}\n",
                )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
