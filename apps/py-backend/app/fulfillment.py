"""How an order can reach the customer.

This module is pure: no database, no HTTP. Checkout asks it "given this
cart and this address, which channels exist and what does each cost?"
The courier's own rate is recorded as Growman's cost. The customer pays
the zone band, which stays predictable.

Zones are bands, not exact kilometres, because road distance is longer
than the straight line and a one-kilometre error should not change the fee.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

SIZE_RANK = {"small": 0, "medium": 1, "large": 2, "xl": 3}
ZONE_RANK = {"store_local": 0, "near": 1, "mid": 2, "far": 3, "outside": 4}
# Unknown distance is priced like the far band, not like "free".
UNKNOWN_RANK = ZONE_RANK["far"]

# Locality centroids for customers who deny browser geolocation.
# Good to a kilometre or two, which is enough: fees change every 10 km.
PINCODE_CENTROIDS: dict[str, tuple[float, float]] = {
    "500001": (17.3800, 78.4750),
    "500002": (17.3616, 78.4747),
    "500004": (17.3950, 78.4600),
    "500008": (17.3833, 78.4011),
    "500016": (17.4400, 78.4600),
    "500019": (17.4850, 78.4050),
    "500028": (17.3950, 78.4350),
    "500032": (17.4400, 78.3480),
    "500033": (17.4300, 78.4070),
    "500034": (17.4130, 78.4400),
    "500038": (17.4370, 78.4480),
    "500049": (17.4700, 78.3200),
    "500081": (17.4600, 78.3650),
    "500084": (17.4700, 78.3600),
}

# 500 is Hyderabad city. 501/502 are the surrounding districts: reachable,
# but an unmapped one is not assumed to be close.
SERVICE_PREFIXES = {"500", "501", "502"}


def round2(value: float) -> float:
    return round(value * 100) / 100


def normalize_size(raw: str | None) -> str:
    # Unknown falls back to small. A mis-tag then causes a failed pickup
    # someone will see, rather than a silent "quote only" that loses the order.
    key = (raw or "").strip().lower()
    return key if key in SIZE_RANK else "small"


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lng / 2) ** 2
    )
    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


@dataclass
class CartItem:
    size_class: str = "small"
    bulky: bool = False
    quantity: int = 1
    unit_price: float = 0


@dataclass
class Cart:
    items: list[CartItem] = field(default_factory=list)

    @property
    def subtotal(self) -> float:
        return round2(sum(i.unit_price * i.quantity for i in self.items))

    @property
    def units(self) -> int:
        return sum(i.quantity for i in self.items)

    @property
    def max_size(self) -> str:
        best = "small"
        for item in self.items:
            size = normalize_size(item.size_class)
            if SIZE_RANK[size] > SIZE_RANK[best]:
                best = size
        return best

    @property
    def bulky(self) -> bool:
        return any(i.bulky for i in self.items)


@dataclass
class Policy:
    store_lat: float = 17.3850
    store_lng: float = 78.4867
    store_local_km: float = 10
    near_km: float = 20
    mid_km: float = 30
    far_km: float = 50
    retail_max_zone: str = "far"
    courier_provider: str = "Shiprocket"
    courier_fee: dict[str, float] = field(
        default_factory=lambda: {"store_local": 59, "near": 99, "mid": 129, "far": 179}
    )
    courier_max_size: str = "medium"
    courier_max_units: int = 8
    own_vehicle_fee: dict[str, float] = field(
        default_factory=lambda: {"store_local": 299, "near": 399, "mid": 549, "far": 799}
    )
    own_vehicle_min_subtotal: float = 2500
    free_delivery_min_subtotal: float = 0
    free_delivery_max_zone: str = "near"
    bulk_min_units: int = 10
    bulk_min_subtotal: float = 15000

    def zone_for_km(self, km: float) -> str:
        if km <= self.store_local_km:
            return "store_local"
        if km <= self.near_km:
            return "near"
        if km <= self.mid_km:
            return "mid"
        if km <= self.far_km:
            return "far"
        return "outside"

    def resolve(self, lat: float | None, lng: float | None, pincode: str) -> tuple[float | None, str, str]:
        if lat is not None and lng is not None:
            km = haversine_km(self.store_lat, self.store_lng, lat, lng)
            return km, self.zone_for_km(km), "coordinates"
        pin = (pincode or "").strip()
        centroid = PINCODE_CENTROIDS.get(pin)
        if centroid:
            km = haversine_km(self.store_lat, self.store_lng, centroid[0], centroid[1])
            return km, self.zone_for_km(km), "pincode"
        # An unmapped 500xxx address is still in the city. Price it as mid
        # rather than forcing a custom quote for a missing table row.
        if len(pin) == 6 and pin.startswith("500"):
            return None, "mid", "pincode_prefix"
        if len(pin) == 6 and pin[:3] in SERVICE_PREFIXES:
            return None, "unknown", "none"
        return None, "outside", "none"


def _rank(zone: str) -> int:
    if zone == "unknown":
        return UNKNOWN_RANK
    return ZONE_RANK.get(zone, 99)


def within_retail(policy: Policy, zone: str) -> bool:
    # Unknown is the absence of a distance, not a far one. Quoting a retail
    # fee for an address that might be 20 km or 200 km away is a bad bet.
    if zone in {"unknown", "outside"}:
        return False
    cap = policy.retail_max_zone if policy.retail_max_zone in ZONE_RANK else "far"
    return _rank(zone) <= ZONE_RANK[cap]


def _fee_for(table: dict[str, float], zone: str) -> float:
    if zone == "unknown":
        return table.get("far", 0)
    return table.get(zone, 0)


@dataclass
class Option:
    channel: str
    available: bool
    label: str
    fee: float = 0
    fee_waived: bool = False
    reason: str = ""

    def as_dict(self) -> dict:
        body = {
            "channel": self.channel,
            "available": self.available,
            "label": self.label,
            "fee": self.fee,
            "feeWaived": self.fee_waived,
        }
        if self.reason:
            body["reason"] = self.reason
        return body


def quote(
    policy: Policy,
    cart: Cart,
    lat: float | None,
    lng: float | None,
    pincode: str,
    *,
    courier_checked: bool = False,
    courier_serviceable: bool = True,
    courier_rate: float | None = None,
    courier_name: str = "",
    courier_days: int = 0,
) -> dict:
    km, zone, source = policy.resolve(lat, lng, pincode)
    bulk = (
        cart.units >= policy.bulk_min_units
        or cart.subtotal >= policy.bulk_min_subtotal
        or cart.max_size == "xl"
        or not within_retail(policy, zone)
    )

    pickup = Option("store_pickup", True, "Visit Store", 0)
    courier = _courier(policy, cart, zone, bulk, courier_checked, courier_serviceable)
    own = _own_vehicle(policy, cart, zone, bulk)
    bulk_opt = Option("bulk_quote", True, "Get Bulk Quote", reason="quote_required" if bulk else "")

    if bulk:
        recommended = "bulk_quote"
    elif zone == "store_local" and pickup.available:
        recommended = "store_pickup"
    elif courier.available:
        recommended = "courier"
    elif own.available:
        recommended = "own_vehicle"
    elif pickup.available:
        recommended = "store_pickup"
    else:
        recommended = "bulk_quote"

    gap = 0.0
    free_zone = ZONE_RANK.get(policy.free_delivery_max_zone, 1)
    free_applies = (
        policy.free_delivery_min_subtotal > 0
        and zone not in {"outside"}
        and _rank(zone) <= free_zone
    )
    if free_applies and courier.available and not courier.fee_waived:
        gap = max(round2(policy.free_delivery_min_subtotal - cart.subtotal), 0)

    body = {
        "zone": zone,
        "distanceKm": round2(km) if km is not None else None,
        "distanceSource": source,
        "subtotal": cart.subtotal,
        "units": cart.units,
        "maxSizeClass": cart.max_size,
        "options": [o.as_dict() for o in (pickup, courier, own, bulk_opt)],
        "recommended": recommended,
        "storeVisitSuggested": pickup.available and _rank(zone) <= ZONE_RANK["near"],
        "bulkRequired": bulk,
        "amountForFreeDelivery": gap,
        "estimatedDeliveryDays": courier_days if courier.available and courier_checked else 0,
    }
    # Cost side stays off the JSON the browser sees. Callers read these
    # attributes from the quote dict via the underscored keys below only
    # when recording the order, and ``as_dict`` never included them.
    body["_courierCost"] = round2(courier_rate) if courier.available and courier_checked and courier_rate is not None else None
    body["_courierName"] = courier_name if courier.available else ""
    return body


def _courier(policy, cart, zone, bulk, checked, serviceable) -> Option:
    opt = Option("courier", False, "Home Delivery")
    if bulk:
        opt.reason = "bulk_order"
    elif not within_retail(policy, zone):
        opt.reason = "outside_delivery_radius"
    elif checked and not serviceable:
        # Only a definite "no" blocks delivery. A skipped lookup leaves
        # the static fee, because a slow courier API must not lose the sale.
        opt.reason = "courier_not_serviceable"
    elif cart.bulky:
        opt.reason = "item_too_bulky"
    elif SIZE_RANK[cart.max_size] > SIZE_RANK[normalize_size(policy.courier_max_size)]:
        opt.reason = "plant_too_large"
    elif cart.units > policy.courier_max_units:
        opt.reason = "too_many_plants"
    else:
        opt.available = True
        opt.fee = round2(_fee_for(policy.courier_fee, zone))
        free_zone = ZONE_RANK.get(policy.free_delivery_max_zone, 1)
        if (
            policy.free_delivery_min_subtotal > 0
            and zone != "outside"
            and _rank(zone) <= free_zone
            and cart.subtotal >= policy.free_delivery_min_subtotal
        ):
            opt.fee = 0
            opt.fee_waived = True
            opt.label = "FREE Delivery"
    return opt


def _own_vehicle(policy, cart, zone, bulk) -> Option:
    opt = Option("own_vehicle", False, "Growman Delivery")
    if bulk:
        opt.reason = "bulk_order"
    elif not within_retail(policy, zone):
        opt.reason = "outside_delivery_radius"
    elif cart.subtotal < policy.own_vehicle_min_subtotal:
        opt.reason = "below_minimum_order"
    else:
        opt.available = True
        opt.fee = round2(_fee_for(policy.own_vehicle_fee, zone))
    return opt


def policy_from_settings(settings) -> Policy:
    policy = Policy()
    if settings.store_latitude and settings.store_longitude:
        policy.store_lat = settings.store_latitude
        policy.store_lng = settings.store_longitude
    if settings.courier_provider:
        policy.courier_provider = settings.courier_provider
    if settings.retail_max_zone in ZONE_RANK:
        policy.retail_max_zone = settings.retail_max_zone
    policy.free_delivery_min_subtotal = settings.free_delivery_min_subtotal
    if settings.own_vehicle_min_subtotal > 0:
        policy.own_vehicle_min_subtotal = settings.own_vehicle_min_subtotal
    if settings.bulk_min_units > 0:
        policy.bulk_min_units = settings.bulk_min_units
    if settings.bulk_min_subtotal > 0:
        policy.bulk_min_subtotal = settings.bulk_min_subtotal
    return policy


def option_for(quoted: dict, channel: str) -> dict | None:
    for opt in quoted["options"]:
        if opt["channel"] == channel:
            return opt
    return None
