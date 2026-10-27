"""Image storage.

The database stores a key, never a full URL. ``IMAGE_BASE_URL`` is applied
when a response is built, so a CDN change does not rewrite every row.

Bytes go to Google Cloud Storage when a bucket is configured and the
client library can authenticate. They are also written under ``data/uploads``
so a laptop without GCP still has a file the ``/uploads`` route can serve.
"""

from __future__ import annotations

import logging
import time
from io import BytesIO
from pathlib import Path

log = logging.getLogger("growman.images")

UPLOAD_ROOT = Path(__file__).resolve().parents[1] / "data" / "uploads"
_ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
_ALLOWED_MIME = {"image/jpeg", "image/png", "image/gif", "image/webp"}
_MIME_FOR_EXT = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp"}


def sanitize_prefix(prefix: str) -> str:
    cleaned = []
    for char in (prefix or "").lower().strip("/"):
        if char.isalnum() or char in "-_":
            cleaned.append(char)
    return "".join(cleaned) or "uploads"


def image_key(prefix: str, filename: str) -> str:
    prefix = sanitize_prefix(prefix)
    name = Path(filename or "image.jpg").name
    ext = Path(name).suffix.lower()
    if ext not in _ALLOWED_EXT:
        ext = ".jpg"
    stem = Path(name).stem.lower().replace(" ", "-").replace("_", "-")
    safe = "".join(char for char in stem if char.isalnum() or char == "-") or "image"
    return f"{prefix}/{int(time.time())}-{safe}{ext}"


def content_type_for(filename: str, declared: str) -> str:
    mime = (declared or "").split(";")[0].strip().lower()
    if mime in _ALLOWED_MIME:
        return mime
    ext = Path(filename or "").suffix.lower()
    return _MIME_FOR_EXT.get(ext, "")


def optimize(data: bytes, content_type: str) -> tuple[bytes, str]:
    """Shrink a camera original the way the Go uploader does.

    Files already under 350 KB, or formats other than JPEG and PNG, are
    stored as uploaded. A result that is not smaller is discarded.
    """
    if content_type not in {"image/jpeg", "image/png"} or len(data) <= 350 * 1024:
        return data, content_type
    try:
        from PIL import Image
    except ImportError:
        return data, content_type
    try:
        image = Image.open(BytesIO(data))
        image.load()
    except Exception:  # noqa: BLE001 — a bad file is stored as-is and rejected later by type checks
        return data, content_type
    if image.width * image.height > 50_000_000:
        return data, content_type
    longest = max(image.width, image.height)
    if longest > 1600:
        scale = 1600 / longest
        image = image.resize((max(int(image.width * scale), 1), max(int(image.height * scale), 1)))
    out = BytesIO()
    if content_type == "image/png" and image.mode in {"RGBA", "LA"}:
        image.save(out, format="PNG", optimize=True)
        mime = "image/png"
    else:
        if image.mode not in {"RGB", "L"}:
            image = image.convert("RGB")
        image.save(out, format="JPEG", quality=82, optimize=True)
        mime = "image/jpeg"
    cooked = out.getvalue()
    if len(cooked) >= len(data):
        return data, content_type
    return cooked, mime


def public_url(settings, key: str) -> str:
    base = (settings.image_base_url or "").rstrip("/")
    if base:
        return f"{base}/{key}"
    return f"/uploads/{key}"


def store(settings, data: bytes, filename: str, declared_type: str, prefix: str) -> tuple[str, str]:
    mime = content_type_for(filename, declared_type)
    if not mime:
        raise ValueError("unsupported image type")
    data, mime = optimize(data, mime)
    key = image_key(prefix, filename)
    if mime == "image/jpeg" and not key.endswith((".jpg", ".jpeg")):
        key = str(Path(key).with_suffix(".jpg"))
    path = UPLOAD_ROOT / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    _gcs(settings, key, data, mime)
    return key, public_url(settings, key)


def _gcs(settings, key: str, data: bytes, mime: str) -> None:
    bucket_name = (settings.gcs_bucket_name or "").strip()
    if not bucket_name:
        return
    try:
        from google.cloud import storage
    except ImportError:
        log.warning("GCS_BUCKET_NAME is set but google-cloud-storage is not installed; kept a local copy of %s", key)
        return
    try:
        client = storage.Client.from_service_account_json(settings.gcs_credentials_json) if settings.gcs_credentials_json else storage.Client(project=settings.gcs_project_id or None)
        blob = client.bucket(bucket_name).blob(key)
        blob.cache_control = "public, max-age=31536000, immutable"
        blob.upload_from_string(data, content_type=mime)
    except Exception as exc:  # noqa: BLE001 — the local copy still answers /uploads
        log.warning("gcs upload %s failed: %s", key, exc)
