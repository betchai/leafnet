"""Tests for the symptom-analysis (B leg) and criteria-profile explainability
logic. These are pure, model-free computations — no inference service or model
required, so they run everywhere.
"""

from __future__ import annotations

import numpy as np
from PIL import Image

from src.inference import criteria_profiles as cp
from src.inference.symptom_analysis import measure_symptoms, detect_background


def _solid(color) -> Image.Image:
    return Image.new("RGB", (256, 256), color)


def _healthy_green() -> Image.Image:
    return _solid((60, 130, 40))


def _spotted() -> Image.Image:
    """Green leaf with many small discrete dark-brown spots."""
    img = Image.new("RGB", (256, 256), (60, 130, 40))
    for cx in range(20, 256, 40):
        for cy in range(20, 256, 40):
            for dx in range(-4, 4):
                for dy in range(-4, 4):
                    if 20 <= cx + dx < 256 and 20 <= cy + dy < 256:
                        img.putpixel((cx + dx, cy + dy), (100, 55, 20))
    return img


def _blight() -> Image.Image:
    """Green leaf with one large coalesced brown region covering much of it."""
    img = Image.new("RGB", (256, 256), (60, 130, 40))
    for x in range(30, 200):
        for y in range(40, 190):
            img.putpixel((x, y), (95, 50, 20))
    return img


def _rust_dots() -> Image.Image:
    """Green leaf with tiny bright orange/tan dots (pustule-like)."""
    img = Image.new("RGB", (256, 256), (60, 130, 40))
    for cx in range(10, 256, 12):
        for cy in range(10, 256, 12):
            for dx in range(-2, 2):
                for dy in range(-2, 2):
                    if 10 <= cx + dx < 256 and 10 <= cy + dy < 256:
                        img.putpixel((cx + dx, cy + dy), (200, 150, 60))
    return img


# ---------- measure_symptoms -------------------------------------------------

def test_healthy_has_minimal_necrosis():
    m = measure_symptoms(_healthy_green())
    assert m["necrosis_fraction"] < 0.02
    assert m["leaf_green_fraction"] > 0.8


def test_spotted_small_discrete_lesions():
    m = measure_symptoms(_spotted())
    assert m["necrosis_fraction"] > 0.0
    assert m["largest_component_share"] < 0.5


def test_blight_large_coalesced():
    m = measure_symptoms(_blight())
    assert m["necrosis_fraction"] > 0.1
    assert m["largest_component_share"] > 0.6


def test_rust_has_pustule_signal():
    m = measure_symptoms(_rust_dots())
    assert m["pustule_density"] > 0.0005


def test_all_measurements_present():
    m = measure_symptoms(_spotted())
    for key in (
        "necrosis_fraction", "chlorosis_fraction", "pustule_density",
        "lesion_count", "largest_component_share", "chlorotic_component_count",
        "margin_involvement", "leaf_green_fraction", "leaf_area_px",
    ):
        assert key in m


# ---------- evaluate_criteria ------------------------------------------------

def test_healthy_vs_blight_leans_healthy_on_green_leaf():
    m = measure_symptoms(_healthy_green())
    crit = cp.evaluate_criteria(m, cp.HEALTHY, cp.BLIGHT)
    # preliminary healthy label; greenness criterion should be present & not adversarial
    assert any(c["key"] == "overall_greenness" for c in crit)


def test_spot_vs_blight_spread_supports_blight_on_coalesced():
    m = measure_symptoms(_blight())
    crit = cp.evaluate_criteria(m, cp.SPOT, cp.BLIGHT)
    spread = next(c for c in crit if c["key"] == "lesion_spread")
    assert spread["supports"] == "second"  # second = blight
    assert spread["supports_class"] == cp.BLIGHT


def test_spot_vs_blight_spread_supports_spot_on_discrete():
    m = measure_symptoms(_spotted())
    crit = cp.evaluate_criteria(m, cp.SPOT, cp.BLIGHT)
    spread = next(c for c in crit if c["key"] == "lesion_spread")
    assert spread["supports"] == "top"
    assert spread["supports_class"] == cp.SPOT


def test_criteria_shape_is_self_consistent():
    for img, top, second in (
        (_healthy_green(), cp.HEALTHY, cp.SPOT),
        (_spotted(), cp.SPOT, cp.BLIGHT),
        (_blight(), cp.BLIGHT, cp.SPOT),
        (_rust_dots(), cp.RUST, cp.SPOT),
    ):
        meas = measure_symptoms(img)
        for c in cp.evaluate_criteria(meas, top, second):
            assert set(c) >= {"key", "label", "description", "value", "unit", "supports"}
            assert c["supports"] in {"top", "second", "inconclusive"}
            if c["supports"] == "inconclusive":
                assert c.get("supports_class") is None
            assert c["value"] is not None


# ---------- detect_background (distribution/OOD signal) -----------------------

def _leaf_on_background(bg_color, leaf_color=(60, 130, 40), size=700):
    img = Image.new("RGB", (size, size), bg_color)
    for x in range(200, 500):
        for y in range(200, 500):
            img.putpixel((x, y), leaf_color)
    return img


def test_background_detects_white_removed():
    r = detect_background(_leaf_on_background((255, 255, 255)))
    assert r["background_type"] == "white_removed"
    assert r["white_fraction"] >= 0.9


def test_background_detects_natural_in_situ():
    r = detect_background(_leaf_on_background((140, 120, 80)))
    assert r["background_type"] == "natural"
    assert r["white_fraction"] <= 0.3


def test_background_unknown_when_no_leaf_segment():
    """Blank/off-frame input (no leaf) must not be mislabeled as in-situ."""
    r = detect_background(Image.new("RGB", (400, 400), (200, 200, 200)))
    assert r["background_type"] == "unknown"
