"""Catalog reads. This is most of the traffic, so list and detail responses
are cached. A mutation deletes the catalog prefixes rather than trying to
guess which keys an edit touched.

Prices on the way out are the database prices. Nothing in this file trusts
a price sent by the client.
"""

from __future__ import annotations

import json
import re

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.auth import require_admin, require_user
from app.errors import APIError
from app.models import (
    Attribute,
    BackInStockRequest,
    Brand,
    Category,
    Order,
    OrderItem,
    Product,
    ProductSize,
    Review,
    Subcategory,
    alive,
)
from app.present import product_card, product_detail, review_json
from app.responses import page_meta, parse_page, public_json
from app.routers.deps import get_db

router = APIRouter()

_CARD = (
    selectinload(Product.sizes),
    selectinload(Product.category),
    selectinload(Product.brand),
)
_DETAIL = _CARD + (
    selectinload(Product.attributes),
    selectinload(Product.subcategory),
    selectinload(Product.reviews).selectinload(Review.user),
)


def _base(request: Request) -> str:
    return request.app.state.settings.image_base_url


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug[:170] or "item"


@router.get("/products")
def list_products(request: Request, db: Session = Depends(get_db)):
    page, size, offset = parse_page(request)
    key = f"products:list:p{page}:s{size}"

    def load() -> bytes:
        total = db.scalar(select(func.count()).select_from(Product).where(alive(Product))) or 0
        rows = db.scalars(
            select(Product).where(alive(Product)).options(*_CARD).order_by(Product.created_at.desc()).offset(offset).limit(size)
        ).all()
        body = {
            "data": [product_card(p, _base(request)) for p in rows],
            "pagination": page_meta(page, size, total),
        }
        return json.dumps(body).encode()

    raw = request.app.state.cache.get_or_load(key, 600, load)
    return public_json(request, raw, max_age=60)


@router.get("/products/search")
def search_products(request: Request, db: Session = Depends(get_db)):
    q = (request.query_params.get("q") or "").strip()
    if len(q) < 2:
        raise APIError(400, "enter at least 2 characters")
    page, size, offset = parse_page(request)
    like = f"%{q}%"
    # ILIKE can use the trigram GIN indexes created at boot.
    cond = or_(Product.name.ilike(like), Product.short_desc.ilike(like))
    total = db.scalar(select(func.count()).select_from(Product).where(alive(Product), cond)) or 0
    rows = db.scalars(
        select(Product).where(alive(Product), cond).options(*_CARD).order_by(Product.featured.desc(), Product.created_at.desc()).offset(offset).limit(size)
    ).all()
    return {
        "data": [product_card(p, _base(request)) for p in rows],
        "pagination": page_meta(page, size, total),
    }


@router.get("/products/featured")
def featured(request: Request, db: Session = Depends(get_db)):
    def load() -> bytes:
        rows = db.scalars(
            select(Product)
            .where(alive(Product), Product.featured.is_(True), Product.status == "active")
            .options(*_CARD)
            .order_by(Product.created_at.desc())
            .limit(12)
        ).all()
        return json.dumps([product_card(p, _base(request)) for p in rows]).encode()

    return public_json(request, request.app.state.cache.get_or_load("products:featured", 600, load))


@router.get("/products/filters")
def filter_products(request: Request, db: Session = Depends(get_db)):
    """Tag and attribute filters used by the plant finder, not the grid search."""
    stmt = select(Product).where(alive(Product), Product.status == "active").options(*_CARD)
    wanted = []
    for key in ("light", "climate"):
        value = (request.query_params.get(key) or "").strip()
        if value:
            wanted.append(value)
    if request.query_params.get("petSafe") == "1":
        wanted.append("pet")
    if request.query_params.get("beginner") == "1":
        wanted.append("beginner")
    if request.query_params.get("indoor") == "1":
        wanted.append("indoor")
    if wanted:
        # ``@>`` asks whether the text[] contains this tag. The GIN index
        # on tags makes that cheap.
        for word in wanted:
            stmt = stmt.where(Product.tags.contains([word]))
    rows = db.scalars(stmt.order_by(Product.featured.desc()).limit(40)).all()
    return {"products": [product_card(p, _base(request)) for p in rows]}


