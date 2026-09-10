"""Phase 6 evaluation-pipeline tests (DEV FIXTURES / synthetic data only)."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
import torch
from PIL import Image

import src.evaluation.evaluate as ev
from src.training.model import create_mobilenetv2, save_checkpoint


@pytest.fixture(scope="module")
def trained_tiny_model(tmp_path_factory):
    """A real (tiny) trained checkpoint so evaluation exercises actual weights."""
    dir_ = tmp_path_factory.mktemp("model")
    model, _ = create_mobilenetv2(num_classes=4, freeze_backbone=True)
    save_checkpoint(dir_ / "model_best.pt", model, None, None,
                    epoch=1, best_val_metric=0.0, config={},
                    dataset_version="vTEST", class_mapping={
                        "healthy": 0, "leaf_rust": 1, "leaf_spot": 2, "leaf_blight": 3})
    return dir_


def _make_test_manifest(fixture_dir, tmp_path):
    rows = []
    labels = ["healthy", "leaf_spot", "leaf_blight"]
    imgs = [fixture_dir / n for n in ("DEVFIX_green_a.jpg", "DEVFIX_spotted.jpg")]
    for i, lab in enumerate(labels):
        p = tmp_path / f"t{i}.jpg"
        p.write_bytes(imgs[i % 2].read_bytes())
        rows.append({"image_id": f"x{i}", "path": str(p), "class": lab,
                     "sha256": f"s{i}", "split": "test",
                     "annotation_status": "APPROVED"})
    # one train row with DISTINCT bytes (so no cross-split duplication)
    tr_img = Image.open(imgs[0]).copy()
    tr_img.putpixel((0, 0), (1, 2, 3))
    tr = tmp_path / "train.jpg"
    tr_img.save(tr, "JPEG")
    rows.append({"image_id": "tr0", "path": str(tr), "class": "healthy",
                 "sha256": "tr", "split": "train", "annotation_status": "APPROVED"})
    mp = tmp_path / "m.jsonl"
    mp.write_text("\n".join(json.dumps(r) for r in rows))
    return mp, rows


def test_integrity_detects_cross_split_duplicate_leakage(fixture_dir, tmp_path):
    mp, _ = _make_test_manifest(fixture_dir, tmp_path)
    rows = [json.loads(l) for l in mp.read_text().splitlines()]
    # make a test image BYTE-IDENTICAL to the train image -> must be flagged
    dup = tmp_path / "dup.jpg"
    dup.write_bytes(Path(rows[-1]["path"]).read_bytes())  # copy of train.jpg bytes
    rows[0]["path"] = str(dup)
    mp.write_text("\n".join(json.dumps(r) for r in rows))

    ok, report = ev.test_set_integrity(mp)
    assert not ok
    assert any("LEAKAGE" in p for p in report["problems"])


def test_evaluation_produces_consistent_records_and_metrics(fixture_dir, tmp_path):
    from src.training.data import load_class_mapping

    mp, rows = _make_test_manifest(fixture_dir, tmp_path)
    model_dir = trained_tiny_model.__wrapped__(tmp_path_factory=None) if False else _trained(tmp_path)
    result = ev.evaluate_candidate("EXP-T", model_dir, mp, "vTEST",
                                out_root=tmp_path / "reports")
    assert result["status"] != "REFUSED"

    preds = list(csv_reader(tmp_path / "reports" / "trained" / "predictions.csv"))
    assert len(preds) == 3  # one prediction record per test image — no more, no less
    required = {"image_id", "true_label", "predicted_label", "correct",
                "confidence", "probabilities", "model_version", "dataset_version"}
    assert required <= set(preds[0].keys())

    # confusion matrix is 4x4 and sums to the number of test images
    cm_lines = (tmp_path / "reports" / "trained" / "confusion_matrix.csv").read_text().strip().split("\n")
    matrix = [[int(x) for x in line.split(",")[1:]] for line in cm_lines[1:]]
    assert len(matrix) == 4 and all(len(r) == 4 for r in matrix)
    assert sum(sum(r) for r in matrix) == 3

    # metric internal consistency: accuracy == correct predictions / total
    acc_from_preds = sum(1 for p in preds if p["correct"] == "True") / len(preds)
    assert abs(result["metrics"]["accuracy"] - acc_from_preds) < 1e-3  # metrics rounded to 4dp

    # every class appears exactly once as ground truth per image (single-label)
    true_labels = [p["true_label"] for p in preds]
    assert all(t in load_class_mapping() for t in true_labels)

    # objective acceptance verdict is recorded and persisted: test n=3 < 30 ->
    # INCONCLUSIVE, and the artifact lands next to metrics.json
    assert result["acceptance"]["verdict"] == "INCONCLUSIVE"
    assert result["acceptance"]["sufficient_evidence"] is False
    assert result["acceptance"]["advisory"] is True
    assert (tmp_path / "reports" / "trained" / "acceptance.json").exists()


def _trained(tmp_path: Path) -> Path:
    d = tmp_path / "trained"
    d.mkdir(exist_ok=True)
    model, _ = create_mobilenetv2(num_classes=4, freeze_backbone=True)
    save_checkpoint(d / "model_best.pt", model, None, None, 1, 0.0, {},
                    "vTEST", {"healthy": 0, "leaf_rust": 1, "leaf_spot": 2, "leaf_blight": 3})
    return d


def csv_reader(path: Path):
    import csv
    with path.open() as f:
        return list(csv.DictReader(f))


def test_evaluation_refuses_on_integrity_failure(tmp_path):
    empty = tmp_path / "empty.jsonl"
    empty.write_text("")
    ok, report = ev.test_set_integrity(empty)
    assert not ok and "no test rows" in report["problems"][0]


def test_distribution_shift_reported_per_domain(fixture_dir, tmp_path):
    """Distribution-shift eval: manifest rows tagged by background_type produce
    per-domain metrics and an honest no_domain_test_data flag."""
    mp, _ = _make_test_manifest(fixture_dir, tmp_path)
    rows = [json.loads(l) for l in mp.read_text().splitlines()]
    # tag: 2 white_removed test rows + 1 natural test row
    for r in rows:
        r["background_type"] = "natural" if r["image_id"] == "x2" else "white_removed"
    mp.write_text("\n".join(json.dumps(r) for r in rows))

    model_dir = _trained(tmp_path)
    result = ev.evaluate_candidate("EXP-T", model_dir, mp, "vTEST",
                                   out_root=tmp_path / "reports2")
    ds = result["distribution_shift"]
    assert ds["no_domain_test_data"] is False
    assert ds["domains"]["white_removed"]["support"] == 2
    assert ds["domains"]["natural"]["support"] == 1
    assert ds["domains"]["natural"]["accuracy"] is not None
    assert "per_class_f1" in ds["domains"]["natural"]
    shift = (tmp_path / "reports2" / "trained" / "distribution_shift.json")
    assert shift.exists()


def test_distribution_shift_no_natural_domain():
    """No natural-background rows -> _per_domain_metrics returns no 'natural'
    domain, so callers can emit no_domain_test_data=True."""
    rows = [
        {"true_label": "healthy", "predicted_label": "healthy", "background_type": "white_removed"},
        {"true_label": "leaf_spot", "predicted_label": "leaf_spot", "background_type": "white_removed"},
    ]
    domains = ev._per_domain_metrics(rows, ["healthy", "leaf_spot", "leaf_blight", "leaf_rust"])
    assert "natural" not in domains
    assert "white_removed" in domains
    assert domains["white_removed"]["support"] == 2
    assert domains["white_removed"]["accuracy"] == 1.0
