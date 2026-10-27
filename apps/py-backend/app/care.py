"""Indian seasons for the care screen. No database: the month is enough."""

from __future__ import annotations

from datetime import datetime


def advice(when: datetime | None = None) -> dict:
    month = (when or datetime.now()).month
    if month in (12, 1, 2):
        return {
            "season": "winter",
            "title": "Winter care",
            "summary": "Growth slows and pots stay damp longer. Water less often and hold off heavy feeding.",
            "wateringNote": "Many indoor pots only need water every 7–10 days. Check the soil first.",
            "fertilizingNote": "Feed lightly, or skip fertilizing until new growth starts.",
            "tasks": [
                "Move balcony plants away from cold night wind.",
                "Water in the morning so foliage dries before evening.",
            ],
        }
    if month in (3, 4, 5):
        return {
            "season": "summer",
            "title": "Summer care",
            "summary": "Heat pulls moisture out of pots quickly. Shade midday sun and water by checking the soil.",
            "wateringNote": "Check pots every two or three days. Water when the top few centimetres are dry.",
            "fertilizingNote": "A light feed every 3–4 weeks is enough. Do not feed a heat-stressed plant.",
            "tasks": [
                "Shift pots back from west-facing glass in the afternoon.",
                "Keep plants out of the direct blast of an AC vent.",
            ],
        }
    if month in (6, 7, 8, 9):
        return {
            "season": "monsoon",
            "title": "Monsoon care",
            "summary": "Soil dries slowly. The summer watering habit is the fastest way to rot roots now.",
            "wateringNote": "Wait until the top of the soil is dry. Outdoor pots may not need water for a week after rain.",
            "fertilizingNote": "Pause fertilizing while the soil stays wet.",
            "tasks": [
                "Tip excess water out of saucers.",
                "Watch for yellowing from wet roots.",
            ],
        }
    return {
        "season": "post_monsoon",
        "title": "Post-monsoon care",
        "summary": "This is the easiest growing stretch. Resume feeding and repot anything that outgrew its pot in the rains.",
        "wateringNote": "Return to watering when the top of the soil dries, a little less often than in May.",
        "fertilizingNote": "Resume a light monthly feed as new growth shows.",
        "tasks": [
            "Repot root-bound plants one size up.",
            "Check for pests that thrived in the humidity.",
        ],
    }
