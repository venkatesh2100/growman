"""Shiprocket client.

Checkout uses serviceability only to learn Growman's cost. A timeout or a
missing credential leaves the zone fee in place; it does not refuse the
order. Booking, after payment, fails loudly: a shipment that silently
does not exist is worse than an error a person can retry.

Tokens last about 10 days. A static token is used until the API rejects
it, then email and password take over if they are set.
"""

from __future__ import annotations

import logging
import threading
import time

import httpx

log = logging.getLogger("growman.shiprocket")

BASE = "https://apiv2.shiprocket.in/v1/external"


class Shiprocket:
    def __init__(self, email: str, password: str, token: str):
        self.email = email.strip()
        self.password = password
        self.static_token = token.strip()
        self._token = self.static_token
        self._token_at = time.monotonic() if self.static_token else 0
        self._mu = threading.Lock()
        self._failures = 0
        self._opened_at = 0.0

    @property
    def configured(self) -> bool:
        return bool(self.static_token or (self.email and self.password))

    def _circuit_open(self) -> bool:
        if self._failures < 3:
            return False
        if time.monotonic() - self._opened_at > 300:
            self._failures = 0
            return False
        return True

    def _auth(self) -> str:
        with self._mu:
            if self._token and time.monotonic() - self._token_at < 9 * 24 * 3600:
                return self._token
            if not (self.email and self.password):
                if self.static_token:
                    return self.static_token
                raise RuntimeError("shiprocket not configured")
            response = httpx.post(
                BASE + "/auth/login",
                json={"email": self.email, "password": self.password},
                timeout=15,
            )
            response.raise_for_status()
            self._token = response.json()["token"]
            self._token_at = time.monotonic()
            return self._token

    def serviceability(self, pickup: str, delivery: str, weight_kg: float) -> dict | None:
        """None means "no answer", which checkout treats as still deliverable."""
        if not self.configured or not pickup or self._circuit_open():
            return None
        try:
            token = self._auth()
            response = httpx.get(
                BASE + "/courier/serviceability/",
                params={
                    "pickup_postcode": pickup,
                    "delivery_postcode": delivery,
                    "weight": max(weight_kg, 0.5),
                    "cod": 0,
                },
                headers={"Authorization": f"Bearer {token}"},
                timeout=4,
            )
            response.raise_for_status()
            data = response.json().get("data") or {}
            couriers = data.get("available_courier_companies") or []
            self._failures = 0
            if not couriers:
                return {"serviceable": False}
            best = min(couriers, key=lambda c: float(c.get("rate") or 1e9))
            return {
                "serviceable": True,
                "rate": float(best.get("rate") or 0),
                "name": best.get("courier_name") or "",
                "days": int(best.get("estimated_delivery_days") or 0),
            }
        except Exception as exc:  # noqa: BLE001 — checkout must survive this
            self._failures += 1
            if self._failures >= 3:
                self._opened_at = time.monotonic()
            log.info("shiprocket serviceability skipped: %s", exc)
            return None

    def book(self, order, pickup_location: str) -> dict:
        token = self._auth()
        items = [
            {
                "name": item.name or "Plant",
                "sku": f"GRW-{item.product_id}",
                "units": item.quantity,
                "selling_price": item.price,
            }
            for item in order.items
        ]
        payload = {
            "order_id": str(order.id),
            "order_date": order.created_at.strftime("%Y-%m-%d %H:%M"),
            "pickup_location": pickup_location,
            "billing_customer_name": order.customer_name or "Customer",
            "billing_last_name": "",
            "billing_address": order.address_line or "Address",
            "billing_city": order.city or "Hyderabad",
            "billing_pincode": order.pincode,
            "billing_state": order.state or "Telangana",
            "billing_country": "India",
            "billing_email": order.customer_email or "orders@growman.live",
            "billing_phone": order.customer_phone,
            "shipping_is_billing": True,
            "order_items": items,
            "payment_method": "Prepaid",
            "sub_total": order.subtotal or order.amount,
            "length": 20,
            "breadth": 20,
            "height": 20,
            "weight": 1,
        }
        created = httpx.post(
            BASE + "/orders/create/adhoc",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
            timeout=25,
        )
        created.raise_for_status()
        body = created.json()
        shipment_id = body.get("shipment_id")
        if not shipment_id:
            raise RuntimeError(f"shiprocket order without shipment: {body.get('message')}")
        awb = httpx.post(
            BASE + "/courier/assign/awb",
            json={"shipment_id": shipment_id},
            headers={"Authorization": f"Bearer {token}"},
            timeout=25,
        )
        awb.raise_for_status()
        data = ((awb.json().get("response") or {}).get("data") or {})
        code = data.get("awb_code") or ""
        return {
            "shipmentId": str(shipment_id),
            "awb": code,
            "courier": data.get("courier_name") or "",
            "trackingUrl": f"https://shiprocket.co/tracking/{code}" if code else "",
        }

    def pickup(self, shipment_id: str) -> None:
        token = self._auth()
        response = httpx.post(
            BASE + "/courier/generate/pickup",
            json={"shipment_id": [int(shipment_id)]},
            headers={"Authorization": f"Bearer {token}"},
            timeout=25,
        )
        response.raise_for_status()
