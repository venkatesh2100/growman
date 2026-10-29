"""Input and output checks. These are rules, not a second model call."""

from __future__ import annotations

import re

from app.textutil import content_tokens

MAX_MESSAGE_CHARS = 2P000

DISCLAIMER = (
    "Consult a qualified practitioner before using any plant medicinally. "
    "This is not medical advice."
)

INJECTION_RE = re.compile(
    r"ignore\s+(all\s+|any\s+|previous\s+|prior\s+|above\s+)?(instructions|prompts)"
    r"|system prompt|developer message|jailbreak"
    r"|reveal\s+(your|the)\s+(prompt|instructions)"
    r"|\bapi[_ ]?key\b"
    r"|you are now",
    re.IGNORECASE,
)

DOSAGE_RE = re.compile(
    r"\b("
    r"dosage|doses?"
    r"|how much (?:should|can|do) i (?:eat|drink|take|consume)"
    r"|cure|cures|treat my|treatment for|medicine for"
    r"|will this (?:cure|heal|fix)"
    r"|kidney stone"
    r")\b",
    re.IGNORECASE,
)

OFF_TOPIC_RE = re.compile(
    r"\b("
    r"cricket|football|election|bitcoin|crypto|stock market|celebrity"
    r"|write (?:me )?a (?:poem|essay|code)|python script|javascript"
    r"|movie|politics"
    r")\b",
    re.IGNORECASE,
)

NURSERY_RE = re.compile(
    r"\b("
    r"plant|leaf|water|soil|pot|sun|light|grow|garden|nursery|deliver"
    r"|order|tulsi|aloe|palm|bonsai|flower|tree|fertil|pest|balcony|monsoon"
    r")\b",
    re.IGNORECASE,
)

RUPEE_RE = re.compile(
    r"(?:₹|Rs\.?|INR|rupees?)\s*([\d,]+(?:\.\d+)?)",
    re.IGNORECASE,
)

ORDERS_REPLY = (
    "Please **log in** and ask again about your orders or wishlist. "
    "I can't see your account from here."
)
OFF_TOPIC_REPLY = (
    "I'm Dootha, Growman's plant assistant. I can help with plant care, "
    "the catalog, delivery, and orders."
)
INJECTION_REPLY = "I can only help with Growman plants, care, and shopping."
MEDICAL_REPLY = (
    "I can help with how to grow this plant, but I can't give medical advice "
    f"or a dosage. {DISCLAIMER}"
)
ABSTAIN_REPLY = (
    "I'm not sure from Growman's guides. Try asking about watering, light, "
    "a specific plant, or how delivery works."
)
GREETING_REPLY = (
    "I'm **Dootha**, Growman's plant assistant. Ask me about watering, light, "
    "a plant in the shop, or how delivery and pickup work."
)
NO_PRICE_REPLY = (
    "I can't confirm a live Growman price or stock for that. "
    "Open the shop on growman.live, or tell me the plant name again."
)


def inspect_input(message: str) -> tuple[str, str]:
    """Return (route, refusal). Refusal is empty when the question may continue."""
    text = (message or "").strip()
    if not text:
        return "off_topic", "Ask me about a plant, its care, or an order."
    if len(text) > MAX_MESSAGE_CHARS:
        return "off_topic", "That message is too long. Ask one plant or order question."
    if INJECTION_RE.search(text):
        return "injection", INJECTION_REPLY
    if DOSAGE_RE.search(text):
        return "medicinal_refusal", MEDICAL_REPLY
    if OFF_TOPIC_RE.search(text) and not NURSERY_RE.search(text):
        return "off_topic", OFF_TOPIC_REPLY
    return "", ""


def normalize_amount(raw: str) -> str:
    cleaned = raw.replace(",", "").strip()
    if not cleaned:
        return ""
    try:
        value = float(cleaned)
    except ValueError:
        return ""
    if value == int(value):
        return str(int(value))
    return f"{value:.2f}".rstrip("0").rstrip(".")


def allowed_amounts(products: list[dict]) -> set[str]:
    allowed: set[str] = set()
    for product in products:
        for key in ("price", "mrp"):
            allowed.add(normalize_amount(str(product.get(key) or "")))
        for size in product.get("sizes") or []:
            allowed.add(normalize_amount(str(size.get("price") or "")))
    allowed.discard("")
    return allowed


def scrub_prices(text: str, products: list[dict]) -> str:
    """Drop any rupee amount that was not in this turn's live catalog payload."""
    allowed = allowed_amounts(products)

    def repl(match: re.Match[str]) -> str:
        if normalize_amount(match.group(1)) in allowed:
            return match.group(0)
        return ""

    cleaned = RUPEE_RE.sub(repl, text or "")
    cleaned = re.sub(r"\(\s*\)", "", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r" +([.,])", r"\1", cleaned)
    return cleaned.strip()


def ensure_disclaimer(text: str) -> str:
    lowered = (text or "").lower()
    if "not medical advice" in lowered or "qualified practitioner" in lowered:
        return text
    body = (text or "").rstrip()
    if not body:
        return DISCLAIMER
    return f"{body}\n\n{DISCLAIMER}"


def has_support(query: str, hits: list[dict], minimum: float = 0.2) -> bool:
    if not content_tokens(query):
        return False
    if not hits:
        return False
    from app.textutil import support

    return max(support(query, hit.get("text") or "") for hit in hits) >= minimum
