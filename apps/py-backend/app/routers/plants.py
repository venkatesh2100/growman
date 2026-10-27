"""Plant identification via Pl@ntNet.

The free plan is a shared daily budget. Catalog reads (languages, projects)
do not spend an identification credit. A missing API key returns 503 from
these routes only; the shop keeps working.

``POST /images/identify-plant`` always identifies the species, then spends
disease and variety credits only when the focus asks for them and the
day's remaining balance is above ``PLANTNET_RESERVE``. The response keeps
Pl@ntNet's own JSON and adds ``species``, ``origin``, ``care``, ``health``,
``varieties``, and ``quota``.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from app.errors import APIError
from app.plantscan import PlantNet, mark_cached, normalize_focus, photo_key, pick_flora, until_utc_midnight, valid_project
from app.ratelimit import limit

log = logging.getLogger("growman.plants")
router = APIRouter(dependencies=[Depends(limit("plant", 20, 60, fail_closed=True))])


def _key(request: Request) -> str:
    key = request.app.state.settings.plantnet_api_key
    if not key:
        raise APIError(503, "plant_identification_unavailable")
    return key


@router.get("/plants/status")
def status(request: Request):
    return {"configured": bool(request.app.state.settings.plantnet_api_key)}


@router.get("/plants/languages")
def languages(request: Request):
    return _cached_get(request, "/v2/languages")


@router.get("/plants/projects")
def projects(request: Request):
    return _cached_get(request, "/v2/projects")


@router.get("/plants/species")
def species(request: Request):
    return _cached_get(request, "/v2/species", dict(request.query_params))


@router.get("/plants/diseases")
def diseases(request: Request):
    _key(request)
    return _cached_get(request, "/v2/diseases", dict(request.query_params))


@router.get("/plants/varieties")
def varieties(request: Request):
    _key(request)
    return _cached_get(request, "/v2/varieties", dict(request.query_params))


@router.get("/plants/quota")
def quota(request: Request):
    client = PlantNet(request.app.state.settings, request.app.state.cache)
    _key(request)
    remaining, known = client.remaining()
    return {"remaining": remaining if known else None, "reserve": request.app.state.settings.plantnet_reserve, "known": known}


def _cached_get(request: Request, path: str, params: dict | None = None):
    settings = request.app.state.settings
    query = {key: value for key, value in (params or {}).items() if key != "api-key" and value != ""}
    client = PlantNet(settings, request.app.state.cache)
    try:
        raw = client.cached_get(path, query, 900)
    except APIError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise APIError(502, "plantnet_unavailable") from exc
    return Response(content=raw, media_type="application/json")


def _flag(form, name: str) -> bool:
    return str(form.get(name) or "").lower() in {"1", "true", "yes", "on"}


@router.post("/images/identify-plant")
async def identify(request: Request):
    _key(request)
    form = await request.form()
    uploads = list(form.getlist("images")) + list(form.getlist("image"))
    if not uploads:
        one = form.get("file")
        uploads = [one] if one is not None else []
    photos = []
    for upload in uploads:
        if not hasattr(upload, "read"):
            continue
        data = await upload.read()
        if data:
            photos.append((getattr(upload, "filename", "plant.jpg"), data, getattr(upload, "content_type", "") or "image/jpeg"))
    if not photos:
        raise APIError(400, "an image is required")
    if len(photos) > 5:
        raise APIError(400, "send at most 5 images")
    organs = [str(value) for value in form.getlist("organs")] or [str(form.get("organs") or "auto")]
    settings = request.app.state.settings
    lang = str(form.get("lang") or "en").strip().lower()
    focus = normalize_focus(str(form.get("focus") or "care"))
    try:
        nb = int(form.get("nb-results") or 0)
    except ValueError:
        nb = 0
    flags = {"related": _flag(form, "related-images"), "no_reject": _flag(form, "no-reject"), "detailed": _flag(form, "detailed")}
    explicit = str(form.get("project") or "").strip()
    fallback = settings.plantnet_project if valid_project(settings.plantnet_project) else "all"
    project = explicit if explicit and explicit != "all" and valid_project(explicit) else fallback
    lat, lon = str(form.get("lat") or ""), str(form.get("lon") or "")
    client = PlantNet(settings, request.app.state.cache)
    if (not explicit or explicit == "all") and lat and lon:
        try:
            raw = client.cached_get("/v2/projects", {"lat": lat, "lon": lon, "lang": lang}, 24 * 3600)
            import json

            project = pick_flora("", json.loads(raw), fallback)
        except Exception as exc:  # noqa: BLE001 — a flora lookup miss falls back to "all"
            log.info("flora lookup failed: %s", exc)
            project = fallback
    cache_key = photo_key(project, lang, focus, nb, flags, photos, organs)
    fresh: dict[str, bool] = {}

    def load() -> bytes:
        import json

        doc = client.scan(photos, organs, project, lang, focus, nb, flags)
        fresh["ok"] = True
        return json.dumps(doc).encode()

    raw = request.app.state.cache.get_or_load(cache_key, until_utc_midnight(), load)
    import json

    doc = json.loads(raw)
    if "ok" not in fresh:
        doc = mark_cached(doc)
    return doc
