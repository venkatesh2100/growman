"""The catalog. Prices and stock come from Postgres. Redis only remembers the page."""

import json

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.http import APIError, page_of
from app.models import Brand, Category, Product, Review, Subcategory, alive, utcnow
from app.security import admin, member
from app.serialize import brand as brand_out
from app.serialize import category as category_out
from app.serialize import product as product_out
from app.serialize import review as review_out

router = APIRouter(tags=["catalog"])
LOAD = (
    selectinload(Product.sizes),
    selectinload(Product.category),
    selectinload(Product.subcategory),
    selectinload(Product.brand),
    selectinload(Product.attributes),
)


def _base(request: Request) -> str:
    return request.app.state.settings.image_base_url


def _cached(request: Request, key: str, build):
    redis = request.app.state.redis
    if redis is not None:
        try:
            raw = redis.get(key)
            if raw:
                return json.loads(raw)
        except Exception:
            pass
    value = build()
    if redis is not None:
        try:
            redis.setex(key, 120, json.dumps(value))
        except Exception:
            pass
    return value


def _query(db: Session):
    return select(Product).where(alive(Product), Product.status == "active").options(*LOAD).order_by(Product.id.desc())


def _page(request: Request, db: Session, stmt, page: int, page_size: int, key: str):
    page_size = min(max(page_size, 1), 100)

    def build():
        total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
        rows = db.scalars(stmt.offset((max(page, 1) - 1) * page_size).limit(page_size)).all()
        return {"data": [product_out(row, _base(request)) for row in rows], "pagination": page_of(page, page_size, total)}

    return _cached(request, key, build)


@router.get("/products")
def list_products(request: Request, db: Session = Depends(get_db), page: int = 1, pageSize: int = 24,
                  category: str = "", tag: str = "", q: str = "", featured: bool = False,
                  minPrice: float | None = None, maxPrice: float | None = None):
    stmt = _query(db)
    if category:
        stmt = stmt.join(Category, Product.category_id == Category.id).where(Category.slug == category)
    if tag:
        stmt = stmt.where(Product.tags.contains([tag]))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Product.name.ilike(like), Product.short_desc.ilike(like)))
    if featured:
        stmt = stmt.where(Product.featured.is_(True))
    if minPrice is not None:
        stmt = stmt.where(Product.price >= minPrice)
    if maxPrice is not None:
        stmt = stmt.where(Product.price <= maxPrice)
    return _page(request, db, stmt, page, pageSize, f"products:{page}:{pageSize}:{category}:{tag}:{q}:{featured}:{minPrice}:{maxPrice}")


@router.get("/products/search")
def search(request: Request, db: Session = Depends(get_db), q: str = "", page: int = 1, pageSize: int = 20):
    pageSize = min(pageSize, 40)
    if not q.strip():
        return {"data": [], "pagination": page_of(1, pageSize, 0)}
    return list_products(request, db, page=page, pageSize=pageSize, q=q)


@router.get("/products/featured")
def featured(request: Request, db: Session = Depends(get_db), page: int = 1, pageSize: int = 12):
    return list_products(request, db, page=page, pageSize=pageSize, featured=True)


@router.get("/products/filters")
def filters(request: Request, db: Session = Depends(get_db), category: str = "", tag: str = "",
            minPrice: float | None = None, maxPrice: float | None = None, page: int = 1, pageSize: int = 24):
    return list_products(request, db, page=page, pageSize=pageSize, category=category, tag=tag, minPrice=minPrice, maxPrice=maxPrice)


def _by_slug(db: Session, slug: str, active: bool = True) -> Product:
    stmt = select(Product).where(Product.slug == slug, alive(Product)).options(*LOAD, selectinload(Product.reviews).selectinload(Review.user))
    if active:
        stmt = stmt.where(Product.status == "active")
    row = db.scalar(stmt)
    if row is None:
        raise APIError(404, "not_found")
    return row


@router.get("/products/{slug}")
def get_product(slug: str, request: Request, db: Session = Depends(get_db)):
    return product_out(_by_slug(db, slug), _base(request), reviews=True)


