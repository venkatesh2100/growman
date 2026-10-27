"""Turn rows into the camelCase JSON the web and mobile apps already expect.

Python attributes stay snake_case. The wire format stays camelCase so this
service can sit in front of the same clients as the Go service.
"""

from __future__ import annotations

from datetime import datetime

from app.models import (
    Address,
    Category,
    Order,
    OrderItem,
    Product,
    ProductSize,
    Review,
    User,
)


def image_url(base: str, key: str | None) -> str:
    if not base or not key:
        return ""
    return base.rstrip("/") + "/" + key.lstrip("/")


def _dt(value: datetime | None) -> str | None:
    return value.isoformat() + "Z" if value else None


def user_brief(user: User) -> dict:
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email or "",
        "phone": user.phone or "",
    }


def user_profile(user: User) -> dict:
    body = user_brief(user)
    body.update(
        {
            "role": user.role,
            "emailVerified": user.email_verified,
            "provider": user.provider,
            "referralCode": user.referral_code,
            "address": {
                "line": user.address_line,
                "city": user.city,
                "state": user.state,
                "pincode": user.pincode,
                "country": user.country,
                "latitude": user.latitude,
                "longitude": user.longitude,
            },
        }
    )
    return body


def category_brief(cat: Category | None) -> dict | None:
    if cat is None:
        return None
    return {"id": cat.id, "name": cat.name, "slug": cat.slug, "description": getattr(cat, "description", "")}


def size_json(size: ProductSize, base: str) -> dict:
    return {
        "id": size.id,
        "label": size.label,
        "price": size.price,
        "stock": size.stock,
        "productId": size.product_id,
        "sizeClass": size.size_class,
        "bulky": size.bulky,
        "imageKeys": size.image_keys or [],
        "images": [image_url(base, k) for k in (size.image_keys or [])],
    }


def product_card(product: Product, base: str) -> dict:
    return {
        "id": product.id,
        "name": product.name,
        "slug": product.slug,
        "shortDescription": product.short_desc,
        "price": product.price,
        "mrp": product.mrp,
        "currency": product.currency or "INR",
        "imageKey": product.image_key,
        "imageUrl": image_url(base, product.image_key),
        "status": product.status,
        "featured": product.featured,
        "tags": product.tags or [],
        "stock": product.stock,
        "trackInventory": product.track_inventory,
        "ratingAverage": product.rating_average,
        "ratingCount": product.rating_count,
        "sizeClass": product.size_class,
        "categoryId": product.category_id,
        "subcategoryId": product.subcategory_id,
        "brandId": product.brand_id,
        "category": category_brief(product.category) if product.category else None,
        "brand": {"id": product.brand.id, "name": product.brand.name, "slug": product.brand.slug}
        if product.brand
        else None,
        "sizes": [size_json(s, base) for s in (product.sizes or [])],
        "createdAt": _dt(product.created_at),
    }


def product_detail(product: Product, base: str) -> dict:
    body = product_card(product, base)
    body.update(
        {
            "description": product.description,
            "fullDescription": product.full_desc,
            "specifications": product.specifications,
            "taxInfo": product.tax_info,
            "hsnCode": product.hsn_code,
            "gstRate": product.gst_rate,
            "bulky": product.bulky,
            "lowStockThreshold": product.low_stock_threshold,
            "subcategory": category_brief(product.subcategory) if product.subcategory else None,
            "attributes": [{"id": a.id, "name": a.name, "value": a.value} for a in (product.attributes or [])],
            "reviews": [review_json(r, base) for r in (product.reviews or [])],
        }
    )
    return body


def review_json(review: Review, base: str) -> dict:
    name = ""
    if review.user is not None:
        name = review.user.name
    return {
        "id": review.id,
        "rating": review.rating,
        "title": review.title,
        "comment": review.comment,
        "productId": review.product_id,
        "userId": review.user_id,
        "status": review.status,
        "verifiedPurchase": review.verified_purchase,
        "imageKeys": review.image_keys or [],
        "images": [image_url(base, k) for k in (review.image_keys or [])],
        "user": {"id": review.user_id, "name": name},
        "createdAt": _dt(review.created_at),
    }


def order_item_json(item: OrderItem, base: str) -> dict:
    return {
        "id": item.id,
        "orderId": item.order_id,
        "productId": item.product_id,
        "productSizeId": item.product_size_id,
        "quantity": item.quantity,
        "price": item.price,
        "name": item.name,
        "imageKey": item.image_key,
        "imageUrl": image_url(base, item.image_key),
    }


def order_json(order: Order, base: str, *, include_contact: bool = True) -> dict:
    body = {
        "id": order.id,
        "userId": order.user_id,
        "razorpayOrderId": order.razorpay_order_id,
        "razorpayPaymentId": order.razorpay_payment_id,
        "paymentStatus": order.payment_status,
        "status": order.status,
        "amount": order.amount,
        "currency": order.currency,
        "publicToken": order.public_token,
        "subtotal": order.subtotal,
        "deliveryFee": order.delivery_fee,
        "deliveryFeeWaived": order.delivery_fee_waived,
        "discountTotal": order.discount_total,
        "couponCode": order.coupon_code,
        "fulfillmentChannel": order.fulfillment_channel,
        "fulfillmentZone": order.fulfillment_zone,
        "distanceKm": order.distance_km,
        "awbNumber": order.awb_number,
        "trackingUrl": order.tracking_url,
        "invoiceNumber": order.invoice_number,
        "taxableValue": order.taxable_value,
        "taxAmount": order.tax_amount,
        "giftWrap": order.gift_wrap,
        "giftFee": order.gift_fee,
        "creditApplied": order.credit_applied,
        "createdAt": _dt(order.created_at),
        "items": [order_item_json(i, base) for i in (order.items or [])],
        "cancellable": order.is_cancellable(),
    }
    if include_contact:
        body.update(
            {
                "customerName": order.customer_name,
                "customerEmail": order.customer_email,
                "customerPhone": order.customer_phone,
                "addressLine": order.address_line,
                "city": order.city,
                "state": order.state,
                "pincode": order.pincode,
            }
        )
    return body


def address_json(row: Address) -> dict:
    return {
        "id": row.id,
        "label": row.label,
        "name": row.name,
        "phone": row.phone,
        "addressLine": row.address_line,
        "city": row.city,
        "state": row.state,
        "pincode": row.pincode,
        "latitude": row.latitude,
        "longitude": row.longitude,
        "isDefault": row.is_default,
    }
