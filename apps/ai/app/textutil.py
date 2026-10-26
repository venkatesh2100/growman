"""Token helpers shared by retrieval, routing, and guardrails."""

from __future__ import annotations

import re

TOKEN_RE = re.compile(r"[a-z0-9]+")

# Words that show up in almost every nursery question and every chunk.
# Keeping them would make a weak passage look like a match.
STOP = {
    "the", "and", "for", "with", "from", "that", "this", "what", "when",
    "where", "which", "how", "can", "does", "did", "are", "was", "were",
    "you", "your", "about", "please", "tell", "have", "has", "had", "not",
    "but", "its", "it's", "into", "over", "under", "than", "then", "them",
    "they", "our", "out", "any", "all", "just", "like", "will", "would",
    "should", "could", "there", "here", "also", "very", "much", "more",
    "some", "such", "only", "other", "growman", "dootha", "plant", "plants",
}


def normalize_token(token: str) -> str:
    for suffix in ("ing", "ed", "es"):
        if len(token) > len(suffix) + 3 and token.endswith(suffix):
            token = token[: -len(suffix)]
            break
    if len(token) > 4 and token.endswith("s") and not token.endswith("ss"):
        token = token[:-1]
    return token


def tokenize(text: str) -> list[str]:
    return [normalize_token(tok) for tok in TOKEN_RE.findall(text.lower())]


def content_tokens(text: str) -> set[str]:
    out = set()
    for tok in tokenize(text):
        if len(tok) < 3 or tok in STOP:
            continue
        out.add(tok)
    return out


def support(query: str, text: str) -> float:
    """Share of the question's meaningful words that appear in a passage."""
    wanted = content_tokens(query)
    if not wanted:
        return 1.0
    have = set(tokenize(text))
    return len(wanted & have) / len(wanted)
