"""Runtime settings. The browser never talks to this process."""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    rag_shared_secret: str = ""
    gemini_api_key: str = ""
    catalog_api_url: str = "http://localhost:8080/api/v1"
    redis_url: str = ""
    # bge uses a local embedding model. hash is the deterministic stand-in
    # for tests and for machines that have not downloaded the model yet.
    embedding_backend: str = "bge"
    # minilm uses the LangChain cross-encoder reranker. overlap is lexical.
    rerank_backend: str = "minilm"
    corpus_path: str = str(ROOT / "corpus" / "growman.txt")
    vector_cache_path: str = str(ROOT / ".cache" / "vectors.json")
    gemini_model: str = "gemini-flash-latest"
    answer_cache_ttl_seconds: int = 600

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


def get_settings() -> Settings:
    return Settings()