@router.get("/products/{slug}")
def get_product(slug: str, request: Request, db: Session = Depends(get_db)):
    if not slug or len(slug) > 180:
        raise APIError(400, "invalid slug")

    def load() -> bytes:
        product = db.scalar(select(Product).where(Product.slug == slug, alive(Product)).options(*_DETAIL))
        if product is None:
            raise APIError(404, "product not found")
        # Public detail shows approved reviews only. Pending ones stay hidden.
        product.reviews = [r for r in product.reviews if r.status == "approved" and r.deleted_at is None][:12]
        return json.dumps(product_detail(product, _base(request))).encode()

    try:
        raw = request.app.state.cache.get_or_load(f"products:detail:{slug}", 1800, load)
    except APIError:
        raise
    return public_json(request, raw, max_age=120)


@router.get("/products/{slug}/related")
def related(slug: str, request: Request, db: Session = Depends(get_db)):
    product = db.scalar(select(Product).where(Product.slug == slug, alive(Product)))
    if product is None:
        raise APIError(404, "product not found")
    rows = db.scalars(
        select(Product)
        .where(alive(Product), Product.category_id == product.category_id, Product.id != product.id)
        .options(*_CARD)
        .limit(8)
    ).all()
    return {"products": [product_card(p, _base(request)) for p in rows]}


@router.get("/products/{slug}/companions")
def companions(slug: str, request: Request, db: Session = Depends(get_db)):
    """Pots, soil, and feed that sit next to a plant on the product page."""
    product = db.scalar(select(Product.id).where(Product.slug == slug, alive(Product)))
    if product is None:
        raise APIError(404, "product not found")
    like = or_(Product.name.ilike("%pot%"), Product.name.ilike("%soil%"), Product.name.ilike("%fertil%"))
    rows = db.scalars(select(Product).where(alive(Product), Product.id != product, like).options(*_CARD).limit(8)).all()
    return {"products": [product_card(p, _base(request)) for p in rows]}


@router.get("/products/{slug}/reviews")
def list_reviews(slug: str, request: Request, db: Session = Depends(get_db)):
    product = db.scalar(select(Product).where(Product.slug == slug, alive(Product)))
    if product is None:
        raise APIError(404, "product not found")
    page, size, offset = parse_page(request)
    cond = (Review.product_id == product.id, Review.status == "approved", alive(Review))
    total = db.scalar(select(func.count()).select_from(Review).where(*cond)) or 0
    rows = db.scalars(
        select(Review).where(*cond).options(selectinload(Review.user)).order_by(Review.created_at.desc()).offset(offset).limit(size)
    ).all()
    return {"data": [review_json(r, _base(request)) for r in rows], "pagination": page_meta(page, size, total)}


class ReviewIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    title: str = ""
    comment: str = ""


@router.post("/products/{slug}/reviews")
def create_review(slug: str, body: ReviewIn, request: Request, db: Session = Depends(get_db), claims=Depends(require_user)):
    product = db.scalar(select(Product).where(Product.slug == slug, alive(Product)))
    if product is None:
        raise APIError(404, "product not found")
    # The unique index is the real guard. This check is the friendly error
    # for the common case; a race still loses on the index.
    existing = db.scalar(select(Review.id).where(Review.product_id == product.id, Review.user_id == claims.user_id, alive(Review)))
    if existing:
        raise APIError(409, "you already reviewed this product")
    purchased = db.scalar(
        select(OrderItem.id)
        .join(Order, Order.id == OrderItem.order_id)
        .where(
            Order.user_id == claims.user_id,
            Order.payment_status == "paid",
            OrderItem.product_id == product.id,
            alive(Order),
        )
    )
    review = Review(
        product_id=product.id,
        user_id=claims.user_id,
        rating=body.rating,
        title=body.title[:160],
        comment=body.comment[:4000],
        status="pending",
        verified_purchase=purchased is not None,
    )
    db.add(review)
    db.flush()
    return review_json(review, _base(request))


class RestockIn(BaseModel):
    email: str
    productSizeId: int | None = None


