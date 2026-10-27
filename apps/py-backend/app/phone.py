"""Indian mobile numbers.

Rows were stored in more than one shape over time (10 digits, ``91…``,
``+91…``). Lookups try every variant instead of assuming one.
"""

from __future__ import annotations


def digits_only(value: str) -> str:
    return "".join(ch for ch in value if ch.isdigit())


def ten_digit(value: str) -> str:
    digits = digits_only(value)
    if digits.startswith("91") and len(digits) >= 12:
        digits = digits[-10:]
    if len(digits) == 10 and digits[0] in "6789":
        return digits
    return ""


def lookup_variants(value: str) -> list[str]:
    ten = ten_digit(value)
    if not ten:
        digits = digits_only(value)
        return [digits] if digits else []
    return [ten, "91" + ten, "+91" + ten]


def msg91_mobile(value: str) -> str:
    ten = ten_digit(value)
    return "91" + ten if ten else digits_only(value)
