"""Small HTTP helpers: pagination, and public JSON with an ETag.

An ETag lets a client that already has the catalog response skip the body.
The handler still does the cache lookup; the 304 only skips the bytes on
the wire. Private responses (orders, profile) must not be cached this way.
"""

from __future__ import annotations

import hashlib
import json

from fastapi import Request, Response


def parse_page(request: Request) -> tuple[int, int, int]:
    def _int(name: str, default: int) -> int:
        try:
            return int(request.query_params.get(name) or default)
        except ValueError:
            return default

    page = max(_int("page", 1), 1)
    size = min(max(_int("pageSize", 20), 1), 100)
    return page, size, (page - 1) * size


def page_meta(page: int, size: int, total: int) -> dict:
    pages = max((total + size - 1) // size, 1) if size else 1
    return {
        "page": page,
        "pageSize": size,
        "total": total,
        "totalPages": pages,
        "hasNext": page < pages,
        "hasPrev": page > 1,
    }


def public_json(request: Request, payload, max_age: int = 60) -> Response:
    raw = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
    etag = '"' + hashlib.sha1(raw).hexdigest() + '"'
    headers = {"ETag": etag, "Cache-Control": f"public, max-age={max_age}"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(content=raw, media_type="application/json", headers=headers)
