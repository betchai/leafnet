"""Tests for scripts/evaluate_ensemble.py — probability fusion + scoring."""

from __future__ import annotations

import csv
import json
from pathlib import Path

from PIL import Image

from scripts.evaluate_ensemble import evaluate_ensemble, _verified_fusion


def _tiny_manifest_rows(tmp_path: Path):
    rows = []
    labels = ["healthy", "leaf_rust", "leaf_spot", "leaf_blight"]
    for i, lab in enumerate(labels):
        p = tmp_path / f"img{i}.jpg"
        Image.new("RGB", (80, 80), (i * 40, 60, 200)).save(p)
        rows.append({
            "image_id": f"img{i}", "path": str(p), "class": lab,
            "split": "test", "sha256": f"zz{i}", "background_type": "white_removed",
            "annotation_status": "APPROVED",
        })
    return rows


def _write_predictions(path: Path, rows: list[dict]):
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        for r in rows:
            w.writerow({**r, "probabilities": repr(r["probabilities"])})


def _pred_row(image_id: str, true_label: str, probs: dict):
    pred = max(probs, key=probs.get)
    ranked = sorted(probs.items(), key=lambda kv: -kv[1])
    return {
        "image_id": image_id, "path": f"/dev/null/{image_id}.jpg", "true_label": true_label,
        "predicted_label": pred, "background_type": "white_removed",
        "correct": pred == true_label, "confidence": probs[pred],
        "probabilities": probs, "second_class": ranked[1][0],
        "second_confidence": ranked[1][1], "margin": ranked[0][1] - ranked[1][1],
        "model_version": "M", "dataset_version": "vT", "experiment_id": "M",
        "predicted_at": "2026-01-01T00:00:00+00:00",
    }


def test_verified_fusion_averages_and_repredicts():
    a = [
        _pred_row("i1", "healthy", {"healthy": 0.9, "leaf_rust": 0.05, "leaf_spot": 0.03, "leaf_blight": 0.02}),
        _pred_row("i2", "leaf_blight", {"healthy": 0.4, "leaf_rust": 0.1, "leaf_spot": 0.1, "leaf_blight": 0.4}),
    ]
    b = [
        _pred_row("i1", "healthy", {"healthy": 0.5, "leaf_rust": 0.3, "leaf_spot": 0.1, "leaf_blight": 0.1}),
        _pred_row("i2", "leaf_blight", {"healthy": 0.1, "leaf_rust": 0.1, "leaf_spot": 0.1, "leaf_blight": 0.7}),
    ]
    fused, keys = _verified_fusion([a, b], "ENS")
    assert keys == ["healthy", "leaf_rust", "leaf_spot", "leaf_blight"]
    # i1: mean healthy = 0.7 -> healthy
    assert fused[0]["predicted_label"] == "healthy" and fused[0]["correct"] is True
    # i2: mean blight = 0.55 -> blight (a alone would have been a tie)
    assert fused[1]["predicted_label"] == "leaf_blight"
    assert fused[1]["margin"] == round(0.55 - 0.25, 4)


def test_evaluate_ensemble_writes_scored_artifacts(tmp_path):
    rows = _tiny_manifest_rows(tmp_path)
    mp = tmp_path / "manifest.jsonl"
    mp.write_text("\n".join(json.dumps(r) for r in rows) + "\n")

    # two members with slightly different errors
    def m1(r):
        p = {"healthy": 0.85, "leaf_rust": 0.05, "leaf_spot": 0.05, "leaf_blight": 0.05}
        p[r["class"]] = 0.85
        for k in p:
            if k != r["class"]:
                p[k] = 0.05
        p["leaf_blight"] = max(0.0, p["leaf_blight"] - 0.2) if r["class"] != "leaf_blight" else p["leaf_blight"] + 0.2
        return _pred_row(r["image_id"], r["class"], {k: round(v, 4) for k, v in p.items()})

    eval_a = tmp_path / "A"
    eval_b = tmp_path / "B"
    eval_a.mkdir(); eval_b.mkdir()
    _write_predictions(eval_a / "predictions.csv", [m1(r) for r in rows])
    # member B is slightly worse on leaf_spot -> ensemble should smooth it
    rows_b = []
    for r in rows:
        p = {"healthy": 0.3, "leaf_rust": 0.2, "leaf_spot": 0.3, "leaf_blight": 0.2}
        p[r["class"]] = 0.75
        for k in p:
            if k != r["class"]:
                p[k] = 0.05 if k != "leaf_spot" else 0.1
        rows_b.append(_pred_row(r["image_id"], r["class"], {k: round(v, 4) for k, v in p.items()}))
    _write_predictions(eval_b / "predictions.csv", rows_b)

    out = tmp_path / "reports"
    res = evaluate_ensemble("ENS_TEST", [eval_a, eval_b], "vT", mp, out)
    assert res["status"] == "OK"
    assert res["test_size"] == 4
    assert res["metrics"]["accuracy"] == 1.0  # the fusion smooths both members' errors
    assert res["acceptance"]["verdict"] == "INCONCLUSIVE"  # n=4 < test_size_min(30)
    assert (out / "ENS_TEST" / "metrics.json").exists()
    assert (out / "ENS_TEST" / "confusion_matrix.csv").exists()
    assert (out / "ENS_TEST" / "predictions.csv").exists()


def test_ensemble_refuses_mismatched_test_rows(tmp_path):
    a = [_pred_row("i1", "healthy", {"healthy": 0.9, "leaf_rust": 0.05, "leaf_spot": 0.03, "leaf_blight": 0.02})]
    b = [_pred_row("i2", "healthy", {"healthy": 0.9, "leaf_rust": 0.05, "leaf_spot": 0.03, "leaf_blight": 0.02})]
    import pytest
    with pytest.raises(AssertionError):
        _verified_fusion([a, b], "ENS")