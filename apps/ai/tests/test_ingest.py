"""Chunking keeps snapshot prices out of the text a model can read."""

import re
from pathlib import Path

from app.ingest import load_corpus, strip_prices

CORPUS = Path(__file__).resolve().parents[1] / "corpus" / "growman.txt"
RUPEE = re.compile(r"(?:₹|Rs\.?|INR)\s*\d", re.IGNORECASE)


def test_snapshot_prices_leave_the_model_text():
    visible, found = strip_prices(
        "Growman price (snapshot 4 Oct 2026): Rs 600 (original Rs 1,200). Size label: 6\"."
    )
    assert found
    assert not RUPEE.search(visible)
    assert "6" in visible


def test_corpus_has_no_rupee_amounts_and_drops_the_price_index():
    chunks = load_corpus(CORPUS)
    assert len(chunks) > 40
    assert not any("PRICE INDEX" in chunk.section.upper() for chunk in chunks)
    for chunk in chunks:
        assert not RUPEE.search(chunk.text), chunk.id

    snake = [chunk for chunk in chunks if "snake plant" in chunk.plant.lower()]
    assert snake
    assert snake[0].snapshot_prices
    assert "dracaena" in snake[0].botanical.lower()

    pay = [chunk for chunk in chunks if chunk.kind == "faq" and "pay on growman" in chunk.text.lower()]
    assert pay
    assert "razorpay" in pay[0].text.lower()
