"""Tests for ml/src/data/validation.py using DEV FIXTURES only."""

from __future__ import annotations

from src.data.validation import validate_directory, validate_image


def test_valid_fixture_passes(fixture_dir):
    r = validate_image(fixture_dir / "DEVFIX_green_a.jpg", (400, 400))
    assert r["verdict"] == "acceptable"
    assert r["width"] == 900


def test_corrupt_file_is_rejected_not_deleted(fixture_dir):
    r = validate_image(fixture_dir / "DEVFIX_corrupt.jpg", (100, 100))
    assert r["verdict"] == "rejected"
    assert any(i.startswith("unreadable") for i in r["issues"])
    # original preserved
    assert (fixture_dir / "DEVFIX_corrupt.jpg").exists()


def test_unsupported_format_rejected(fixture_dir):
    p = fixture_dir / "file.bmp"
    p.write_bytes(b"bm")
    r = validate_image(p, (10, 10))
    assert any("unsupported_format" in i for i in r["issues"])


def test_below_min_resolution_rejected(tmp_path):
    from PIL import Image

    small = tmp_path / "tiny.jpg"
    Image.new("RGB", (64, 64)).save(small)
    r = validate_image(small, (800, 800))
    assert r["verdict"] == "rejected"


def test_directory_summary_counts(fixture_dir):
    summary = validate_directory(fixture_dir)
    assert summary["total_files"] >= 4
    assert summary["rejected"] >= 1  # corrupt file
    assert summary["acceptable"] + summary["questionable"] + summary["rejected"] == summary[
        "total_files"
    ]


def test_empty_directory_reports_zeros(tmp_path):
    empty = tmp_path / "empty"
    empty.mkdir()
    s = validate_directory(empty)
    assert s["total_files"] == 0
    assert s["acceptable"] == 0  # honest zeros, never fabricated
