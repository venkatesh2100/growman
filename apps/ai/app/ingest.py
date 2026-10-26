"""Chunk growman.txt the way the file is already marked up.

Snapshot rupee amounts are kept on the chunk as metadata and removed from
the text a model is allowed to read. The price-index section is dropped:
those figures are a dated snapshot, not the shop.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

AMOUNT_RE = re.compile(r"(?:₹|Rs\.?|INR)\s*[\d,]+(?:\.\d+)?", re.IGNORECASE)
PRICE_LINE_RE = re.compile(r"Growman price|PRICE INDEX", re.IGNORECASE)
PLANT_RE = re.compile(r"^### PLANT:\s*(.+?)\s*$", re.MULTILINE)
GUIDE_RE = re.compile(r"^----\s+GUIDE\b.*$", re.MULTILINE)
QA_RE = re.compile(r"^Q:\s*(.+?)\nA:\s*(.+?)(?=\nQ:|\n----|\Z)", re.MULTILINE | re.DOTALL)
CATEGORY_RE = re.compile(r"^Category:\s*(.+)$", re.MULTILINE)
BOTANICAL_RE = re.compile(r"^Botanical name[^:]*:\s*(.+)$", re.MULTILINE)

MAX_CHARS = 900


@dataclass
class Chunk:
    id: str
    text: str
    section: str
    plant: str = ""
    category: str = ""
    botanical: str = ""
    kind: str = "other"
    slug: str = ""
    snapshot_prices: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "text": self.text,
            "section": self.section,
            "plant": self.plant,
            "category": self.category,
            "botanical": self.botanical,
            "kind": self.kind,
            "slug": self.slug,
        }


def strip_prices(text: str) -> tuple[str, list[str]]:
    """Return model-facing text and the rupee amounts that were removed."""
    found: list[str] = []
    kept: list[str] = []
    for line in text.splitlines():
        found.extend(AMOUNT_RE.findall(line))
        if PRICE_LINE_RE.search(line):
            tail = re.sub(
                r"^.*?Growman price.*?(?=Size label:|Status on site:|$)",
                "",
                line,
                count=1,
                flags=re.IGNORECASE,
            )
            tail = AMOUNT_RE.sub("", tail)
            tail = _tidy(tail)
            if tail:
                kept.append(tail)
            continue
        if "snapshot" in line.lower() and AMOUNT_RE.search(line):
            continue
        cleaned = _tidy(AMOUNT_RE.sub("", line))
        if cleaned:
            kept.append(cleaned)
    return "\n".join(kept).strip(), found


def _tidy(line: str) -> str:
    line = re.sub(r"\(\s*original\s*\)", "", line, flags=re.IGNORECASE)
    line = re.sub(r"\(\s*\)", "", line)
    line = re.sub(r"\s{2,}", " ", line)
    return line.strip(" \t-")


def load_corpus(path: str | Path) -> list[Chunk]:
    raw = Path(path).read_text(encoding="utf-8")
    chunks: list[Chunk] = []
    for title, body in _split_sections(raw):
        upper = title.upper()
        if (
            title == "preamble"
            or "PRICE INDEX" in upper
            or "HOW THIS FILE" in upper
            or upper.startswith("END OF")
        ):
            continue
        chunks.extend(_chunks_for_section(title, body))
    return [c for c in chunks if c.text.strip()]


def _split_sections(text: str) -> list[tuple[str, str]]:
    """A section header is a line of =====, the title, and another line of =====."""
    lines = text.splitlines()
    sections: list[tuple[str, str]] = []
    title = "preamble"
    buf: list[str] = []
    i = 0
    while i < len(lines):
        if (
            lines[i].startswith("=====")
            and i + 2 < len(lines)
            and lines[i + 2].startswith("=====")
            and lines[i + 1].strip()
            and not lines[i + 1].startswith("=====")
        ):
            if any(part.strip() for part in buf):
                sections.append((title, "\n".join(buf)))
            title = lines[i + 1].strip()
            buf = []
            i += 3
            continue
        buf.append(lines[i])
        i += 1
    if any(part.strip() for part in buf):
        sections.append((title, "\n".join(buf)))
    return sections


def _chunks_for_section(title: str, body: str) -> list[Chunk]:
    kind = _section_kind(title)
    chunks: list[Chunk] = []
    for match in QA_RE.finditer(body):
        question = match.group(1).strip()
        answer = match.group(2).strip()
        chunks.append(_make(title, f"Q: {question}\nA: {answer}", "faq"))
    # Plant entries and guides live in the body that is not a Q&A run.
    # Q&A sections in this file are only Q&A, so a section that produced
    # any Q&A is done.
    if chunks:
        return chunks

    plants = list(PLANT_RE.finditer(body))
    if plants:
        for index, match in enumerate(plants):
            start = match.start()
            end = plants[index + 1].start() if index + 1 < len(plants) else len(body)
            block = body[start:end].strip()
            name = match.group(1).strip()
            category = _first(CATEGORY_RE, block)
            botanical = _first(BOTANICAL_RE, block)
            chunks.append(
                _make(title, block, "plant", plant=name, category=category, botanical=botanical)
            )
        return chunks

    guides = list(GUIDE_RE.finditer(body))
    if guides:
        for index, match in enumerate(guides):
            start = match.start()
            end = guides[index + 1].start() if index + 1 < len(guides) else len(body)
            chunks.extend(_window(title, body[start:end].strip(), "guide"))
        return chunks

    chunks.extend(_window(title, body.strip(), kind))
    return chunks


def _section_kind(title: str) -> str:
    upper = title.upper()
    if "HELP" in upper or "FREQUENTLY" in upper:
        return "faq"
    if "ABOUT" in upper or "BULK" in upper or "GIFT" in upper:
        return "policy"
    if "GUIDE" in upper or "SEASON" in upper or "TROUBLESHOOT" in upper:
        return "guide"
    if "GLOSSARY" in upper:
        return "glossary"
    if "SELECTION" in upper or "CATEGORY" in upper:
        return "selection"
    return "guide"


def _window(title: str, text: str, kind: str) -> list[Chunk]:
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", text) if part.strip()]
    if not paragraphs:
        return []
    chunks: list[Chunk] = []
    buf = ""
    for para in paragraphs:
        if buf and len(buf) + len(para) + 2 > MAX_CHARS:
            chunks.append(_make(title, buf, kind))
            buf = para
        else:
            buf = f"{buf}\n\n{para}".strip() if buf else para
    if buf:
        chunks.append(_make(title, buf, kind))
    return chunks


def _make(
    section: str,
    text: str,
    kind: str,
    plant: str = "",
    category: str = "",
    botanical: str = "",
    slug: str = "",
) -> Chunk:
    visible, prices = strip_prices(text)
    ident = f"{kind}:{section}:{plant}:{slug}:{visible[:48]}"
    return Chunk(
        id=ident,
        text=visible,
        section=section,
        plant=plant,
        category=category,
        botanical=botanical,
        kind=kind,
        slug=slug,
        snapshot_prices=prices,
    )


def _first(pattern: re.Pattern[str], text: str) -> str:
    match = pattern.search(text)
    return match.group(1).strip() if match else ""


def chunks_from_catalog(products: list) -> list[Chunk]:
    """Index live names and descriptions. Prices stay out of the text."""
    chunks: list[Chunk] = []
    for product in products:
        status = getattr(product, "status", "active") or "active"
        if status != "active":
            continue
        name = getattr(product, "name", "") or ""
        slug = getattr(product, "slug", "") or ""
        if not name or not slug:
            continue
        tags = ", ".join(getattr(product, "tags", []) or [])
        short = getattr(product, "short_desc", "") or ""
        category = getattr(product, "category", "") or ""
        text = f"{name}. {short} Category: {category}. Tags: {tags}."
        chunks.append(
            _make("Live catalog", text, "catalog", plant=name, category=category, slug=slug)
        )
    return chunks