@router.get("/products/{slug}/related")
def related(slug: str, request: Request, db: Session = Depends(get_db)):
    row = _by_slug(db, slug)
    stmt = _query(db).where(Product.category_id == row.category_id, Product.id != row.id).limit(8)
    return [product_out(item, _base(request)) for item in db.scalars(stmt)]


@router.get("/products/{slug}/companions")
def companions(slug: str, request: Request, db: Session = Depends(get_db)):
    row = _by_slug(db, slug)
    stmt = _query(db).where(Product.id != row.id, Product.featured.is_(True)).limit(4)
    return [product_out(item, _base(request)) for item in db.scalars(stmt)]


@router.get("/products/{slug}/reviews")
def list_reviews(slug: str, db: Session = Depends(get_db)):
    row = _by_slug(db, slug)
    rows = [item for item in row.reviews if item.deleted_at is None and item.status == "approved"]
    return [review_out(item) for item in rows]


@router.post("/products/{slug}/reviews")
def create_review(slug: str, body: dict, db: Session = Depends(get_db), user=Depends(member)):
    from app.models import Order, OrderItem
    row = _by_slug(db, slug)
    rating = int(body.get("rating") or 0)
    if not 1 <= rating <= 5:
        raise APIError(400, "invalid_rating")
    verified = db.scalar(
        select(OrderItem.id).join(Order, OrderItem.order_id == Order.id).where(
            Order.user_id == user.id, Order.payment_status == "paid", OrderItem.product_id == row.id
        )
    ) is not None
    db.add(Review(rating=rating, title=str(body.get("title") or "")[:160], comment=str(body.get("comment") or ""),
                  product_id=row.id, user_id=user.id, status="pending", verified_purchase=verified))
    try:
        db.flush()
    except Exception as exc:
        raise APIError(409, "already_reviewed") from exc
    return {"ok": True}


@router.post("/products/{slug}/back-in-stock")
def back_in_stock(slug: str, body: dict, db: Session = Depends(get_db)):
    from app.models import BackInStockRequest
    row = _by_slug(db, slug)
    email = str(body.get("email") or "").strip().lower()
    if "@" not in email:
        raise APIError(400, "invalid_email")
    db.add(BackInStockRequest(product_id=row.id, email=email, product_size_id=body.get("productSizeId")))
    return {"ok": True}


def _slug(name: str, db: Session) -> str:
    import re
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "plant"
    slug, n = base, 2
    while db.scalar(select(Product.id).where(Product.slug == slug)):
        slug = f"{base}-{n}"
        n += 1
    return slug


@router.post("/products")
def create_product(body: dict, request: Request, db: Session = Depends(get_db), _admin=Depends(admin)):
    name = str(body.get("name") or "").strip()
    if not name:
        raise APIError(400, "name_required")
    row = Product(
        name=name, slug=_slug(name, db), description=str(body.get("description") or ""),
        short_desc=str(body.get("shortDescription") or ""), full_desc=str(body.get("fullDescription") or ""),
        price=float(body.get("price") or 0), mrp=float(body.get("mrp") or 0),
        image_key=str(body.get("imageKey") or ""), status=str(body.get("status") or "active"),
        featured=bool(body.get("featured")), tags=list(body.get("tags") or []),
        stock=int(body.get("stock") or 0), track_inventory=bool(body.get("trackInventory", True)),
        size_class=str(body.get("sizeClass") or "small"), bulky=bool(body.get("bulky")),
        category_id=body.get("categoryId"), subcategory_id=body.get("subcategoryId"), brand_id=body.get("brandId"),
        hsn_code=str(body.get("hsnCode") or ""), gst_rate=float(body.get("gstRate") or 0),
    )
    db.add(row)
    db.flush()
    for size in body.get("sizes") or []:
        from app.models import ProductSize
        db.add(ProductSize(product_id=row.id, label=str(size.get("label") or "Standard"), price=float(size.get("price") or row.price),
                           stock=int(size.get("stock") or 0), size_class=size.get("sizeClass"), bulky=size.get("bulky"),
                           image_keys=list(size.get("imageKeys") or [])))
    db.flush()
    return product_out(_by_slug(db, row.slug, active=False), _base(request))


