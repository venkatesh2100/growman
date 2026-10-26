"""Live price, stock, and identity from the Go catalog API.

This process does not open Postgres and does not read orders. A listing is
authoritative only for the fields the public product API returns.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import httpx


@dataclass
class LiveProduct:
    name: str
    slug: str
    price: float = 0
    mrp: float = 0
    stock: int = 0
    status: str = "active"
    track_inventory: bool = True
    short_desc: str = ""
    tags: list[str] = field(default_factory=list)
    sizes: list[dict] = field(default_factory=list)
    category: str = ""

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "slug": self.slug,
            "price": self.price,
            "mrp": self.mrp,
            "stock": self.stock,
            "status": self.status,
            "trackInventory": self.track_inventory,
            "shortDescription": self.short_desc,
            "tags": self.tags,
            "sizes": self.sizes,
            "category": self.category,
        }


def parse_product(raw: dict) -> LiveProduct | None:
    name = (raw.get("name") or "").strip()
    slug = (raw.get("slug") or "").strip()
    if not name or not slug:
        return None
    category = raw.get("category") or {}
    category_name = category.get("name") if isinstance(category, dict) else ""
    sizes = []
    for size in raw.get("sizes") or []:
        if not isinstance(size, dict):
            continue
        sizes.append(
            {
                "label": size.get("label") or "",
                "price": _num(size.get("price")),
                "stock": int(_num(size.get("stock"))),
            }
        )
    return LiveProduct(
        name=name,
        slug=slug,
        price=_num(raw.get("price")),
        mrp=_num(raw.get("mrp")),
        stock=int(_num(raw.get("stock"))),
        status=(raw.get("status") or "active").strip() or "active",
        track_inventory=bool(raw.get("trackInventory", True)),
        short_desc=(raw.get("shortDescription") or raw.get("short_desc") or "").strip(),
        tags=[str(tag) for tag in (raw.get("tags") or [])],
        sizes=sizes,
        category=category_name or "",
    )


def _num(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


class HttpCatalog:
    """Reads the public Go catalog. Failures leave the last good listing in place."""

    def __init__(self, base_url: str, client: httpx.Client | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self._client = client or httpx.Client(timeout=5)
        self._listings: list[LiveProduct] = []
        self._synced_at = 0.0

    def listings(self) -> list[LiveProduct]:
        if not self._listings or time.time() - self._synced_at > 600:
            self.refresh()
        return list(self._listings)

    def refresh(self) -> list[LiveProduct]:
        try:
            fetched = self._fetch_all()
        except httpx.HTTPError:
            return list(self._listings)
        if fetched:
            self._listings = fetched
            self._synced_at = time.time()
        return list(self._listings)

    def search(self, query: str, limit: int = 8) -> list[LiveProduct]:
        query = (query or "").strip()
        if not query:
            return []
        try:
            response = self._client.get(
                f"{self.base_url}/products/search",
                params={"q": query[:80], "pageSize": max(1, min(limit, 20))},
            )
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError):
            return _local_search(self._listings, query, limit)
        return _active(payload)[:limit]

    def by_slug(self, slug: str) -> LiveProduct | None:
        if not slug:
            return None
        try:
            response = self._client.get(f"{self.base_url}/products/{slug}")
            if response.status_code == 404:
                return None
            response.raise_for_status()
            return parse_product(response.json())
        except (httpx.HTTPError, ValueError):
            for product in self._listings:
                if product.slug == slug:
                    return product
            return None

    def _fetch_all(self) -> list[LiveProduct]:
        found: list[LiveProduct] = []
        page = 1
        while page <= 20:
            response = self._client.get(
                f"{self.base_url}/products",
                params={"page": page, "pageSize": 100},
            )
            response.raise_for_status()
            payload = response.json()
            found.extend(_active(payload))
            pagination = payload.get("pagination") or {}
            if not pagination.get("hasNext"):
                break
            page += 1
        return found


class StaticCatalog:
    """In-memory catalog for tests and for when the API is not running."""

    def __init__(self, products: list[LiveProduct]) -> None:
        self._products = [product for product in products if product.status == "active"]

    def listings(self) -> list[LiveProduct]:
        return list(self._products)

    def refresh(self) -> list[LiveProduct]:
        return self.listings()

    def search(self, query: str, limit: int = 8) -> list[LiveProduct]:
        return _local_search(self._products, query, limit)

    def by_slug(self, slug: str) -> LiveProduct | None:
        for product in self._products:
            if product.slug == slug:
                return product
        return None


def _active(payload: dict) -> list[LiveProduct]:
    rows = payload.get("data") if isinstance(payload, dict) else None
    if rows is None and isinstance(payload, dict) and payload.get("slug"):
        rows = [payload]
    products = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        product = parse_product(row)
        if product and product.status == "active":
            products.append(product)
    return products


def _local_search(products: list[LiveProduct], query: str, limit: int) -> list[LiveProduct]:
    tokens = [tok for tok in query.lower().split() if len(tok) > 2]
    if not tokens:
        return []
    scored = []
    for product in products:
        hay = f"{product.name} {product.short_desc} {' '.join(product.tags)}".lower()
        score = sum(1 for tok in tokens if tok in hay)
        if score:
            scored.append((score, product))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [product for _, product in scored[:limit]]
