"""LangGraph: guard, route, retrieve, ground with the catalog, then check the reply."""

from __future__ import annotations

from typing import TypedDict

from langgraph.graph import END, StateGraph

from app.answers import compose, finish, matching_care_products, select_products
from app.guards import inspect_input
from app.router import rules_route


class AnswerState(TypedDict, total=False):
    message: str
    history: list[dict]
    route: str
    hits: list[dict]
    products: list[dict]
    response: str
    used_llm: bool
    product_slugs: list[str]
    citations: list[dict]


class DoothaGraph:
    def __init__(self, index, catalog, synthesizer=None, classifier=None) -> None:
        self.index = index
        self.catalog = catalog
        self.synthesizer = synthesizer
        self.classifier = classifier
        self.graph = self._compile()

    def _compile(self):
        builder = StateGraph(AnswerState)
        builder.add_node("guard", self._guard)
        builder.add_node("route", self._route)
        builder.add_node("retrieve", self._retrieve)
        builder.add_node("ground", self._ground)
        builder.add_node("compose", self._compose)
        builder.add_node("output_guard", self._output_guard)
        builder.set_entry_point("guard")
        builder.add_conditional_edges(
            "guard",
            lambda state: "output_guard" if state.get("response") else "route",
            {"output_guard": "output_guard", "route": "route"},
        )
        builder.add_conditional_edges(
            "route",
            self._after_route,
            {"compose": "compose", "retrieve": "retrieve"},
        )
        builder.add_edge("retrieve", "ground")
        builder.add_edge("ground", "compose")
        builder.add_edge("compose", "output_guard")
        builder.add_edge("output_guard", END)
        return builder.compile()

    def invoke(self, message: str, history: list[dict] | None = None) -> dict:
        state = self.graph.invoke(
            {
                "message": message,
                "history": history or [],
                "route": "",
                "hits": [],
                "products": [],
                "response": "",
                "used_llm": False,
                "product_slugs": [],
                "citations": [],
            }
        )
        return state

    def _guard(self, state: AnswerState) -> dict:
        route, refusal = inspect_input(state.get("message") or "")
        if refusal:
            return {"route": route, "response": refusal, "used_llm": False}
        return {}

    def _route(self, state: AnswerState) -> dict:
        route = rules_route(state.get("message") or "")
        if route is None and self.classifier is not None:
            try:
                route = self.classifier(state.get("message") or "")
            except Exception:
                route = None
        if route is None:
            route = "plant_care"
        return {"route": route}

    def _after_route(self, state: AnswerState) -> str:
        if state.get("route") in {"greeting", "orders_refused_here", "off_topic"}:
            return "compose"
        return "retrieve"

    def _retrieve(self, state: AnswerState) -> dict:
        chunks = self.index.retrieve(state.get("message") or "", top_n=4, pool=20)
        hits = [chunk.as_dict() for chunk in chunks]
        citations = [
            {"section": hit.get("section") or "", "plant": hit.get("plant") or "", "kind": hit.get("kind") or ""}
            for hit in hits
        ]
        return {"hits": hits, "citations": citations}

    def _ground(self, state: AnswerState) -> dict:
        route = state.get("route") or ""
        hits = state.get("hits") or []
        if route == "product_discovery":
            products = [product.as_dict() for product in select_products(state.get("message") or "", self.catalog, hits)]
            return {"products": products}
        if route in {"plant_care", "medicinal"}:
            return {"products": matching_care_products(state.get("message") or "", hits, self.catalog)}
        return {"products": []}

    def _compose(self, state: AnswerState) -> dict:
        if state.get("response"):
            return {}
        text, used_llm, route = compose(
            state.get("message") or "",
            state.get("route") or "",
            state.get("hits") or [],
            state.get("products") or [],
            self.synthesizer,
        )
        return {"response": text, "used_llm": used_llm, "route": route}

    def _output_guard(self, state: AnswerState) -> dict:
        text, slugs = finish(
            state.get("response") or "",
            state.get("route") or "",
            state.get("products") or [],
        )
        return {"response": text, "product_slugs": slugs}
