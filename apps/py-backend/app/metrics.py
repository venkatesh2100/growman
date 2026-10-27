"""Prometheus counters for the failures that must not be silent.

A jump in ``payment_signature_failures_total{stage="webhook"}`` means the
webhook secret does not match the dashboard. ``inventory_reservation_conflicts_total``
means two shoppers raced for the last unit — also the signal that stock
and reality have drifted.
"""

from prometheus_client import Counter, make_asgi_app

payment_signature_failures = Counter(
    "payment_signature_failures_total",
    "Rejected Razorpay signatures",
    ["stage"],
)
inventory_conflicts = Counter(
    "inventory_reservation_conflicts_total",
    "Orders that lost the race for stock",
)

metrics_app = make_asgi_app()