@router.post("/products/{slug}/back-in-stock")
def back_in_stock(slug: str, body: RestockIn, db: Session = Depends(get_db)):
    product = db.scalar(select(Product).where(Product.slug == slug, alive(Product)))
    if product is None:
        raise APIError(404, "product not found")
    email = body.email.strip().lower()
    if "@" not in email:
        raise APIError(400, "invalid email format")
    exists = db.scalar(
        select(BackInStockRequest.id).where(
            BackInStockRequest.product_id == product.id,
            BackInStockRequest.email == email,
            BackInStockRequest.notified_at.is_(None),
        )
    )
    if exists is None:
        db.add(BackInStockRequest(product_id=product.id, email=email, product_size_id=body.productSizeId))
    return {"ok": True}


class ProductIn(BaseModel):
    name: str
    slug: str = ""
    price: float
    mrp: float = 0
    shortDescription: str = ""
    description: str = ""
    categoryId: int | None = None
    subcategoryId: int | None = None
    brandId: int | None = None
    stock: int = 0
    featured: bool = False
    tags: list[str] = []
    status: str = "active"
    sizeClass: str = "small"
    trackInventory: bool = True
    hsnCode: str = ""
    gstRate: float = 0
    imageKey: str = ""
    sizes: list[dict] = []
    attributes: list[dict] = []


