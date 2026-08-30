"""Tests for manifest generation and statistics (DEV FIXTURES only)."""

from __future__ import annotations

import json

from src.data.manifest import read_manifest, write_manifest, manifest_hash
from src.data.statistics import compute_statistics


def test_manifest_roundtrip(tmp_path):
    rows = [
        {
            "image_id": "img_1",
            "path": "/dev/null/DEVFIX_a.jpg",
            "source": "dev_fixture",
            "license": "CC0",
            "class": "healthy",
            "severity": 1,
            "plant_id": "p1",
            "leaf_id": None,
            "farm_id": None,
            "collection_session_id": "s1",
            "split": "train",
            "annotation_status": "APPROVED",
            "review_status": "final_verified",
            "dataset_version": "v0.test",
        }
    ]
    out = tmp_path / "manifest.jsonl"
    h1 = write_manifest(rows, out)
    assert read_manifest(out)[0]["class"] == "healthy"
    # reproducible: same content -> same hash
    h2 = write_manifest(rows, out)
    assert h1 == h2
    assert h1 == manifest_hash(out)


def test_manifest_is_jsonl_one_object_per_line(tmp_path):
    rows = [{"image_id": str(i)} for i in range(3)]
    out = tmp_path / "m.jsonl"
    write_manifest(rows, out)
    lines = out.read_text().strip().split("\n")
    assert len(lines) == 3
    assert all(json.loads(l)["image_id"] == str(i) for i, l in enumerate(lines))


def test_statistics_on_empty_manifest(tmp_path):
    s = compute_statistics(tmp_path / "missing.jsonl")
    assert s["total_images"] == 0
    assert s["images_per_class"] == {}
    assert all(v["actual"] == 0 for v in s["imbalance_vs_target"].values())


def test_statistics_counts_and_imbalance(fixture_dir, tmp_path):
    rows = [
        {"path": str(fixture_dir / "DEVFIX_green_a.jpg"), "class": "healthy"},
        {"path": str(fixture_dir / "DEVFIX_spotted.jpg"), "class": "leaf_spot"},
    ]
    mp = tmp_path / "m.jsonl"
    write_manifest(rows, mp)
    s = compute_statistics(mp)
    assert s["total_images"] == 2
    assert s["images_per_class"] == {"healthy": 1, "leaf_spot": 1}
    assert s["dimensions"]["count_measured"] == 2
    assert s["imbalance_vs_target"]["healthy"]["delta"] == -499
