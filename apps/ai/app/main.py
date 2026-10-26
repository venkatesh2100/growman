"""HTTP entrypoint. Go is the only caller."""

from __future__ import annotations

import secrets
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from app.catalog import HttpCatalog
from app.config import get_settings
from app.hybrid import load_embedder, load_reranker
from app.llm import build_classifier, build_synthesizer
from app.service import DoothaRAG, build_index, cache_from_url

settings = get_settings()


class HistoryTurn(BaseModel):
    role: str = "user"
    content: str = ""


class AnswerRequest(BaseModel):
    message: str
    history: list[HistoryTurn] = Field(default_factory=list)


class CareRequest(BaseModel):
    species: str = ""
    commonNames: list[str] = Field(default_factory=list)
    family: str = ""
    originCountries: list[str] = Field(default_factory=list)
    language: str = "en"


def require_secret(x_growman_rag_secret: str = Header(default="")) -> None:
    expected = settings.rag_shared_secret
    if not expected or not secrets.compare_digest(x_growman_rag_secret, expected):
        raise HTTPException(status_code=401, detail="unauthorized")


@asynccontextmanager
async def lifespan(app: FastAPI):
    embedder = load_embedder(settings.embedding_backend)
    reranker = load_reranker(settings.rerank_backend)
    catalog = HttpCatalog(settings.catalog_api_url)
    index = build_index(
        settings.corpus_path,
        embedder,
        reranker,
        catalog,
        settings.vector_cache_path,
    )
    synthesizer = None
    classifier = None
    if settings.gemini_api_key:
        synthesizer = build_synthesizer(settings.gemini_api_key, settings.gemini_model)
        classifier = build_classifier(settings.gemini_api_key, settings.gemini_model)
    app.state.rag = DoothaRAG(
        index,
        catalog,
        synthesizer,
        classifier,
        cache_from_url(settings.redis_url),
        settings.answer_cache_ttl_seconds,
    )
    app.state.embedder_name = getattr(embedder, "name", settings.embedding_backend)
    app.state.reranker_name = getattr(reranker, "name", settings.rerank_backend)
    yield


app = FastAPI(title="Growman Dootha RAG", lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    rag = getattr(app.state, "rag", None)
    chunks = len(rag.index.chunks) if rag is not None else 0
    return {
        "status": "ok",
        "chunks": chunks,
        "embedding": getattr(app.state, "embedder_name", ""),
        "reranker": getattr(app.state, "reranker_name", ""),
    }


@app.post("/v1/answer")
def answer(body: AnswerRequest, _: None = Depends(require_secret)) -> dict:
    rag: DoothaRAG = app.state.rag
    try:
        return rag.answer(body.message, [turn.model_dump() for turn in body.history])
    except Exception as exc:
        raise HTTPException(status_code=503, detail="rag unavailable") from exc


@app.post("/v1/care")
def care(body: CareRequest, _: None = Depends(require_secret)) -> dict:
    rag: DoothaRAG = app.state.rag
    try:
        guide = rag.care(
            body.species.strip(),
            body.commonNames,
            body.family,
            body.originCountries,
            body.language,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail="care unavailable") from exc
    if not guide:
        raise HTTPException(status_code=404, detail="no grounded care sheet")
    return guide


@app.post("/v1/reindex")
def reindex(_: None = Depends(require_secret)) -> dict:
    embedder = load_embedder(settings.embedding_backend)
    reranker = load_reranker(settings.rerank_backend)
    catalog = app.state.rag.catalog
    index = build_index(
        settings.corpus_path,
        embedder,
        reranker,
        catalog,
        settings.vector_cache_path,
    )
    app.state.rag.index = index
    app.state.rag.graph.index = index
    return {"chunks": len(index.chunks)}
