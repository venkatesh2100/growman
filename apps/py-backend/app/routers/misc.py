"""Public writes that are not checkout: quotes, the waitlist, consent, demand.

Consent is public because it can be recorded before sign-in. Optional auth
attaches the user id when the caller is signed in; without that, a logged-in
customer's consent would be stored against the email only.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import optional_claims
from app.care import advice
from app.documents import quotation_email_text
from app.errors import APIError
from app.models import ConsentRecord, DoothaWaitlist, QuoteRequest, RequestedProduct
from app.notify import alert_ops, send_email_now, smtp_ready
from app.phone import ten_digit
from app.privacy import NOTICE_VERSION
from app.quotation import IST, next_estimate_no, price
from app.ratelimit import client_ip, limit
from app.routers.deps import get_db
from app.visitor import lookup as lookup_place

router = APIRouter()


class QuoteItem(BaseModel):
    productId: int = 0
    sizeId: int = 0
    quantity: int = 0


class QuoteCustom(BaseModel):
    name: str = ""
    size: str = ""
    quantity: int = 0


class QuoteServices(BaseModel):
    delivery: bool = False
    loading: bool = False
    plantation: bool = False


class QuoteIn(BaseModel):
    name: str = ""
    company: str = ""
    phone: str = ""
    email: str = ""
    gstin: str = ""
    address: str = ""
    city: str = ""
    state: str = ""
    pincode: str = ""
    requiredBy: str = ""
    notes: str = ""
    website: str = ""
    services: QuoteServices = QuoteServices()
    items: list[QuoteItem] = []
    customItems: list[QuoteCustom] = []


@router.post("/quotations", dependencies=[Depends(limit("quotation", 5, 600, fail_closed=False))])
def create_quotation(body: QuoteIn, request: Request, db: Session = Depends(get_db), claims=Depends(optional_claims)):
    settings = request.app.state.settings
    now = datetime.now(IST)
    quote = price(db, body, now, next_estimate_no(request.app.state.redis, now))
    # The email to the nursery is the quotation. Without a mailbox there is
    # nothing to send, so the buyer is told to call instead of getting a
    # document the store never saw.
    inbox = (settings.quotation_email or settings.merchant_notify_email or "").strip()
    if not inbox or not smtp_ready(settings):
        raise APIError(503, "Quotation email is unavailable right now. Please call the store.")
    try:
        send_email_now(settings, inbox, f"Quotation {quote['estimateNo']} from {quote['requester']['name']}", quotation_email_text(quote))
    except Exception as exc:  # noqa: BLE001
        raise APIError(502, "We couldn't send your quotation. Please try again or call the store.") from exc
    summary = quote["lines"][0]["name"]
    if len(quote["lines"]) > 1:
        summary = f"{summary} and {len(quote['lines']) - 1} more"
    db.add(
        QuoteRequest(
            user_id=claims.user_id if claims else None,
            estimate_no=quote["estimateNo"],
            name=quote["requester"]["name"],
            phone=quote["requester"]["phone"],
            email=quote["requester"]["email"],
            summary=summary[:300],
            amount=quote["total"],
            status="sent",
        )
    )
    return JSONResponse(quote, status_code=201)


class WaitlistIn(BaseModel):
    name: str
    phone: str
    email: str = ""
    address: str = ""
    source: str = "homepage_popup"


@router.post("/dootha-waitlist", dependencies=[Depends(limit("waitlist", 5, 600, fail_closed=False))])
def join_waitlist(body: WaitlistIn, request: Request, db: Session = Depends(get_db), claims=Depends(optional_claims)):
    phone = ten_digit(body.phone)
    if not phone:
        raise APIError(400, "invalid phone number format")
    # One row per phone. A repeat sign-up updates the row and counts itself.
    row = db.scalar(select(DoothaWaitlist).where(DoothaWaitlist.phone == phone))
    if row is None:
        row = DoothaWaitlist(phone=phone, name=body.name[:200])
        db.add(row)
    row.name = body.name[:200] or row.name
    row.email = body.email or row.email
    row.address = body.address or row.address
    row.source = body.source or row.source
    row.user_id = claims.user_id if claims else row.user_id
    row.ip = client_ip(request)[:64]
    row.user_agent = (request.headers.get("user-agent") or "")[:512]
    row.signups = (row.signups or 0) + (0 if row.id is None else 1)
    if row.id is None:
        row.signups = 1
    db.flush()
    alert_ops(request.app.state.settings, f"Dootha waitlist: {row.name} {row.phone}")
    return {"ok": True, "id": row.id}


class RequestedIn(BaseModel):
    productName: str
    details: str = ""
    email: str = ""
    phone: str = ""
    name: str = ""
    source: str = "manual"


@router.post("/requested-products")
def request_product(body: RequestedIn, db: Session = Depends(get_db), claims=Depends(optional_claims)):
    if not body.productName.strip():
        raise APIError(400, "productName is required")
    row = RequestedProduct(
        product_name=body.productName[:200],
        details=body.details[:4000],
        source=body.source[:32] or "manual",
        requested_by_id=claims.user_id if claims else None,
        requester_name=body.name,
        requester_email=body.email,
        requester_phone=body.phone,
    )
    db.add(row)
    db.flush()
    return {"id": row.id, "status": row.status}


class BrowseIn(BaseModel):
    seconds: int = 0
    path: str = ""


@router.post("/engagement/long-browse")
def long_browse(body: BrowseIn, request: Request):
    # Ten minutes is the client's claim. A datacenter, VPN, or proxy is
    # not a person lingering on the shop, so it does not page the nursery.
    if body.seconds < 600:
        return {"ok": True, "alerted": False}
    ip = client_ip(request)
    place = lookup_place(ip)
    if place is not None and place.datacenter:
        return {"ok": True, "alerted": False}
    where = place.label() if place else ip
    alert_ops(request.app.state.settings, f"Long browse ({body.seconds}s) on {body.path or '/'} from {where}")
    return {"ok": True, "alerted": True}


class ConsentIn(BaseModel):
    purpose: str = "essential"
    granted: bool = True
    email: str = ""
    noticeVersion: str = NOTICE_VERSION


@router.post("/consent")
def record_consent(body: ConsentIn, request: Request, db: Session = Depends(get_db), claims=Depends(optional_claims)):
    purpose = body.purpose.strip().lower()
    if purpose not in {"essential", "analytics", "marketing", "personalisation"}:
        raise APIError(400, "unknown consent purpose")
    # A withdrawal is a new row. The original grant is never edited, because
    # an audit asks what was agreed and when.
    db.add(
        ConsentRecord(
            user_id=claims.user_id if claims else None,
            email=body.email.strip().lower(),
            purpose=purpose,
            granted=body.granted,
            notice_version=body.noticeVersion or NOTICE_VERSION,
            ip=client_ip(request)[:64],
            user_agent=(request.headers.get("user-agent") or "")[:512],
        )
    )
    return {"ok": True, "noticeVersion": body.noticeVersion or NOTICE_VERSION}


@router.get("/care/season")
def care_season():
    return advice()