@router.put("/products/{slug}")
def update_product(slug: str, body: dict, request: Request, db: Session = Depends(get_db), _admin=Depends(admin)):
    row = _by_slug(db, slug, active=False)
    mapping = {
        "name": "name", "description": "description", "shortDescription": "short_desc", "fullDescription": "full_desc",
        "price": "price", "mrp": "mrp", "imageKey": "image_key", "status": "status", "featured": "featured",
        "stock": "stock", "trackInventory": "track_inventory", "sizeClass": "size_class", "bulky": "bulky",
        "categoryId": "category_id", "brandId": "brand_id", "gstRate": "gst_rate", "hsnCode": "hsn_code",
    }
    for src, dest in mapping.items():
        if src in body:
            setattr(row, dest, body[src])
    if "tags" in body:
        row.tags = list(body["tags"] or [])
    return product_out(row, _base(request))


@router.delete("/products/{slug}")
def delete_product(slug: str, db: Session = Depends(get_db), _admin=Depends(admin)):
    row = _by_slug(db, slug, active=False)
    row.deleted_at = utcnow()
    row.status = "archived"
    return {"ok": True}


@router.get("/categories")
def categories(db: Session = Depends(get_db)):
    rows = db.scalars(select(Category).where(alive(Category)).options(selectinload(Category.subcategories)).order_by(Category.name)).all()
    out = []
    for row in rows:
        item = category_out(row)
        item["subcategories"] = [category_out(sub) | {"categoryId": sub.category_id} for sub in row.subcategories if sub.deleted_at is None]
        out.append(item)
    return out


@router.get("/categories/{slug}")
def category(slug: str, db: Session = Depends(get_db)):
    row = db.scalar(select(Category).where(Category.slug == slug, alive(Category)).options(selectinload(Category.subcategories)))
    if row is None:
        raise APIError(404, "not_found")
    item = category_out(row)
    item["subcategories"] = [category_out(sub) | {"categoryId": sub.category_id} for sub in row.subcategories if sub.deleted_at is None]
    return item


@router.get("/categories/{slug}/products")
def category_products(slug: str, request: Request, db: Session = Depends(get_db), page: int = 1, pageSize: int = 24):
    return list_products(request, db, page=page, pageSize=pageSize, category=slug)


@router.get("/categories/{slug}/subcategories")
def subcategories(slug: str, db: Session = Depends(get_db)):
    row = db.scalar(select(Category).where(Category.slug == slug, alive(Category)))
    if row is None:
        raise APIError(404, "not_found")
    rows = db.scalars(select(Subcategory).where(Subcategory.category_id == row.id, alive(Subcategory))).all()
    return [category_out(sub) | {"categoryId": sub.category_id} for sub in rows]


@router.get("/categories/{slug}/subcategories/{sub_slug}/products")
def subcategory_products(slug: str, sub_slug: str, request: Request, db: Session = Depends(get_db), page: int = 1, pageSize: int = 24):
    sub = db.scalar(select(Subcategory).join(Category, Subcategory.category_id == Category.id).where(
        Category.slug == slug, Subcategory.slug == sub_slug, alive(Subcategory)))
    if sub is None:
        raise APIError(404, "not_found")
    stmt = _query(db).where(Product.subcategory_id == sub.id)
    return _page(request, db, stmt, page, pageSize, f"products:sub:{sub.id}:{page}:{pageSize}")


@router.get("/brands")
def brands(db: Session = Depends(get_db)):
    return [brand_out(row) for row in db.scalars(select(Brand).where(alive(Brand)).order_by(Brand.name))]


@router.get("/tags")
def tags(db: Session = Depends(get_db)):
    found = set()
    for row in db.scalars(select(Product.tags).where(alive(Product), Product.status == "active")):
        found.update(row or [])
    return sorted(found)


@router.get("/catalog")
def catalog(request: Request, db: Session = Depends(get_db)):
    def build():
        return {"tags": tags(db), "categories": categories(db)}
    return _cached(request, "catalog:nav", build)
