"""Idempotent sample data for local development.

Running this twice does not duplicate rows: each insert is skipped when
the slug or email is already there. Turn it on with SEED_ON_STARTUP=true.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.accounts import hash_password
from app.models import Brand, Category, Product, ProductSize, Subcategory, User

log = logging.getLogger("growman.seed")


def ensure_sample_data(db: Session) -> None:
    if db.scalar(select(User.id).where(User.email == "admin@growman.local")) is None:
        db.add(
            User(
                name="Growman Admin",
                email="admin@growman.local",
                password_hash=hash_password("admin12345"),
                role="admin",
                email_verified=True,
                provider="local",
            )
        )
    indoor = _category(db, "Indoor Plants", "indoor-plants", "Plants that live well inside an Indian home.")
    outdoor = _category(db, "Outdoor Plants", "outdoor-plants", "Balcony and garden plants for Hyderabad weather.")
    _sub(db, indoor, "Low Light", "low-light")
    brand = _brand(db, "Growman Nursery", "growman-nursery")
    _product(
        db,
        name="Snake Plant",
        slug="snake-plant",
        price=349,
        mrp=499,
        category=indoor,
        brand=brand,
        tags=["indoor", "beginner", "low-light", "pet"],
        featured=True,
        short="A tough indoor plant that tolerates missed waterings.",
        sizes=[("Small pot", 349, 20), ("Medium pot", 549, 8)],
    )
    _product(
        db,
        name="Money Plant",
        slug="money-plant",
        price=199,
        mrp=299,
        category=indoor,
        brand=brand,
        tags=["indoor", "beginner", "gift"],
        featured=True,
        short="A trailing plant for shelves and bright rooms.",
    )
    _product(
        db,
        name="Hibiscus",
        slug="hibiscus",
        price=249,
        mrp=349,
        category=outdoor,
        brand=brand,
        tags=["outdoor", "flowering"],
        featured=False,
        short="A flowering shrub for a sunny balcony.",
        size_class="medium",
    )
    db.commit()
    log.info("sample data ready (admin@growman.local / admin12345)")


def _category(db: Session, name: str, slug: str, description: str) -> Category:
    row = db.scalar(select(Category).where(Category.slug == slug))
    if row:
        return row
    row = Category(name=name, slug=slug, description=description)
    db.add(row)
    db.flush()
    return row


def _sub(db: Session, category: Category, name: str, slug: str) -> None:
    exists = db.scalar(
        select(Subcategory.id).where(Subcategory.category_id == category.id, Subcategory.slug == slug)
    )
    if exists is None:
        db.add(Subcategory(name=name, slug=slug, category_id=category.id))


def _brand(db: Session, name: str, slug: str) -> Brand:
    row = db.scalar(select(Brand).where(Brand.slug == slug))
    if row:
        return row
    row = Brand(name=name, slug=slug)
    db.add(row)
    db.flush()
    return row


def _product(db, *, name, slug, price, mrp, category, brand, tags, featured, short, sizes=None, size_class="small"):
    if db.scalar(select(Product.id).where(Product.slug == slug)):
        return
    product = Product(
        name=name,
        slug=slug,
        price=price,
        mrp=mrp,
        short_desc=short,
        description=short,
        category_id=category.id,
        brand_id=brand.id,
        tags=tags,
        featured=featured,
        stock=25 if not sizes else 0,
        status="active",
        currency="INR",
        size_class=size_class,
        track_inventory=True,
    )
    db.add(product)
    db.flush()
    for label, size_price, stock in sizes or []:
        db.add(ProductSize(product_id=product.id, label=label, price=size_price, stock=stock))
