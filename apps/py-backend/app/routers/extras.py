"""Features that are allowed to fail on their own: chat, plant identify, quotes, the map."""

import httpx
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import mail, shop
from app.db import get_db
from app.http import APIError, client_ip, limit
from app.models import ChatTurn, ConsentRecord, DoothaWaitlist, OrderSupportRequest, Product, QuoteRequest, RequestedProduct, alive
from app.security import admin, member, optional_user

router = APIRouter(tags=["extras"])
TIPS = {
    1: "Water less. Most indoor plants are resting.",
    4: "Repot before the heat. Morning sun, afternoon shade.",
    6: "Monsoon is here. Check saucers so roots are not sitting in water.",
    10: "The light is softer. Move sun-lovers closer to the window.",
}


def _tip() -> str:
    return TIPS.get(datetime.now().month) or "Water when the top of the soil is dry, not on a schedule alone."


@router.get("/care/season")
def season():
    return {"month": datetime.now().month, "tip": _tip()}


@router.post("/chat", dependencies=[Depends(limit("chat", 30, 60, True))])
def chat(body: dict, request: Request, db: Session = Depends(get_db), user=Depends(optional_user)):
    message = str(body.get("message") or "").strip()
    if not message:
        raise APIError(400, "message_required")
    settings = request.app.state.settings
    if user is not None:
        db.add(ChatTurn(user_id=user.id, role="user", content=message[:4000]))
    lower = message.lower()
    if user is not None and any(word in lower for word in ("order", "track", "where is")):
        from app.models import Order
        rows = db.scalars(select(Order).where(alive(Order), Order.user_id == user.id).order_by(Order.id.desc()).limit(3)).all()
        cards = [{
            "id": row.id, "createdAt": row.created_at.isoformat(), "status": row.status,
            "itemCount": len(row.items), "itemPreview": ", ".join(item.name for item in list(row.items)[:2]),
        } for row in rows]
        reply = "Here are your latest orders." if cards else "You have no orders yet."
        if user is not None:
            db.add(ChatTurn(user_id=user.id, role="assistant", content=reply))
        return {"reply": reply, "orders": cards, "cards": []}
    if settings.rag_service_url:
        try:
            response = httpx.post(
                settings.rag_service_url.rstrip("/") + "/v1/care",
                json={"question": message},
                headers={"Authorization": f"Bearer {settings.rag_shared_secret}"} if settings.rag_shared_secret else {},
                timeout=20,
            )
            if response.status_code == 200:
                data = response.json()
                reply = data.get("reply") or data.get("answer") or _tip()
                if user is not None:
                    db.add(ChatTurn(user_id=user.id, role="assistant", content=str(reply)[:4000]))
                return data
        except httpx.HTTPError:
            pass
    reply = _tip()
    if user is not None:
        db.add(ChatTurn(user_id=user.id, role="assistant", content=reply))
    return {"reply": reply, "cards": []}


def _quota(request: Request) -> int:
    redis = request.app.state.redis
    key = "plantnet:remaining:" + datetime.now(timezone.utc).date().isoformat()
    if redis is not None:
        try:
            raw = redis.get(key)
            if raw is None:
                redis.setex(key, 86400, 500)
                return 500
            return int(raw)
        except Exception:
            pass
    box = request.app.state.box
    current = box.get(None, key)
    if not current:
        box.put(None, key, "500", 86400)
        return 500
    return int(current)


def _spend(request: Request) -> None:
    redis = request.app.state.redis
    key = "plantnet:remaining:" + datetime.now(timezone.utc).date().isoformat()
    if redis is not None:
        try:
            redis.decr(key)
            return
        except Exception:
            pass
    left = max(_quota(request) - 1, 0)
    request.app.state.box.put(None, key, str(left), 86400)


@router.get("/plants/quota")
@router.get("/plants/status")
def plant_status(request: Request):
    if not request.app.state.settings.plantnet_api_key:
        raise APIError(503, "plantnet_unavailable")
    return {"remaining": _quota(request), "reserve": request.app.state.settings.plantnet_reserve}


@router.get("/plants/languages")
@router.get("/plants/projects")
@router.get("/plants/species")
@router.get("/plants/diseases")
@router.get("/plants/varieties")
def plant_catalog(request: Request):
    """Catalog lookups do not spend an identify credit."""
    settings = request.app.state.settings
    if not settings.plantnet_api_key:
        raise APIError(503, "plantnet_unavailable")
    kind = request.url.path.rsplit("/", 1)[-1]
    response = httpx.get(
        f"https://my-api.plantnet.org/v2/{kind}",
        params={"api-key": settings.plantnet_api_key, "project": settings.plantnet_project},
        timeout=20,
    )
    if response.status_code >= 300:
        raise APIError(502, "plantnet_failed")
    return response.json()


