"""Route selection stays on rules for the questions Dootha already understands."""

from app.router import rules_route


def test_routes():
    assert rules_route("How do I pay on Growman?") == "policy"
    assert rules_route("How long does delivery take?") == "policy"
    assert rules_route("how much does delivery cost?") == "policy"
    assert rules_route("how much is the snake plant?") == "product_discovery"
    assert rules_route("pet safe plants under 500") == "product_discovery"
    assert rules_route("how often should I water a snake plant?") == "plant_care"
    assert rules_route("in order to water my snake plant, how often?") == "plant_care"
    assert rules_route("where is my parcel?") == "orders_refused_here"
    assert rules_route("what's in my wishlist?") == "orders_refused_here"
    assert rules_route("how do I water tulsi?") == "medicinal"
    assert rules_route("tulsi price") == "product_discovery"
    assert rules_route("hello") == "greeting"
    assert rules_route("the one by the window") is None
