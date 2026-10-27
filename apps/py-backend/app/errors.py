"""Errors the API is willing to show a client.

Raise ``APIError`` from a handler. The app turns it into
``{"error": "..."}`` plus any extra fields (``reason``, ``items``, ...).
Everything else becomes a 500 and is logged, so a stack trace never
becomes the response body.
"""

from __future__ import annotations


class APIError(Exception):
    def __init__(self, status: int, message: str, **extra):
        super().__init__(message)
        self.status = status
        self.message = message
        self.extra = extra


class OutOfStock(APIError):
    def __init__(self, name: str = "", product_id: int | None = None, items: list | None = None):
        reason = (
            f"{name} is no longer available in the requested quantity"
            if name
            else "That item is no longer available in the requested quantity"
        )
        super().__init__(409, "out_of_stock", reason=reason, items=items or [], productId=product_id)


class CouponRejected(APIError):
    def __init__(self, reason: str):
        super().__init__(422, "coupon_rejected", reason=reason)