@router.post("/images/identify-plant", dependencies=[Depends(limit("plant", 20, 60, True))])
async def identify(request: Request):
    settings = request.app.state.settings
    if not settings.plantnet_api_key:
        raise APIError(503, "plantnet_unavailable")
    form = await request.form()
    focus = str(form.get("focus") or "care")
    remaining = _quota(request)
    if focus in {"disease", "variety", "health"} and remaining <= settings.plantnet_reserve:
        raise APIError(429, "plant_quota")
    uploads = form.getlist("images") or form.getlist("image")
    if not uploads:
        raise APIError(400, "image_required")
    files = [("images", (item.filename or "plant.jpg", await item.read(), item.content_type or "image/jpeg")) for item in uploads]
    organ = "leaf" if focus in {"disease", "health"} else "auto"
    response = httpx.post(
        "https://my-api.plantnet.org/v2/identify/all",
        params={"api-key": settings.plantnet_api_key, "organs": organ},
        files=files,
        timeout=40,
    )
    _spend(request)
    if response.status_code >= 300:
        raise APIError(502, "plantnet_failed")
    data = response.json()
    data["care"] = _tip()
    data["quota"] = {"remaining": remaining - 1}
    return data


@router.post("/quotations", dependencies=[Depends(limit("quotation", 5, 600))])
def quotation(body: dict, request: Request, db: Session = Depends(get_db), user=Depends(optional_user)):
    settings = request.app.state.settings
    if str(body.get("website") or "").strip():
        return JSONResponse({"estimateNo": "GMQ-0000-0000", "lines": []}, status_code=201)
    if not settings.smtp_email or not settings.quote_inbox:
        raise APIError(503, "quotation_unavailable")
    lines = []
    goods = 0.0
    for index, item in enumerate(body.get("items") or [], start=1):
        product = db.get(Product, int(item.get("productId") or 0))
        if product is None or product.deleted_at:
            continue
        size_id = int(item.get("sizeId") or 0)
        price = product.price
        label = ""
        for size in product.sizes:
            if size.id == size_id and size.deleted_at is None:
                price = size.price
                label = size.label
        qty = int(item.get("quantity") or 1)
        amount = shop.money(price * qty)
        goods += amount
        lines.append({
            "no": index, "itemCode": f"GM{product.id:04d}{size_id:04d}", "name": product.name,
            "size": label, "quantity": qty, "unit": "nos", "rate": price, "amount": amount, "requested": False,
        })
    for index, item in enumerate(body.get("customItems") or [], start=len(lines) + 1):
        lines.append({
            "no": index, "itemCode": "CUSTOM", "name": str(item.get("name") or "Custom"),
            "size": str(item.get("size") or ""), "quantity": int(item.get("quantity") or 1),
            "unit": "nos", "rate": 0, "amount": 0, "requested": True,
        })
    requester = {key: str(body.get(key) or "") for key in
                 ("name", "company", "phone", "email", "gstin", "address", "city", "state", "pincode", "requiredBy", "notes")}
    services = body.get("services") or {}
    stamp = datetime.now().strftime("%y%m")
    seq = (db.scalar(select(func.count()).select_from(QuoteRequest).where(QuoteRequest.estimate_no.like(f"GMQ-{stamp}-%"))) or 0) + 1
    doc = {
        "estimateNo": f"GMQ-{stamp}-{seq:04d}",
        "date": datetime.now().date().isoformat(),
        "placeOfSupply": "Telangana",
        "requester": requester,
        "lines": lines,
        "totalUnits": sum(line["quantity"] for line in lines),
        "goodsTotal": shop.money(goods),
        "charges": [
            {"label": "Delivery", "requested": bool(services.get("delivery")), "amount": None},
            {"label": "Loading & Unloading", "requested": bool(services.get("loading")), "amount": None},
            {"label": "Plantation Labour Charges", "requested": bool(services.get("plantation")), "amount": None},
        ],
        "total": shop.money(goods),
        "amountInWords": shop.rupees(goods),
        "description": ["Prices are for the plants. Delivery and labour are confirmed by the nursery."],
        "terms": ["This is an estimate, not a tax invoice.", "Plants are living goods and vary a little from the photo."],
        "issuer": "Sri Shirdi Sai Nursery",
        "issuerAddress": "Hyderabad",
        "issuerPhone": "",
    }
    db.add(QuoteRequest(user_id=user.id if user else None, estimate_no=doc["estimateNo"], name=requester["name"][:100],
                        phone=requester["phone"][:20], email=requester["email"][:160], summary=lines[0]["name"] if lines else "Quote",
                        amount=doc["total"]))
    mail.send(settings, settings.quote_inbox, f"Quote {doc['estimateNo']}", shop.rupees(goods) + "\n" + requester["phone"])
    return JSONResponse(doc, status_code=201)