@router.post("/products")
def create_product(body: ProductIn, request: Request, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    slug = body.slug or _slugify(body.name)
    if db.scalar(select(Product.id).where(Product.slug == slug)):
        raise APIError(409, "slug already exists")
    product = Product(
        name=body.name,
        slug=slug,
        price=body.price,
        mrp=body.mrp or body.price,
        short_desc=body.shortDescription,
        description=body.description,
        category_id=body.categoryId,
        subcategory_id=body.subcategoryId,
        brand_id=body.brandId,
        stock=body.stock,
        featured=body.featured,
        tags=body.tags,
        status=body.status,
        size_class=body.sizeClass,
        track_inventory=body.trackInventory,
        hsn_code=body.hsnCode,
        gst_rate=body.gstRate,
        image_key=body.imageKey,
    )
    db.add(product)
    db.flush()
    for size in body.sizes:
        db.add(
            ProductSize(
                product_id=product.id,
                label=size.get("label") or "",
                price=float(size.get("price") or 0),
                stock=int(size.get("stock") or 0),
            )
        )
    for attr in body.attributes:
        db.add(Attribute(product_id=product.id, name=attr.get("name") or "", value=attr.get("value") or ""))
    request.app.state.cache.invalidate_catalog()
    db.flush()
    return {"id": product.id, "slug": product.slug}


@router.put("/products/{slug}")
def update_product(slug: str, body: ProductIn, request: Request, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    product = db.scalar(select(Product).where(Product.slug == slug, alive(Product)))
    if product is None:
        raise APIError(404, "product not found")
    product.name = body.name
    product.price = body.price
    product.mrp = body.mrp or body.price
    product.short_desc = body.shortDescription
    product.description = body.description
    product.stock = body.stock
    product.featured = body.featured
    product.tags = body.tags
    product.status = body.status
    product.size_class = body.sizeClass
    product.track_inventory = body.trackInventory
    product.image_key = body.imageKey or product.image_key
    if body.categoryId:
        product.category_id = body.categoryId
    request.app.state.cache.invalidate_catalog()
    return {"id": product.id, "slug": product.slug}


@router.delete("/products/{slug}")
def delete_product(slug: str, request: Request, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    product = db.scalar(select(Product).where(Product.slug == slug, alive(Product)))
    if product is None:
        raise APIError(404, "product not found")
    from app.models import utcnow

    product.deleted_at = utcnow()
    request.app.state.cache.invalidate_catalog()
    return {"ok": True}


@router.get("/categories")
def list_categories(request: Request, db: Session = Depends(get_db)):
    def load() -> bytes:
        rows = db.scalars(select(Category).where(alive(Category)).options(selectinload(Category.subcategories))).all()
        body = [
            {
                "id": c.id,
                "name": c.name,
                "slug": c.slug,
                "description": c.description,
                "subcategories": [{"id": s.id, "name": s.name, "slug": s.slug} for s in c.subcategories if s.deleted_at is None],
            }
            for c in rows
        ]
        return json.dumps(body).encode()

    return public_json(request, request.app.state.cache.get_or_load("categories:all", 600, load))


@router.get("/categories/{slug}")
def get_category(slug: str, request: Request, db: Session = Depends(get_db)):
    cat = db.scalar(select(Category).where(Category.slug == slug, alive(Category)).options(selectinload(Category.subcategories)))
    if cat is None:
        raise APIError(404, "category not found")
    return {
        "id": cat.id,
        "name": cat.name,
        "slug": cat.slug,
        "description": cat.description,
        "subcategories": [{"id": s.id, "name": s.name, "slug": s.slug} for s in cat.subcategories],
    }


@router.get("/categories/{slug}/subcategories")
def list_subcategories(slug: str, db: Session = Depends(get_db)):
    cat = db.scalar(select(Category).where(Category.slug == slug, alive(Category)))
    if cat is None:
        raise APIError(404, "category not found")
    rows = db.scalars(select(Subcategory).where(Subcategory.category_id == cat.id, alive(Subcategory))).all()
    return [{"id": s.id, "name": s.name, "slug": s.slug, "categoryId": s.category_id} for s in rows]


@router.get("/categories/{slug}/products")
def products_by_category(slug: str, request: Request, db: Session = Depends(get_db)):
    return _products_in(request, db, category_slug=slug)


@router.get("/categories/{slug}/subcategories/{sub_slug}/products")
def products_by_subcategory(slug: str, sub_slug: str, request: Request, db: Session = Depends(get_db)):
    return _products_in(request, db, category_slug=slug, sub_slug=sub_slug)


def _products_in(request, db, category_slug: str, sub_slug: str | None = None):
    cat = db.scalar(select(Category).where(Category.slug == category_slug, alive(Category)))
    if cat is None:
        raise APIError(404, "category not found")
    page, size, offset = parse_page(request)
    cond = [alive(Product), Product.category_id == cat.id]
    if sub_slug:
        sub = db.scalar(select(Subcategory).where(Subcategory.category_id == cat.id, Subcategory.slug == sub_slug))
        if sub is None:
            raise APIError(404, "subcategory not found")
        cond.append(Product.subcategory_id == sub.id)
    total = db.scalar(select(func.count()).select_from(Product).where(*cond)) or 0
    rows = db.scalars(select(Product).where(*cond).options(*_CARD).order_by(Product.created_at.desc()).offset(offset).limit(size)).all()
    return {"data": [product_card(p, _base(request)) for p in rows], "pagination": page_meta(page, size, total)}


@router.get("/brands")
def list_brands(request: Request, db: Session = Depends(get_db)):
    def load() -> bytes:
        rows = db.scalars(select(Brand).where(alive(Brand)).order_by(Brand.name)).all()
        return json.dumps([{"id": b.id, "name": b.name, "slug": b.slug} for b in rows]).encode()

    return public_json(request, request.app.state.cache.get_or_load("brands:all", 900, load))


@router.get("/tags")
def list_tags(request: Request, db: Session = Depends(get_db)):
    def load() -> bytes:
        rows = db.scalars(select(Product.tags).where(alive(Product))).all()
        tags = sorted({tag for group in rows for tag in (group or [])})
        return json.dumps(tags).encode()

    return public_json(request, request.app.state.cache.get_or_load("tags:all", 600, load))


@router.get("/catalog")
def catalog_nav(request: Request, db: Session = Depends(get_db)):
    """One payload for the storefront nav: categories, brands, featured slugs."""

    def load() -> bytes:
        cats = db.scalars(select(Category).where(alive(Category)).options(selectinload(Category.subcategories))).all()
        brands = db.scalars(select(Brand).where(alive(Brand))).all()
        featured_rows = db.scalars(select(Product.slug).where(alive(Product), Product.featured.is_(True)).limit(8)).all()
        body = {
            "categories": [
                {
                    "name": c.name,
                    "slug": c.slug,
                    "subcategories": [{"name": s.name, "slug": s.slug} for s in c.subcategories if s.deleted_at is None],
                }
                for c in cats
            ],
            "brands": [{"name": b.name, "slug": b.slug} for b in brands],
            "featured": list(featured_rows),
        }
        return json.dumps(body).encode()

    return public_json(request, request.app.state.cache.get_or_load("catalog:nav", 600, load))
