"""Answer cache and the object the HTTP handlers call."""

from __future__ import annotations

import hashlib
import json
import re
import time

from app.answers import _clip
from app.graph import DoothaGraph
from app.guards import DISCLAIMER, ensure_disclaimer
from app.ingest import chunks_from_catalog, load_corpus
from app.textutil import tokenize

CARE_FIELDS = ("origin", "light", "water", "soil", "temperature", "fertilizer")
FIELD_RE = {
    "light": re.compile(r"(?:^|\n)\s*(?:-\s*)?light:\s*(.+)", re.IGNORECASE),
    "water": re.compile(r"(?:^|\n)\s*(?:-\s*)?water:\s*(.+)", re.IGNORECASE),
    "soil": re.compile(r"(?:^|\n)\s*(?:-\s*)?soil:\s*(.+)", re.IGNORECASE),
    "temperature": re.compile(r"(?:^|\n)\s*(?:-\s*)?temperature:\s*(.+)", re.IGNORECASE),
    "fertilizer": re.compile(r"(?:^|\n)\s*(?:-\s*)?fertil(?:izer|iser):\s*(.+)", re.IGNORECASE),
}


class MemoryCache:
    def __init__(self) -> None:
        self._data: dict[str, tuple[float, str]] = {}

    def get(self, key: str) -> str | None:
        item = self._data.get(key)
        if not item:
            return None
        if item[0] < time.time():
            self._data.pop(key, None)
            return None
        return item[1]

    def set(self, key: str, value: str, ttl: int) -> None:
        self._data[key] = (time.time() + ttl, value)


class RedisCache:
    def __init__(self, url: str) -> None:
        import redis

        self._redis = redis.Redis.from_url(url, socket_timeout=1)

    def get(self, key: str) -> str | None:
        try:
            raw = self._redis.get(key)
        except Exception:
            return None
        if raw is None:
            return None
        return raw.decode("utf-8") if isinstance(raw, bytes) else str(raw)

    def set(self, key: str, value: str, ttl: int) -> None:
        try:
            self._redis.set(key, value, ex=ttl)
        except Exception:
            return


def cache_from_url(url: str):
    if not url:
        return MemoryCache()
    try:
        cache = RedisCache(url)
        cache.set("rag:ping", "1", 5)
        return cache
    except Exception:
        return MemoryCache()


class DoothaRAG:
    def __init__(self, index, catalog, synthesizer=None, classifier=None, cache=None, ttl: int = 600) -> None:
        self.index = index
        self.catalog = catalog
        self.synthesizer = synthesizer
        self.cache = cache or MemoryCache()
        self.ttl = ttl
        self.graph = DoothaGraph(index, catalog, synthesizer, classifier)

    def answer(self, message: str, history: list[dict] | None = None) -> dict:
        history = _trim_history(history or [])
        cache_key = ""
        if not history:
            cache_key = "rag:v1:" + hashlib.sha256(_normalize(message).encode()).hexdigest()
            cached = self.cache.get(cache_key)
            if cached:
                return json.loads(cached)
        state = self.graph.invoke(message, history)
        payload = {
            "response": state.get("response") or "",
            "productSlugs": state.get("product_slugs") or [],
            "route": state.get("route") or "",
            "usedLlm": bool(state.get("used_llm")),
            "citations": state.get("citations") or [],
        }
        if cache_key and payload["response"]:
            self.cache.set(cache_key, json.dumps(payload), self.ttl)
        return payload

    def care(self, species: str, common_names: list[str], family: str, origin_countries: list[str], language: str) -> dict | None:
        del family, language
        query = " ".join(part for part in [species, *common_names] if part).strip()
        if not query:
            return None
        chunks = self.index.retrieve(query, top_n=4, pool=20)
        hits = [chunk.as_dict() for chunk in chunks]
        guide = _guide_from_hits(species, common_names, hits)
        if guide:
            if origin_countries and not guide.get("origin"):
                guide["origin"] = "Native range includes " + ", ".join(origin_countries[:8]) + "."
            return guide
        if self.synthesizer is None:
            return None
        passages = [hit.get("text") or "" for hit in hits]
        note = (
            f"Species: {species}\nCommon names: {', '.join(common_names)}\n"
            f"GBIF native country codes: {', '.join(origin_countries)}\n\n"
            + "\n\n".join(passages)
        )
        try:
            text = self.synthesizer.synthesize(
                f"Write a short care sheet for {species}.",
                [],
                [note],
                "plant_care",
                [],
            )
        except Exception:
            return None
        return _guide_from_text(text)


def build_index(corpus_path: str, embedder, reranker, catalog, cache_path: str | None):
    from app.hybrid import HybridIndex

    chunks = load_corpus(corpus_path)
    try:
        chunks.extend(chunks_from_catalog(catalog.listings()))
    except Exception:
        pass
    return HybridIndex(chunks, embedder, reranker, cache_path=cache_path)


def _trim_history(history: list[dict]) -> list[dict]:
    kept = []
    for turn in history[-6:]:
        role = (turn.get("role") or "user").lower()
        if role == "dootha":
            role = "assistant"
        content = (turn.get("content") or "")[:500]
        if content:
            kept.append({"role": role, "content": content})
    return kept


def _normalize(message: str) -> str:
    return " ".join(tokenize(message))


def _guide_from_hits(species: str, common_names: list[str], hits: list[dict]) -> dict | None:
    wanted = set(tokenize(species))
    for name in common_names:
        wanted.update(tokenize(name))
    wanted = {tok for tok in wanted if len(tok) > 3}
    best = None
    best_score = 0
    for hit in hits:
        hay = set(tokenize(f"{hit.get('plant', '')} {hit.get('botanical', '')} {hit.get('text', '')}"))
        score = len(wanted & hay) if wanted else 0
        if score > best_score:
            best = hit
            best_score = score
    if best is None or (wanted and best_score == 0):
        return None
    guide = _guide_from_text(best.get("text") or "")
    if not guide:
        return None
    if any(tok in {"tulsi", "aloe", "patharchatta", "panfuti"} for tok in wanted):
        guide["origin"] = ensure_disclaimer(guide.get("origin") or DISCLAIMER)[:240]
    return guide


def _guide_from_text(text: str) -> dict | None:
    guide: dict = {}
    for key, pattern in FIELD_RE.items():
        match = pattern.search(text or "")
        if not match:
            continue
        value = match.group(1).strip().split("\n")[0].strip(" -")
        if value:
            guide[key] = value[:240]
    problems = re.search(r"common problems:\s*(.+)", text or "", re.IGNORECASE)
    if problems:
        parts = [part.strip(" .") for part in re.split(r"[;,]", problems.group(1)) if part.strip()]
        pests = [part[:80] for part in parts[:4]]
        if pests:
            guide["pests"] = pests
    if re.search(r"root rot", text or "", re.IGNORECASE):
        guide["diseases"] = ["root rot"]
    if not guide:
        return None
    return guide


def clip_passage(text: str) -> str:
    return _clip(text)
