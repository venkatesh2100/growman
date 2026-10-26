FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY app ./app
COPY corpus ./corpus

# CPU torch first, so sentence-transformers does not pull a CUDA wheel.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir ".[models]" \
    && python -c "from sentence_transformers import SentenceTransformer, CrossEncoder; SentenceTransformer('BAAI/bge-small-en-v1.5'); CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')"

ENV EMBEDDING_BACKEND=hash \
    RERANK_BACKEND=overlap \
    CORPUS_PATH=/app/corpus/growman.txt \
    VECTOR_CACHE_PATH=/app/.cache/vectors.json \
    HF_HOME=/app/.cache/huggingface

EXPOSE 8080

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
