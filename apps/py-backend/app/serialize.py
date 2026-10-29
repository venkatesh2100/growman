"""Database rows to the camelCase JSON the web and mobile apps already speak."""

from datetime import datetime


def iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def image_url(base: str, key: str) -> str:
    if not key:
        return ""
    if key.startswith("http://") or key.startswith("https://"):
        return key
    if base:
        return base.rstrip("/") + "/" + key.lstrip("/")
    return "/uploads/" + key.lstrip("/")


def _when(row) -> dict:
    return {"id": row.id, "createdAt": iso(row.created_at), "updatedAt": iso(row.updated_at)}


def category(row) -> dict | None:
    if row is None or row.deleted_at is not None:
        return None
    return {**_when(row), "name": row.name, "slug": row.slug, "description": row.description}


def brand(row) -> dict | None:
    if row is None or row.deleted_at is not None:
        return None
    return {**_when(row), "name": row.name, "slug": row.slug}


def size(row, base: str) -> dict:
    images = [image_url(base, key) for key in (row.image_keys or [])]
    return {
        **_when(row),
        "label": row.label,
        "price": row.price,
        "stock": row.stock,
        "productId": row.product_id,
        "sizeClass": row.size_class,
        "bulky": row.bulky,
        "images": images,
    }


def product(row, base: str, *, reviews: bool = False) -> dict:
    return {
        **_when(row),
        "name": row.name,
        "slug": row.slug,
        "description": row.description,
        "shortDescription": row.short_desc,
        "fullDescription": row.full_desc,
        "specifications": row.specifications,
        "taxInfo": row.tax_info,
        "price": row.price,
        "mrp": row.mrp,
        "currency": row.currency or "INR",
        "imageKey": row.image_key,
        "imageUrl": image_url(base, row.image_key),
        "status": row.status,
        "featured": row.featured,
        "tags": list(row.tags or []),
        "stock": row.stock,
        "trackInventory": row.track_inventory,
        "lowStockThreshold": row.low_stock_threshold,
        "ratingAverage": row.rating_average,
        "ratingCount": row.rating_count,
        "hsnCode": row.hsn_code,
        "gstRate": row.gst_rate,
        "sizeClass": row.size_class,
        "bulky": row.bulky,
        "categoryId": row.category_id,
        "subcategoryId": row.subcategory_id,
        "brandId": row.brand_id,
        "category": category(row.category),
        "subcategory": category(row.subcategory) | {"categoryId": row.subcategory.category_id} if row.subcategory and not row.subcategory.deleted_at else None,
        "brand": brand(row.brand),
        "sizes": [size(item, base) for item in row.sizes if item.deleted_at is None],
        "attributes": [
            {"id": item.id, "name": item.name, "value": item.value, "productId": item.product_id}
            for item in row.attributes if item.deleted_at is None
        ],
        "reviews": [review(item) for item in row.reviews if item.deleted_at is None] if reviews else [],
    }


def review(row) -> dict:
    user = None
    if row.user and row.user.deleted_at is None:
        user = {"id": row.user.id, "name": row.user.name, "role": row.user.role}
    return {
        **_when(row),
        "rating": row.rating,
        "title": row.title,
        "comment": row.comment,
        "productId": row.product_id,
        "userId": row.user_id,
        "status": row.status,
        "verifiedPurchase": row.verified_purchase,
        "user": user,
    }


def user_out(row) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "email": row.email or "",
        "phone": row.phone or "",
        "emailVerified": row.email_verified,
        "role": row.role,
        "provider": row.provider,
        "referralCode": row.referral_code,
        "address": {
            "addressLine": row.address_line,
            "city": row.city,
            "state": row.state,
            "pincode": row.pincode,
            "country": row.country,
            "latitude": row.latitude,
            "longitude": row.longitude,
        },
    }


def order_out(row, base: str) -> dict:
    return {
        **_when(row),
        "userId": row.user_id,
        "razorpayOrderId": row.razorpay_order_id,
        "paymentStatus": row.payment_status,
        "status": row.status,
        "amount": row.amount,
        "currency": row.currency,
        "publicToken": row.public_token,
        "customerName": row.customer_name,
        "customerEmail": row.customer_email,
        "customerPhone": row.customer_phone,
        "addressLine": row.address_line,
        "city": row.city,
        "state": row.state,
        "pincode": row.pincode,
        "fulfillmentChannel": row.fulfillment_channel,
        "fulfillmentZone": row.fulfillment_zone,
        "subtotal": row.subtotal,
        "deliveryFee": row.delivery_fee,
        "discount": row.discount_total,
        "couponCode": row.coupon_code,
        "giftWrap": row.gift_wrap,
        "giftFee": row.gift_fee,
        "creditApplied": row.credit_applied,
        "invoiceNumber": row.invoice_number,
        "awbNumber": row.awb_number,
        "trackingUrl": row.tracking_url,
        "cancellable": row.is_cancellable(),
        "items": [
            {
                "id": item.id,
                "productId": item.product_id,
                "productSizeId": item.product_size_id,
                "quantity": item.quantity,
                "price": item.price,
                "name": item.name,
                "imageUrl": image_url(base, item.image_key),
            }
            for item in row.items
            if item.deleted_at is None
        ],
    }
