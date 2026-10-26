"""The only paid model call. Missing key means retrieval and tools only."""

from __future__ import annotations

import re
from typing import Callable

from pydantic import BaseModel, Field

from app.router import ROUTES


class RouteLabel(BaseModel):
    route: str = Field(description="One of the Dootha routes")


def build_synthesizer(api_key: str, model: str):
    if not api_key:
        return None
    from langchain_core.prompts import ChatPromptTemplate
    from langchain_google_genai import ChatGoogleGenerativeAI

    llm = ChatGoogleGenerativeAI(
        model=model,
        google_api_key=api_key,
        temperature=0.2,
        max_output_tokens=350,
    )
    prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                "You are Dootha, Growman's plant assistant for Indian homes. "
                "Answer only from the passages. Do not mention prices, stock, "
                "or rupee amounts. If the passages do not say it, say you are "
                "not sure. At most 110 words. Use markdown. "
                "When the route is medicinal, end with: Consult a qualified "
                "practitioner before using any plant medicinally. This is not medical advice.",
            ),
            ("human", "Route: {route}\n\nQuestion: {question}\n\nPassages:\n{passages}"),
        ]
    )
    chain = prompt | llm

    class LangChainSynthesizer:
        def synthesize(self, message: str, history: list[dict], passages: list[str], route: str, products: list[dict]) -> str:
            del history, products
            result = chain.invoke(
                {
                    "route": route,
                    "question": message,
                    "passages": "\n\n".join(passages)[:6000],
                }
            )
            return getattr(result, "content", str(result)) or ""

    return LangChainSynthesizer()


def build_classifier(api_key: str, model: str) -> Callable[[str], str] | None:
    if not api_key:
        return None
    from langchain_core.prompts import ChatPromptTemplate
    from langchain_google_genai import ChatGoogleGenerativeAI

    llm = ChatGoogleGenerativeAI(
        model=model,
        google_api_key=api_key,
        temperature=0,
        max_output_tokens=40,
    )
    structured = llm.with_structured_output(RouteLabel)
    prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                "Classify a Growman shop question. Reply with one route: "
                "policy, plant_care, product_discovery, medicinal, off_topic, "
                "orders_refused_here. Orders and wishlist are orders_refused_here. "
                "Prices and stock are product_discovery. Delivery, payment, pickup, "
                "returns, bulk, and gifting are policy.",
            ),
            ("human", "{question}"),
        ]
    )
    chain = prompt | structured

    def classify(message: str) -> str:
        label = chain.invoke({"question": message[:500]})
        route = label.route if isinstance(label, RouteLabel) else str(label)
        route = route.strip().lower().replace(" ", "_")
        return route if route in ROUTES else "plant_care"

    return classify


def extract_faq(text: str) -> str:
    match = re.search(r"A:\s*(.+)", text or "", re.DOTALL)
    if not match:
        return (text or "").strip()
    return match.group(1).strip()
