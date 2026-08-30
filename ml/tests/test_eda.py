"""Tests for Phase 4 EDA analysis functions (DEV FIXTURES only)."""

from __future__ import annotations

from src.analysis.eda import (
    class_distribution,
    duplicate_groups,
    leakage_candidates,
    metadata_completeness,
    quality_metrics,
    technical_characteristics,
)


def test_technical_characteristics(fixture_dir):
    t = technical_characteristics(fixture_dir / "DEVFIX_green_a.jpg")
    assert t["width"] == 900 and t["height"] == 900
    assert t["aspect_ratio"] == 1.0
    assert t["format"] == "jpeg"
    assert t["mode"] == "RGB"
    assert technical_characteristics(fixture_dir / "DEVFIX_corrupt.jpg") is None


def test_quality_metrics_flag_extremes(tmp_path):
    from PIL import Image
    import numpy as np

    dark = Image.fromarray(np.zeros((100, 100), dtype=np.uint8))
    p = tmp_path / "dark.jpg"
    dark.save(p)
    q = quality_metrics(p)
    assert "severely_dark" in q["flags"]
    assert "low_contrast" in q["flags"]

    normal = Image.fromarray(np.full((100, 100), 128, dtype=np.uint8))
    p2 = tmp_path / "normal.jpg"
    normal.save(p2)
    # uniform image: low contrast flagged, but not dark/overexposed
    q2 = quality_metrics(p2)
    assert "severely_dark" not in q2["flags"]


def test_metadata_completeness_distinguishes_required_optional():
    rows = [
        {"source": "field", "license": None, "cultivar": "V1"},
        {"source": "field", "license": "CC0", "cultivar": None},
    ]
    comp = {c["field"]: c for c in metadata_completeness(rows)}
    assert comp["source"]["kind"] == "required"
    assert comp["source"]["pct_complete"] == 100.0
    assert comp["license"]["missing"] == 1
    assert comp["cultivar"]["kind"] == "optional"  # optional missingness is not an error
    assert comp["leaf_age"]["pct_complete"] == 0.0


def test_duplicate_groups():
    rows = [
        {"id": "a", "sha256": "X"},
        {"id": "b", "sha256": "X"},
        {"id": "c", "sha256": "Y"},
    ]
    groups = duplicate_groups(rows)
    assert len(groups) == 1
    assert set(groups[0]["image_ids"]) == {"a", "b"}


def test_leakage_candidates_reports_group_sizes():
    rows = [
        {"plant_id": "P1"}, {"plant_id": "P1"}, {"plant_id": "P2"},
        {"leaf_id": "L9"},
    ]
    leak = leakage_candidates(rows)
    assert leak["plant_id"]["num_groups"] == 2
    assert leak["plant_id"]["max_images_in_one_group"] == 2
    assert leak["plant_id"]["multi_image_groups"] == 1


def test_class_distribution_percentages_and_unlabeled():
    rows = [
        {"class": "healthy", "annotation_status": "APPROVED"},
        {"class": "healthy", "annotation_status": "ANNOTATED"},
        {"class": "leaf_spot", "annotation_status": "APPROVED"},
        {"class": None, "annotation_status": "UNLABELED"},
    ]
    d = class_distribution(rows)
    assert d["total"] == 4
    assert d["per_class"]["healthy"]["count"] == 2
    assert d["per_class"]["healthy"]["by_status"]["APPROVED"] == 1
    assert d["unlabeled_or_unclassified"] == 1
    assert d["per_class"]["leaf_blight"]["count"] == 0


def test_all_functions_zero_safe():
    assert class_distribution([])["total"] == 0
    assert duplicate_groups([]) == []
    assert all(c["populated"] == 0 for c in metadata_completeness([{}]))
