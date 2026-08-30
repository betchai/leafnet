"""Tests for ml/src/data/splitting.py — leakage prevention & partition targets."""

from __future__ import annotations

from src.data.splitting import create_grouped_splits


def test_empty_dataset_smoke():
    r = create_grouped_splits([])
    assert r["audit"]["final_counts"] == {}


def test_related_images_stay_in_same_split():
    rows = [
        {"image_id": f"i{i}", "class": "healthy", "leaf_id": f"L{i // 2}"}
        for i in range(20)  # pairs share a leaf -> must not straddle splits
    ]
    out = create_grouped_splits(rows, seed=7)["rows"]
    by_leaf: dict[str, set[str]] = {}
    for r in out:
        by_leaf.setdefault(r["leaf_id"], set()).add(r["split"])
    assert all(len(splits) == 1 for splits in by_leaf.values()), "leakage: leaf split across sets"


def test_partition_approximates_80_10_10():
    rows = [
        {"image_id": f"i{i}", "class": ["healthy", "leaf_rust", "leaf_spot", "leaf_blight"][i % 4]}
        for i in range(2000)
    ]
    audit = create_grouped_splits(rows, seed=42)["audit"]
    counts = audit["final_counts"]
    total = sum(counts.values())
    assert total == 2000
    assert abs(counts["train"] - 1600) <= 8   # grouping causes small rounding drift
    assert abs(counts["validation"] - 200) <= 8
    assert abs(counts["test"] - 200) <= 8


def test_split_is_reproducible_with_seed():
    rows = [{"image_id": str(i), "class": "healthy"} for i in range(50)]
    a = create_grouped_splits(rows, seed=99)["rows"]
    b = create_grouped_splits(rows, seed=99)["rows"]
    assert [r["split"] for r in a] == [r["split"] for r in b]


def test_audit_records_fallback_when_no_grouping_metadata():
    r = create_grouped_splits([{"image_id": "x", "class": "healthy"}])
    assert r["audit"]["strategy"].startswith("image_level_random_fallback")
