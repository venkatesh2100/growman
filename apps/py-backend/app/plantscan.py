"""One plant photo, spent carefully.

The free Pl@ntNet plan is 500 identifications per UTC day, shared by
species, disease, and variety. A scan always spends one credit on species.
Disease and variety credits are spent only for the requested focus, and
only while the day's remaining balance is above ``PLANTNET_RESERVE``.

Origin comes from GBIF using the id Pl@ntNet already returned. Care text
comes from the RAG service. Neither spends an identify credit. The same
photo is cached until 00:00 UTC, so a retry does not spend another credit.
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone

import httpx

from app.errors import APIError

log = logging.getLogger("growman.plants")

SKIP_NOT_REQUESTED = "not_requested"
SKIP_QUOTA = "quota_reserve"
SKIP_NOT_IN_CATALOG = "not_in_catalog"
SKIP_FAILED = "failed"
SKIP_NO_SPECIES = "no_species"
_ORGANS = {"auto", "leaf", "flower", "fruit", "bark"}


def normalize_focus(focus: str) -> str:
    focus = (focus or "").strip().lower()
    return focus if focus in {"species", "health", "variety", "full", "care"} else "care"


def plan(focus: str, remaining: int, known: bool, reserve: int) -> dict:
    """Decide the two optional calls. Species is always required and is not listed here.

    ``known`` is false until this process has seen a remaining count for
    today. The first scan of the day may try the extra call; the response
    then teaches us the real balance. Once remaining is at or below the
    reserve, a busy day degrades to species-only instead of spending the
    last credits three at a time.
    """
    reserve = max(reserve, 0)
    focus = normalize_focus(focus)
    want_disease = focus in {"health", "full", "care"}
    want_variety = focus in {"variety", "full", "care"}
    disease = want_disease and not (known and remaining <= reserve)
    variety = want_variety and not (known and remaining <= reserve)
    return {
        "disease": disease,
        "variety": variety,
        "disease_skip": "" if disease else (SKIP_QUOTA if want_disease else SKIP_NOT_REQUESTED),
        "variety_skip": "" if variety else (SKIP_QUOTA if want_variety else SKIP_NOT_REQUESTED),
    }


def valid_project(value: str) -> bool:
    if not value or len(value) > 64:
        return False
    for index, char in enumerate(value):
        if char.islower() or char.isdigit():
            continue
        if char == "-" and index > 0:
            continue
        return False
    return True


def pick_flora(explicit: str, projects: list[dict], fallback: str) -> str:
    """An explicit project wins. Otherwise the nearest Kew flora (id prefix ``k-``)."""
    explicit = (explicit or "").strip()
    if explicit and explicit != "all" and valid_project(explicit):
        return explicit
    for project in projects:
        project_id = str(project.get("id") or "").strip()
        if project_id.startswith("k-") and valid_project(project_id):
            return project_id
    if fallback and valid_project(fallback):
        return fallback
    return "all"


def binomial(name: str) -> str:
    fields = (name or "").lower().split()
    if len(fields) >= 2:
        return " ".join(fields[:2])
    return fields[0] if fields else ""


def _flex(value) -> str:
    if value is None or value == "":
        return ""
    return str(value)


def top_species(body: dict) -> dict | None:
    results = body.get("results") or []
    if not results:
        return None
    row = results[0]
    species = row.get("species") or {}
    hit = {
        "scientificName": species.get("scientificName") or "",
        "scientificNameWithoutAuthor": species.get("scientificNameWithoutAuthor") or "",
        "commonNames": species.get("commonNames") or [],
        "family": (species.get("family") or {}).get("scientificName") or "",
        "genus": (species.get("genus") or {}).get("scientificName") or "",
        "score": row.get("score") or 0,
        "gbifId": _flex((row.get("gbif") or {}).get("id")),
        "powoId": _flex((row.get("powo") or {}).get("id")),
    }
    if not hit["scientificName"] and not hit["scientificNameWithoutAuthor"]:
        return None
    return {key: value for key, value in hit.items() if value not in ("", [], 0, None) or key == "score"}


def remaining_count(body: dict) -> int | None:
    value = body.get("remainingIdentificationRequests")
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _side(ran: bool, skipped: str, results: list | None = None) -> dict:
    out = {"ran": ran}
    if skipped:
        out["skipped"] = skipped
    if results:
        out["results"] = results
    return out


def merge(species: dict, *, flora: str, hit: dict | None, origin: dict | None, care: dict | None, health: dict, varieties: dict, quota: dict) -> dict:
    """Keep Pl@ntNet's own fields and add the ones this API invented."""
    doc = dict(species)
    if flora:
        doc["flora"] = flora
    if hit:
        doc["species"] = hit
    if origin:
        doc["origin"] = origin
    if care:
        doc["care"] = care
    doc["health"] = health
    doc["varieties"] = varieties
    doc["quota"] = quota
    return doc


def mark_cached(doc: dict) -> dict:
    quota = dict(doc.get("quota") or {})
    quota["cached"] = True
    quota["creditsUsed"] = 0
    doc = dict(doc)
    doc["quota"] = quota
    return doc