@router.post("/dootha-waitlist", dependencies=[Depends(limit("waitlist", 5, 600))])
def waitlist(body: dict, request: Request, db: Session = Depends(get_db)):
    phone = str(body.get("phone") or "")
    if len(phone) < 10:
        raise APIError(400, "invalid_phone")
    db.add(DoothaWaitlist(name=str(body.get("name") or ""), phone=phone, email=str(body.get("email") or ""),
                         address=str(body.get("address") or ""), ip=client_ip(request), user_agent=request.headers.get("user-agent", "")[:512]))
    return {"ok": True}


@router.get("/dootha-waitlist")
def list_waitlist(db: Session = Depends(get_db), user=Depends(member)):
    if user.role not in {"admin", "superadmin"}:
        raise APIError(403, "admin_required")
    rows = db.scalars(select(DoothaWaitlist).order_by(DoothaWaitlist.id.desc()).limit(200)).all()
    return [{"id": row.id, "name": row.name, "phone": row.phone, "status": row.status} for row in rows]


@router.post("/requested-products")
def request_product(body: dict, request: Request, db: Session = Depends(get_db), user=Depends(optional_user)):
    name = str(body.get("productName") or body.get("name") or "").strip()
    if not name:
        raise APIError(400, "name_required")
    row = RequestedProduct(product_name=name[:200], details=str(body.get("details") or ""),
                           requested_by_id=user.id if user else None,
                           requester_name=str(body.get("name") or (user.name if user else "")),
                           requester_email=str(body.get("email") or (user.email if user else "") or ""),
                           requester_phone=str(body.get("phone") or ""))
    db.add(row)
    db.flush()
    return {"id": row.id}


@router.get("/requested-products")
def list_requests(db: Session = Depends(get_db), user=Depends(member)):
    stmt = select(RequestedProduct).order_by(RequestedProduct.id.desc()).limit(200)
    if user.role not in {"admin", "superadmin"}:
        stmt = stmt.where(RequestedProduct.requested_by_id == user.id)
    rows = db.scalars(stmt).all()
    return [{"id": row.id, "productName": row.product_name, "status": row.status} for row in rows]


@router.post("/engagement/long-browse")
def long_browse(body: dict, request: Request):
    mail.discord(request.app.state.settings.discord_webhook_url, f"Long browse from {client_ip(request)} on {body.get('path', '/')}")
    return {"ok": True}


@router.post("/consent")
def consent(body: dict, request: Request, db: Session = Depends(get_db), user=Depends(optional_user)):
    db.add(ConsentRecord(user_id=user.id if user else None, email=str(body.get("email") or (user.email if user else "") or ""),
                         purpose=str(body.get("purpose") or "essential"), granted=bool(body.get("granted", True)),
                         notice_version=str(body.get("noticeVersion") or "1"), ip=client_ip(request),
                         user_agent=request.headers.get("user-agent", "")[:512]))
    return {"ok": True}


@router.get("/dashboard/map")
def dashboard_map(request: Request, user=Depends(member), mapType: str = "world"):
    if mapType not in {"world", "country"}:
        raise APIError(400, "mapType must be world or country")
    settings = request.app.state.settings
    if not settings.cloudflare_api_token or not settings.cloudflare_account_id:
        if mapType == "world":
            return {"success": True, "formattedStats": {}}
        raise APIError(502, "map_unavailable")
    response = httpx.post(
        f"https://api.cloudflare.com/client/v4/accounts/{settings.cloudflare_account_id}/analytics_engine/sql",
        headers={"Authorization": f"Bearer {settings.cloudflare_api_token}"},
        content="SELECT 1",
        timeout=15,
    )
    if response.status_code >= 300:
        if mapType == "world":
            return {"success": True, "formattedStats": {}}
        raise APIError(502, "map_unavailable")
    return {"success": True, "formattedStats": response.json()}


@router.get("/order-support-requests")
def list_support(db: Session = Depends(get_db), user=Depends(member)):
    stmt = select(OrderSupportRequest).order_by(OrderSupportRequest.id.desc()).limit(100)
    if user.role not in {"admin", "superadmin"}:
        stmt = stmt.where(OrderSupportRequest.user_id == user.id)
    rows = db.scalars(stmt).all()
    return [{"id": row.id, "issueType": row.issue_type, "status": row.status, "orderId": row.order_id} for row in rows]


@router.patch("/order-support-requests/{row_id}/status")
def support_status(row_id: int, body: dict, db: Session = Depends(get_db), _admin=Depends(admin)):
    row = db.get(OrderSupportRequest, row_id)
    if row is None:
        raise APIError(404, "not_found")
    row.status = str(body.get("status") or row.status)
    row.admin_notes = str(body.get("notes") or "")
    return {"ok": True}
