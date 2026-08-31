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


def test_exact_duplicates_under_different_sessions_neversplit():
    """Same sha256 uploaded under different collection sessions must share a split."""
    rows = []
    for i in range(20):
        rows.append({
            "image_id": f"a{i}", "class": "healthy",
            "collection_session_id": f"S{i}", "sha256": f"H{i // 2}",  # dups in pairs
        })
    out = create_grouped_splits(rows, seed=7)["rows"]
    by_hash: dict[str, set[str]] = {}
    for r in out:
        by_hash.setdefault(r["sha256"], set()).add(r["split"])
    assert all(len(splits) == 1 for splits in by_hash.values()), \
        "leakage: identical images split across train/val/test"


def test_audit_reports_duplicate_locked_groups():
    rows = [
        {"image_id": f"i{i}", "class": "healthy",
         "collection_session_id": f"S{i}", "sha256": f"H{i % 3}"}
        for i in range(9)
    ]
    audit = create_grouped_splits(rows, seed=3)["audit"]
    assert audit["duplicate_locked_groups"] == 3
    assert audit["strategy"] == "group_aware_union_find"


def test_ignore_groups_keeps_keys_but_splits_image_level():
    """PILOT mode must NOT delete grouping keys — it only ignores them."""
    rows = [
        {"image_id": f"i{i}", "class": "healthy", "leaf_id": f"L{i % 4}",
         "collection_session_id": f"S{i % 4}"}
        for i in range(160)
    ]
    out = create_grouped_splits(rows, seed=42, ignore_groups=True)["rows"]
    assert all(r.get("leaf_id") for r in out), "group keys must survive a PILOT run"
    from collections import Counter
    counts = Counter(r["split"] for r in out)
    assert counts["train"] and counts["validation"] and counts["test"]


def test_small_class_still_gets_all_three_splits():
    """Regression: 4 collection sessions/class used to yield round(4*0.1)=0
    validation groups -> empty validation -> whole dataset forced to PILOT."""
    rows = [
        {"image_id": f"i{i}", "class": cls, "collection_session_id": f"{cls}_{i // 100}"}
        for cls in ("healthy", "leaf_rust", "leaf_spot", "leaf_blight")
        for i in range(400)  # 4 sessions x 100 images per class
    ]
    res = create_grouped_splits(rows, seed=42)
    assert res["audit"]["strategy"] == "group_aware_union_find"
    counts = res["audit"]["final_counts"]
    assert counts["train"] > 0 and counts["validation"] > 0 and counts["test"] > 0
    by_leaf: dict[str, set[str]] = {}
    for r in res["rows"]:
        by_leaf.setdefault(r["collection_session_id"], set()).add(r["split"])
    assert all(len(s) == 1 for s in by_leaf.values()), "session straddled splits (leakage)"
