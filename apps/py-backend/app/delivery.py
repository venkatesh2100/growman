"""How an order can reach the customer. No database and no HTTP.

Bands, not exact kilometres, set the fee. The hardest plant in the cart
decides the channel. A bulk cart is quoted by sales and cannot be paid
here. Store pickup is always free.
"""

import math

FEES = {"store_local": 59, "near": 99, "mid": 129, "far": 179}
VAN = {"store_local": 299, "near": 399, "mid": 549, "far": 799}
RANK = {"small": 0, "medium": 1, "large": 2, "xl": 3}
ZONE_RANK = {"store_local": 0, "near": 1, "mid": 2, "far": 3, "outside": 4, "unknown": 3}

# Locality centroids. A missing 500xxx pin is still Hyderabad (mid band).
# 501/502 are nearby districts: reachable, but unmeasured until we have a point.
CENTROIDS = {
    "500001": (17.3800, 78.4750), "500002": (17.3616, 78.4747), "500003": (17.4200, 78.4950),
    "500004": (17.3950, 78.4600), "500008": (17.3833, 78.4011), "500009": (17.5100, 78.5000),
    "500012": (17.3700, 78.4900), "500013": (17.3900, 78.5150), "500016": (17.4400, 78.4600),
    "500018": (17.4600, 78.4400), "500019": (17.4850, 78.4050), "500020": (17.4100, 78.5000),
    "500028": (17.3950, 78.4350), "500029": (17.4000, 78.4830), "500032": (17.4400, 78.3480),
    "500033": (17.4300, 78.4070), "500034": (17.4130, 78.4400), "500035": (17.3200, 78.4000),
    "500036": (17.3750, 78.5050), "500038": (17.4370, 78.4480), "500039": (17.4000, 78.5600),
    "500047": (17.4550, 78.5300), "500048": (17.4900, 78.3600), "500049": (17.4700, 78.3200),
    "500050": (17.4950, 78.3300), "500055": (17.5050, 78.5100), "500058": (17.3400, 78.5600),
    "500060": (17.3700, 78.5300), "500062": (17.4800, 78.5600), "500064": (17.3560, 78.4600),
    "500068": (17.3300, 78.5500), "500070": (17.3600, 78.5600), "500072": (17.4870, 78.3900),
    "500073": (17.4200, 78.4200), "500074": (17.3700, 78.5700), "500081": (17.4600, 78.3650),
    "500084": (17.4700, 78.3600), "500085": (17.4930, 78.3910), "500089": (17.4030, 78.3800),
    "500090": (17.5300, 78.3800), "501301": (17.2500, 78.4100), "501218": (17.0700, 78.2000),
    "502032": (17.5300, 78.2600), "502319": (17.6200, 78.0800),
}


def money(value: float) -> float:
    return round(float(value) + 1e-9, 2)


def _km(lat1, lng1, lat2, lng2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat, dlng = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlng / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _zone(km: float) -> str:
    if km <= 10:
        return "store_local"
    if km <= 20:
        return "near"
    if km <= 30:
        return "mid"
    if km <= 50:
        return "far"
    return "outside"


def _place(pincode: str, lat, lng, store) -> tuple[float | None, str, str]:
    if lat is not None and lng is not None:
        dist = _km(store[0], store[1], float(lat), float(lng))
        return money(dist), _zone(dist), "coordinates"
    pin = (pincode or "").strip()
    if pin in CENTROIDS:
        dist = _km(store[0], store[1], *CENTROIDS[pin])
        return money(dist), _zone(dist), "pincode"
    if len(pin) == 6 and pin.startswith("500"):
        return None, "mid", "pincode_prefix"
    if len(pin) == 6 and pin[:3] in {"501", "502"}:
        return None, "unknown", "none"
    return None, "outside", "none"


def quote(lines: list[dict], *, pincode="", lat=None, lng=None, store=(17.385, 78.4867),
          free_min=0, own_min=2500, bulk_units=10, bulk_subtotal=15000, retail_max="far") -> dict:
    subtotal = money(sum(row["price"] * row["quantity"] for row in lines))
    units = sum(int(row["quantity"]) for row in lines)
    size = "small"
    bulky = False
    for row in lines:
        kind = row.get("size") or "small"
        if RANK.get(kind, 0) > RANK[size]:
            size = kind if kind in RANK else "small"
        bulky = bulky or bool(row.get("bulky"))
    distance, zone, source = _place(pincode, lat, lng, store)
    retail = zone not in {"unknown", "outside"} and ZONE_RANK[zone] <= ZONE_RANK.get(retail_max, 3)
    bulk = units >= bulk_units or subtotal >= bulk_subtotal or size == "xl" or not retail

    def option(channel, label, available, fee=0, reason="", waived=False):
        row = {"channel": channel, "available": available, "label": label, "fee": money(fee), "feeWaived": waived}
        if reason:
            row["reason"] = reason
        return row

    pickup = option("store_pickup", "Visit Store", True, 0)
    if bulk:
        courier = option("courier", "Home Delivery", False, reason="bulk_order")
        van = option("own_vehicle", "Growman Delivery", False, reason="bulk_order")
    elif not retail:
        reason = "outside_delivery_radius"
        courier = option("courier", "Home Delivery", False, reason=reason)
        van = option("own_vehicle", "Growman Delivery", False, reason=reason)
    else:
        if bulky:
            courier = option("courier", "Home Delivery", False, reason="item_too_bulky")
        elif RANK[size] > RANK["medium"]:
            courier = option("courier", "Home Delivery", False, reason="plant_too_large")
        elif units > 8:
            courier = option("courier", "Home Delivery", False, reason="too_many_plants")
        else:
            fee = FEES.get(zone, FEES["far"])
            waived = free_min > 0 and subtotal >= free_min and ZONE_RANK[zone] <= ZONE_RANK["near"]
            courier = option("courier", "FREE Delivery" if waived else "Home Delivery", True, 0 if waived else fee, waived=waived)
        if subtotal < own_min:
            van = option("own_vehicle", "Growman Delivery", False, reason="below_minimum_order")
        else:
            van = option("own_vehicle", "Growman Delivery", True, VAN.get(zone, VAN["far"]))
    sales = option("bulk_quote", "Get Bulk Quote", True, reason="quote_required" if bulk else "")

    if bulk:
        recommended = "bulk_quote"
    elif zone == "store_local":
        recommended = "store_pickup"
    elif courier["available"]:
        recommended = "courier"
    elif van["available"]:
        recommended = "own_vehicle"
    else:
        recommended = "store_pickup"
    gap = 0.0
    if free_min > 0 and zone in {"store_local", "near"} and subtotal < free_min and courier["available"] and not courier["feeWaived"]:
        gap = money(free_min - subtotal)
    return {
        "zone": zone,
        "distanceKm": distance,
        "distanceSource": source,
        "subtotal": subtotal,
        "units": units,
        "maxSizeClass": size,
        "options": [pickup, courier, van, sales],
        "recommended": recommended,
        "storeVisitSuggested": zone in {"store_local", "near"},
        "bulkRequired": bulk,
        "amountForFreeDelivery": gap,
    }


def option(quoted: dict, channel: str) -> dict | None:
    for row in quoted["options"]:
        if row["channel"] == channel:
            return row
    return None
