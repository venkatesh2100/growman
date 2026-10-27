"""Printed money documents: the tax invoice and the words on a quotation.

Prices on the store are GST-inclusive. The invoice extracts the tax that
was already inside the price; it does not add GST again. The PDF is what
the account page downloads, so the response is ``application/pdf``, not JSON.
"""

from __future__ import annotations

from datetime import datetime

_ONES = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

ISSUER = "Sri Shirdi Sai Nursery"
ISSUER_PLACE = "Hyderabad, Telangana"
ISSUER_PHONE = "+91 95535 70568, +91 99089 35044"
QUOTATION_TERMS = [
    "Payment 100% Before Dispatch.",
    "Transport & loading/unloading charges as quoted above.",
    "Goods once sold cannot be taken back.",
]


def round_money(value: float) -> float:
    return round(float(value) + 1e-9, 2)


def _below_100(n: int) -> str:
    if n < 20:
        return _ONES[n]
    if n % 10 == 0:
        return _TENS[n // 10]
    return f"{_TENS[n // 10]} {_ONES[n % 10]}"


def _number_in_words(n: int) -> str:
    """Indian grouping: crore, lakh, thousand. 1,00,000 is one lakh, not one hundred thousand."""
    if n == 0:
        return "Zero"
    parts: list[str] = []
    if n >= 10_000_000:
        parts.append(_number_in_words(n // 10_000_000) + " Crore")
        n %= 10_000_000
    if n >= 100_000:
        parts.append(_below_100(n // 100_000) + " Lakh")
        n %= 100_000
    if n >= 1000:
        parts.append(_below_100(n // 1000) + " Thousand")
        n %= 1000
    if n >= 100:
        parts.append(_ONES[n // 100] + " Hundred")
        n %= 100
    if n:
        if parts:
            parts.append("and")
        parts.append(_below_100(n))
    return " ".join(parts)


def rupees_in_words(amount: float) -> str:
    amount = round_money(amount)
    whole = int(amount)
    paise = int(round((amount - whole) * 100))
    text = _number_in_words(whole) + " Rupees"
    if paise:
        text += " and " + _below_100(paise) + " Paise"
    return text + " only"


def quotation_item_code(product_id: int, size_id: int) -> str:
    """Same code the bulk page prints. Both sides pad to four digits."""
    return f"GM{product_id:04d}{size_id:04d}"


def finalize_quotation(lines: list[dict], charges: list[dict], requester: dict, estimate_no: str, when: datetime, place: str) -> dict:
    goods = 0.0
    units = 0
    for index, line in enumerate(lines, start=1):
        line["no"] = index
        line["amount"] = round_money(line["rate"] * line["quantity"])
        goods += line["amount"]
        units += line["quantity"]
    total = goods
    for charge in charges:
        if charge.get("amount") is not None:
            total += charge["amount"]
    return {
        "estimateNo": estimate_no,
        "date": when.strftime("%d-%m-%Y"),
        "placeOfSupply": place,
        "requester": requester,
        "lines": lines,
        "totalUnits": units,
        "goodsTotal": round_money(goods),
        "charges": charges,
        "total": round_money(total),
        "amountInWords": rupees_in_words(total),
        "description": ["100% Payment Before Dispatch"],
        "terms": list(QUOTATION_TERMS),
        "issuer": ISSUER,
        "issuerAddress": ISSUER_PLACE,
        "issuerPhone": ISSUER_PHONE,
    }


def quotation_email_text(quote: dict) -> str:
    rows = [
        f"Quotation {quote['estimateNo']}  {quote['date']}",
        f"{quote['requester']['name']}  {quote['requester']['phone']}  {quote['requester'].get('email') or ''}",
        quote["placeOfSupply"],
        "",
    ]
    for line in quote["lines"]:
        rows.append(f"{line['no']}. {line['name']} {line.get('size') or ''}  x{line['quantity']}  Rs. {line['amount']:.2f}")
    rows.append("")
    rows.append(f"Goods Rs. {quote['goodsTotal']:.2f}")
    for charge in quote["charges"]:
        amount = "To be quoted" if charge["requested"] and charge["amount"] is None else ("Not required" if not charge["requested"] else f"Rs. {charge['amount']:.2f}")
        rows.append(f"{charge['label']}: {amount}")
    rows.append(f"Total Rs. {quote['total']:.2f}")
    rows.append(quote["amountInWords"])
    return "\n".join(rows)


def render_invoice_pdf(order) -> bytes:
    """A4 tax invoice. The layout is the same information the Go PDF prints."""
    from fpdf import FPDF

    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, "Tax Invoice", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", size=9)
    pdf.cell(0, 5, f"{ISSUER}  |  {ISSUER_PLACE}  |  {ISSUER_PHONE}", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    when = order.invoice_date or order.created_at
    date = when.strftime("%d %b %Y") if when else ""
    meta = [
        ("Invoice No.", order.invoice_number or ""),
        ("Date", date),
        ("Order ID", f"#{order.id}"),
        ("Payment", order.razorpay_payment_id or ""),
    ]
    pdf.set_font("Helvetica", size=10)
    for label, value in meta:
        pdf.cell(40, 6, label)
        pdf.cell(0, 6, str(value), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 6, order.customer_name or "Customer", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", size=10)
    for line in (order.customer_email, order.customer_phone, order.address_line, ", ".join(p for p in (order.city, order.state, order.pincode) if p)):
        if line:
            pdf.cell(0, 5, str(line)[:120], new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    pdf.set_font("Helvetica", "B", 9)
    for title, width in (("#", 10), ("Description", 90), ("Qty", 20), ("Rate", 30), ("Amount", 30)):
        pdf.cell(width, 7, title, border=1)
    pdf.ln(7)
    pdf.set_font("Helvetica", size=9)
    for index, item in enumerate(order.items or [], start=1):
        amount = round_money(item.price * item.quantity)
        pdf.cell(10, 6, str(index), border=1)
        pdf.cell(90, 6, (item.name or "")[:48], border=1)
        pdf.cell(20, 6, str(item.quantity), border=1, align="R")
        pdf.cell(30, 6, f"{item.price:.2f}", border=1, align="R")
        pdf.cell(30, 6, f"{amount:.2f}", border=1, align="R")
        pdf.ln(6)

    pdf.ln(3)
    pdf.set_font("Helvetica", size=10)
    totals = [
        ("Subtotal (GST inclusive)", order.subtotal),
        ("Delivery", order.delivery_fee),
        ("Discount", order.discount_total),
        ("Taxable value", order.taxable_value),
        ("GST extracted", order.tax_amount),
        ("Total paid", order.amount),
    ]
    if order.refunded_amount:
        totals.append(("Refunded", order.refunded_amount))
    for label, value in totals:
        pdf.cell(130, 6, label)
        pdf.cell(40, 6, f"Rs. {float(value or 0):.2f}", align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)
    pdf.set_x(pdf.l_margin)
    pdf.set_font("Helvetica", "I", 9)
    pdf.multi_cell(0, 5, "Prices include GST. Tax shown above is extracted from the line price, not added on top.")
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(0, 5, rupees_in_words(order.amount or 0))
    return bytes(pdf.output())
