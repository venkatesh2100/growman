"""Rule router. A model classifier runs only when every rule declines."""

from __future__ import annotations

import re

PLANT_CARE_ORDER_RE = re.compile(r"in order to|order of (water|fertil|repot)", re.IGNORECASE)

GREETING_RE = re.compile(
    r"^(hi|hello|hey|help|thanks|thank you|good morning|good evening)[.!?\s]*$",
    re.IGNORECASE,
)

ORDER_RE = re.compile(
    r"\b("
    r"wishlist|wish list|my orders?|order status|order history|track(?:ing)?(?: my)?"
    r"|where is my|refund my|cancel my order|shipment|parcel"
    r"|saved items|favourites|favorites"
    r")\b",
    re.IGNORECASE,
)

PRODUCT_RE = re.compile(
    r"\b(price|prices|cost|costs|stock|sold out|in stock|buy|cheapest|expensive|mrp|discount|for sale)\b"
    r"|(?:under|below|less than|up to)\s*(?:rs\.?|₹|inr)?\s*\d+",
    re.IGNORECASE,
)

HOW_MUCH_CARE_RE = re.compile(r"\b(water|light|sun|soil|fertil|grow)\b", re.IGNORECASE)

POLICY_RE = re.compile(
    r"\b("
    r"pay|payment|upi|razorpay|netbanking|pickup|pick up|damaged|bulk|gstin|quotation"
    r"|whatsapp|opening hours|delivery|deliver|shipping|gifting|pincode|guest checkout"
    r"|delete my account"
    r")\b",
    re.IGNORECASE,
)

MEDICINAL_RE = re.compile(
    r"\b(tulsi|aloe|patharchatta|panfuti|bryophyllum|kalanchoe|ghritkumari|betel|paan leaf|maghai)\b",
    re.IGNORECASE,
)

CARE_RE = re.compile(
    r"\b("
    r"water|light|sun|shade|soil|repot|fertil|yellow|brown|leaf|pest|bug|monsoon"
    r"|balcony|prune|wilt|rot|indoor|outdoor|humid"
    r")\b",
    re.IGNORECASE,
)

COMPARISON_RE = re.compile(r"\b(vs\.?|versus|compare|difference between)\b", re.IGNORECASE)

ROUTES = {
    "greeting",
    "orders_refused_here",
    "product_discovery",
    "medicinal",
    "policy",
    "plant_care",
    "off_topic",
    "medicinal_refusal",
    "injection",
}


def rules_route(message: str) -> str | None:
    text = (message or "").strip()
    if not text:
        return "off_topic"
    if GREETING_RE.match(text):
        return "greeting"
    if not PLANT_CARE_ORDER_RE.search(text) and ORDER_RE.search(text):
        return "orders_refused_here"
    # "How much is delivery?" is a help-center question. "Snake plant price"
    # is not, even if the sentence also mentions delivery.
    if POLICY_RE.search(text):
        priced = re.search(r"\b(price|cost|stock|buy|mrp|cheapest)\b", text, re.IGNORECASE)
        names_a_plant = re.search(
            r"\b(plant|tree|palm|tulsi|aloe|bonsai|fern|jasmine)\b",
            text,
            re.IGNORECASE,
        )
        if not (priced and names_a_plant):
            return "policy"
    if _is_product(text):
        return "product_discovery"
    if MEDICINAL_RE.search(text):
        return "medicinal"
    if CARE_RE.search(text):
        return "plant_care"
    return None


def _is_product(text: str) -> bool:
    if re.search(r"how much", text, re.IGNORECASE) and HOW_MUCH_CARE_RE.search(text):
        return bool(re.search(r"\b(price|cost|stock|buy|mrp)\b", text, re.IGNORECASE))
    if re.search(r"how much", text, re.IGNORECASE):
        return True
    return bool(PRODUCT_RE.search(text))


def is_comparison(message: str) -> bool:
    return bool(COMPARISON_RE.search(message or ""))
