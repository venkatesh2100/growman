"""Hybrid search: BM25, local dense vectors, reciprocal rank fusion, rerank.

The dense model and the cross-encoder are local. Tests pass a hash embedder
and an overlap reranker so they never download weights.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
from rank_bm25 import BM25Okapi

from app.ingest import Chunk
from app.textutil import tokenize

RRF_K = 60


class HashEmbedder:
    """Deterministic bag-of-tokens vectors. Used when the bge model is off."""

    name = "hash"
    dim = 64

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self.embed_query(text) for text in texts]

    def embed_query(self, text: str) -> list[float]:
        vec = [0.0] * self.dim
        for tok in tokenize(text):
            digest = hashlib.sha256(tok.encode("utf-8")).digest()
            vec[digest[0] % self.dim] += 1.0
        return vec


class OverlapReranker:
    """Lexical stand-in for the cross-encoder. Higher overlap ranks first."""

    name = "overlap"

    def rerank(self, query: str, chunks: list[Chunk], top_n: int) -> list[Chunk]:
        from app.textutil import support

        ranked = sorted(chunks, key=lambda chunk: support(query, chunk.text), reverse=True)
        return ranked[:top_n]


class LangChainMiniLMReranker:
    """LangChain CrossEncoderReranker over a local MiniLM cross-encoder."""

    name = "minilm"

    def __init__(self) -> None:
        from langchain_community.cross_encoders import HuggingFaceCrossEncoder
        from langchain_core.documents import Document

        self._model = HuggingFaceCrossEncoder(model_name="cross-encoder/ms-marco-MiniLM-L-6-v2")
        self._document = Document
        self._compressor_cls = _cross_encoder_reranker_cls()

    def rerank(self, query: str, chunks: list[Chunk], top_n: int) -> list[Chunk]:
        compressor = self._compressor_cls(model=self._model, top_n=top_n)
        docs = [
            self._document(page_content=chunk.text, metadata={"idx": index})
            for index, chunk in enumerate(chunks)
        ]
        ranked = compressor.compress_documents(docs, query)
        return [chunks[doc.metadata["idx"]] for doc in ranked]


def _cross_encoder_reranker_cls():
    try:
        from langchain.retrievers.document_compressors import CrossEncoderReranker
    except ImportError:
        from langchain_classic.retrievers.document_compressors import CrossEncoderReranker
    return CrossEncoderReranker


class BgeEmbedder:
    name = "bge-small-en-v1.5"

    def __init__(self) -> None:
        from langchain_huggingface import HuggingFaceEmbeddings

        self._model = HuggingFaceEmbeddings(model_name="BAAI/bge-small-en-v1.5")

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._model.embed_documents(texts)

    def embed_query(self, text: str) -> list[float]:
        return self._model.embed_query(text)


def load_embedder(backend: str):
    if backend == "hash":
        return HashEmbedder()
    if backend == "bge":
        return BgeEmbedder()
    raise ValueError(f"unknown embedding backend {backend}")


def load_reranker(backend: str):
    if backend == "overlap":
        return OverlapReranker()
    if backend == "minilm":
        return LangChainMiniLMReranker()
    raise ValueError(f"unknown rerank backend {backend}")


class HybridIndex:
    def __init__(self, chunks: list[Chunk], embedder, reranker, cache_path: str | None = None) -> None:
        self.chunks = chunks
        self.embedder = embedder
        self.reranker = reranker
        tokenized = [tokenize(chunk.text) or ["empty"] for chunk in chunks]
        self._bm25 = BM25Okapi(tokenized) if tokenized else None
        self._vectors = np.asarray(
            _cached_vectors(chunks, embedder, cache_path),
            dtype=float,
        ) if chunks else np.zeros((0, 1))

    def retrieve(self, query: str, top_n: int = 4, pool: int = 20) -> list[Chunk]:
        fused = self.search(query, k=pool)
        if not fused:
            return []
        return self.reranker.rerank(query, fused, top_n)

    def search(self, query: str, k: int = 20) -> list[Chunk]:
        if not self.chunks or self._bm25 is None:
            return []
        tokens = tokenize(query) or ["empty"]
        lexical = np.asarray(self._bm25.get_scores(tokens), dtype=float)
        query_vec = np.asarray(self.embedder.embed_query(query), dtype=float)
        dense = _cosine_matrix(self._vectors, query_vec)
        lexical_ids = _top_ids(lexical, k)
        dense_ids = _top_ids(dense, k)
        fused_ids = _rrf([lexical_ids, dense_ids])
        return [self.chunks[index] for index in fused_ids[:k]]


def _top_ids(scores: np.ndarray, k: int) -> list[int]:
    if scores.size == 0:
        return []
    order = np.argsort(-scores)
    chosen = []
    for index in order:
        if scores[index] <= 0:
            break
        chosen.append(int(index))
        if len(chosen) >= k:
            break
    return chosen


def _cosine_matrix(matrix: np.ndarray, query: np.ndarray) -> np.ndarray:
    if matrix.size == 0:
        return np.zeros(0)
    qnorm = np.linalg.norm(query)
    if qnorm == 0:
        return np.zeros(matrix.shape[0])
    norms = np.linalg.norm(matrix, axis=1)
    denom = norms * qnorm
    dots = matrix @ query
    out = np.zeros(matrix.shape[0], dtype=float)
    mask = denom > 0
    out[mask] = dots[mask] / denom[mask]
    return out


def _rrf(rankings: list[list[int]], k: int = RRF_K) -> list[int]:
    scores: dict[int, float] = {}
    for ranking in rankings:
        for rank, doc_id in enumerate(ranking, start=1):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
    return sorted(scores, key=lambda doc_id: scores[doc_id], reverse=True)


def _cached_vectors(chunks: list[Chunk], embedder, cache_path: str | None) -> list[list[float]]:
    texts = [chunk.text for chunk in chunks]
    digest = hashlib.sha256(("\n".join(chunk.id for chunk in chunks) + embedder.name).encode()).hexdigest()
    path = Path(cache_path) if cache_path else None
    if path and path.exists():
        try:
            cached = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            cached = None
        if cached and cached.get("digest") == digest and cached.get("vectors"):
            return cached["vectors"]
    vectors = embedder.embed_documents(texts)
    if path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"digest": digest, "backend": embedder.name, "vectors": vectors}),
            encoding="utf-8",
        )
    return vectors