def until_utc_midnight(now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)
    nxt = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(int((nxt - now).total_seconds()), 60)


def _native_summary(codes: list[str]) -> str:
    codes = sorted({code.upper() for code in codes if len(code) == 2})
    if not codes:
        return ""
    if len(codes) > 8:
        return f"GBIF native records in {len(codes)} countries, including {', '.join(codes[:8])}"
    return "GBIF native records: " + ", ".join(codes)


def _catalog_has(catalog: bytes, name: str) -> bool:
    want = binomial(name)
    if not want:
        return False
    try:
        rows = json.loads(catalog)
    except json.JSONDecodeError:
        return False
    if not isinstance(rows, list):
        return False
    for row in rows:
        if not isinstance(row, dict):
            continue
        species = row.get("species")
        if isinstance(species, str) and binomial(species) == want:
            return True
        if isinstance(species, dict) and (binomial(species.get("scientificNameWithoutAuthor") or "") == want or binomial(species.get("scientificName") or "") == want):
            return True
    return False


class PlantNet:
    def __init__(self, settings, cache):
        self.settings = settings
        self.cache = cache
        self.base = settings.plantnet_base_url.rstrip("/")

    def _get(self, path: str, params: dict | None = None) -> bytes:
        query = dict(params or {})
        query["api-key"] = self.settings.plantnet_api_key
        response = httpx.get(self.base + path, params=query, timeout=12)
        if response.status_code >= 300:
            raise APIError(502, "plantnet_unavailable")
        self._note(response.json() if response.headers.get("content-type", "").startswith("application/json") else {})
        return response.content

    def cached_get(self, path: str, params: dict | None = None, ttl: int = 900) -> bytes:
        key = "plantnet:get:" + path + "?" + "&".join(f"{k}={v}" for k, v in sorted((params or {}).items()))
        return self.cache.get_or_load(key, ttl, lambda: self._get(path, params))

    def _day_key(self) -> str:
        return "plantnet:remaining:" + datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def remaining(self) -> tuple[int, bool]:
        raw = self.cache.get_raw(self._day_key())
        if raw is None:
            return 0, False
        try:
            return int(raw), True
        except ValueError:
            return 0, False

    def _note(self, body: dict) -> None:
        count = remaining_count(body) if isinstance(body, dict) else None
        if count is None:
            return
        self.cache.set_raw(self._day_key(), str(count).encode(), until_utc_midnight())

    def _identify(self, path: str, field: str, photos: list[tuple[str, bytes, str]], organs: list[str], params: dict) -> dict:
        files = []
        data = []
        for index, (name, blob, mime) in enumerate(photos):
            organ = organs[index] if index < len(organs) and organs[index] in _ORGANS else "auto"
            data.append(("organs", organ))
            files.append((field, (name or "plant.jpg", blob, mime or "image/jpeg")))
        query = {"api-key": self.settings.plantnet_api_key, **params}
        try:
            response = httpx.post(self.base + path, params=query, data=data, files=files, timeout=22)
        except httpx.HTTPError as exc:
            raise APIError(502, "plantnet_unavailable") from exc
        if response.status_code == 429:
            self.cache.set_raw(self._day_key(), b"0", until_utc_midnight())
            raise APIError(429, "Plant identification quota is used up for today. It resets at 00:00 UTC.")
        if response.status_code >= 300:
            log.warning("plantnet %s %s", path, response.text[:180])
            raise APIError(502, "plantnet_unavailable")
        body = response.json()
        self._note(body)
        return body

    def gbif(self, gbif_id: str) -> dict | None:
        if not gbif_id:
            return None
        key = "plantnet:gbif:" + gbif_id
        raw = self.cache.get_raw(key)

        def load() -> bytes:
            try:
                response = httpx.get(
                    f"https://api.gbif.org/v1/species/{gbif_id}/distributions",
                    params={"limit": 300},
                    headers={"User-Agent": "Growman/1.0 (plant-care; +https://growman.live)", "Accept": "application/json"},
                    timeout=4,
                )
                response.raise_for_status()
                rows = response.json().get("results") or []
            except Exception as exc:  # noqa: BLE001 — origin is optional
                log.info("gbif %s: %s", gbif_id, exc)
                rows = []
            codes = sorted({str(row.get("country") or "").upper() for row in rows if str(row.get("establishmentMeans") or "").upper() == "NATIVE" and len(str(row.get("country") or "")) == 2})
            return json.dumps(codes).encode()

        raw = raw or self.cache.get_or_load(key, 14 * 24 * 3600, load)
        try:
            codes = json.loads(raw)
        except json.JSONDecodeError:
            return None
        summary = _native_summary(codes)
        if not summary:
            return None
        return {"summary": summary, "nativeCountries": codes, "source": "gbif"}

    def care(self, hit: dict, lang: str, origin: dict | None) -> dict | None:
        name = hit.get("scientificNameWithoutAuthor") or hit.get("scientificName") or ""
        if not name or not self.settings.rag_service_url:
            return None
        key = "plantnet:care:v1:" + (lang or "en") + ":" + binomial(name)
        cached = self.cache.get_raw(key)
        if cached:
            try:
                return json.loads(cached)
            except json.JSONDecodeError:
                pass
        payload = {
            "species": name,
            "commonNames": hit.get("commonNames") or [],
            "family": hit.get("family") or "",
            "originCountries": (origin or {}).get("nativeCountries") or [],
            "language": lang or "en",
        }
        try:
            response = httpx.post(
                self.settings.rag_service_url.rstrip("/") + "/v1/care",
                json=payload,
                headers={"X-Growman-RAG-Secret": self.settings.rag_shared_secret},
                timeout=12,
            )
            response.raise_for_status()
            text = response.text
        except Exception as exc:  # noqa: BLE001
            log.info("care guide unavailable: %s", exc)
            return None
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            guide = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None
        out = {field: str(guide[field])[:240] for field in ("origin", "light", "water", "soil", "temperature", "fertilizer") if guide.get(field)}
        for field in ("pests", "diseases"):
            values = [str(item)[:80] for item in (guide.get(field) or []) if str(item).strip()][:4]
            if values:
                out[field] = values
        if not out:
            return None
        out["source"] = "guidance"
        self.cache.set_raw(key, json.dumps(out).encode(), 14 * 24 * 3600)
        return out

    def scan(self, photos: list[tuple[str, bytes, str]], organs: list[str], project: str, lang: str, focus: str, nb: int, flags: dict) -> dict:
        remaining, known = self.remaining()
        if known and remaining <= 0:
            raise APIError(429, "Plant identification quota is used up for today. It resets at 00:00 UTC.")
        spend = plan(focus, remaining, known, self.settings.plantnet_reserve)
        params = {}
        if lang:
            params["lang"] = lang
        if nb:
            params["nb-results"] = str(nb)
        for flag, query_name in (("related", "include-related-images"), ("no_reject", "no-reject"), ("detailed", "detailed")):
            if flags.get(flag):
                params[query_name] = "true"
        species = self._identify(f"/v2/identify/{project}", "images", photos, organs, params)
        credits = 1
        hit = top_species(species)
        health = _side(False, spend["disease_skip"])
        varieties = _side(False, spend["variety_skip"])
        if spend["disease"]:
            try:
                disease_body = self._identify("/v2/diseases/identify", "image", photos, organs, params)
                credits += 1
                health = _side(True, "", _health_hits(disease_body))
            except APIError:
                health = _side(False, SKIP_FAILED)
        origin = self.gbif(hit.get("gbifId") or "") if hit else None
        care = self.care(hit, lang, origin) if hit else None
        if spend["variety"]:
            varieties, extra = self._varieties(hit, photos, organs, params, lang)
            credits += extra
        if care and care.get("origin"):
            if origin:
                origin = {**origin, "summary": care["origin"], "source": "gbif+guidance" if origin.get("source") == "gbif" else origin.get("source")}
            else:
                origin = {"summary": care["origin"], "source": "guidance"}
        left, known_after = self.remaining()
        quota = {"creditsUsed": credits, "cached": False, "reserve": self.settings.plantnet_reserve}
        if known_after:
            quota["remaining"] = left
        return merge(species, flora=project, hit=hit, origin=origin, care=care, health=health, varieties=varieties, quota=quota)

    def _varieties(self, hit, photos, organs, params, lang) -> tuple[dict, int]:
        if not hit:
            return _side(False, SKIP_NO_SPECIES), 0
        remaining, known = self.remaining()
        if known and remaining <= self.settings.plantnet_reserve:
            return _side(False, SKIP_QUOTA), 0
        try:
            catalog = self.cached_get("/v2/varieties", {"lang": lang} if lang else None, 24 * 3600)
        except APIError:
            return _side(False, SKIP_FAILED), 0
        name = hit.get("scientificNameWithoutAuthor") or hit.get("scientificName") or ""
        if not _catalog_has(catalog, name):
            return _side(False, SKIP_NOT_IN_CATALOG), 0
        try:
            body = self._identify("/v2/varieties/identify", "images", photos, organs, params)
        except APIError:
            return _side(False, SKIP_FAILED), 0
        results = []
        for row in body.get("results") or []:
            species = (row.get("species") or {}).get("scientificNameWithoutAuthor") or (row.get("species") or {}).get("scientificName") or ""
            for variety in row.get("varieties") or []:
                if (variety.get("name") or "").strip():
                    results.append({"name": variety["name"], "species": species, "score": variety.get("score") or 0})
        return _side(True, "", results), 1


def _health_hits(body: dict) -> list[dict]:
    out = []
    for row in body.get("results") or []:
        if row.get("name") or row.get("description") or row.get("label"):
            out.append({key: row[key] for key in ("name", "description", "label", "score") if row.get(key) not in (None, "")})
    return out


def photo_key(project: str, lang: str, focus: str, nb: int, flags: dict, photos: list[tuple[str, bytes, str]], organs: list[str]) -> str:
    digest = hashlib.sha256()
    digest.update(f"{project}|{lang}|{focus}|{nb}|{flags}|{organs}".encode())
    for _name, blob, mime in photos:
        digest.update(mime.encode())
        digest.update(blob)
    return "plantnet:scan:" + digest.hexdigest()
