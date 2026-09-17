"""Ensemble evaluation: fuses per-image probability vectors from N candidate
model reports and scores the fused predictions on the SAME held-out test set.

Validity contract (strictly enforced):
- every model's predictions.csv must cover the exact same test rows (same
  image_id set) so averaging happens inside one test distribution
- true labels must agree across models (same manifest -> always true, but we
  verify instead of assuming)
- only the probabilities are fused (mean); the argmax of the mean is the
  ensemble prediction. Weights are all equal (no tuning against the test set).

Artifacts are written in the same shape as evaluate.py's so the Insights
viewer and acceptance thresholds work unchanged.
"""
from __future__ import annotations

import argparse
import ast
import csv
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    precision_recall_fscore_support,
)

ML_ROOT = Path(__file__).resolve().parents[1]
if str(ML_ROOT) not in __import__("sys").path:
    __import__("sys").path.insert(0, str(ML_ROOT))

from src.evaluation.evaluate import (
    evaluate_acceptance,
    _per_domain_metrics,
    test_set_integrity,
)


def _load_predictions(eval_dir: Path) -> list[dict]:
    rows: list[dict] = []
    with (eval_dir / "predictions.csv").open() as f:
        for raw in csv.DictReader(f):
            raw["probabilities"] = ast.literal_eval(raw["probabilities"])
            rows.append(raw)
    return rows


def _verified_fusion(sets: list[list[dict]], name: str) -> tuple[list[dict], list[str]]:
    """Verify all models predicted the identical test rows, then average the
    per-image probability distributions across models."""
    keys = list(sets[0][0]["probabilities"])
    for other in sets[1:]:
        assert set(other[0]["probabilities"]) == set(keys), "class keys differ across models"
    n = len(sets[0])
    for other in sets:
        assert len(other) == n, f"{name}: prediction row counts differ"
    # same test rows + same labels across every model
    ids0 = [p["image_id"] for p in sets[0]]
    trues0 = [p["true_label"] for p in sets[0]]
    for other in sets:
        assert [p["image_id"] for p in other] == ids0, "image_id order differs across models"
        assert [p["true_label"] for p in other] == trues0, "true labels differ across models"

    fused: list[dict] = []
    for i in range(n):
        prob = {k: 0.0 for k in keys}
        for s in sets:
            for k, v in s[i]["probabilities"].items():
                prob[k] += v / len(sets)
        pred = max(prob, key=prob.get)
        base = dict(sets[0][i])
        ranked = sorted(prob.items(), key=lambda kv: -kv[1])
        base.update({
            "probabilities": {k: round(float(v), 4) for k, v in prob.items()},
            "predicted_label": pred,
            "correct": pred == base["true_label"],
            "confidence": round(float(prob[pred]), 4),
            "second_class": ranked[1][0],
            "second_confidence": round(float(ranked[1][1]), 4),
            "margin": round(float(ranked[0][1] - ranked[1][1]), 4),
            "model_version": name,
            "experiment_id": name,
            "predicted_at": datetime.now(timezone.utc).isoformat(),
        })
        fused.append(base)
    return fused, keys


def evaluate_ensemble(name: str, eval_dirs: list[Path], dataset_version: str,
                      manifest_path: Path, out_root: Path) -> dict:
    integrity_ok, integrity = test_set_integrity(manifest_path)
    if not integrity_ok:
        return {"status": "REFUSED", "integrity": integrity}
    member_names = " + ".join(d.name for d in eval_dirs)
    print(f"[ensemble {name}] members: {member_names}")

    fused, keys = _verified_fusion([_load_predictions(d) for d in eval_dirs], name)
    y_true = [p["true_label"] for p in fused]
    y_pred = [p["predicted_label"] for p in fused]

    acc = float(accuracy_score(y_true, y_pred))
    prec, rec, f1, support = precision_recall_fscore_support(
        y_true, y_pred, labels=keys, zero_division=0)
    macro_p, macro_r, macro_f1 = (
        float(np.mean(prec)), float(np.mean(rec)), float(np.mean(f1)))
    weighted = precision_recall_fscore_support(
        y_true, y_pred, labels=keys, average="weighted", zero_division=0)
    cm = confusion_matrix(y_true, y_pred, labels=keys)

    errors = [p for p in fused if not p["correct"]]
    correct_confs = [p["confidence"] for p in fused if p["correct"]]
    incorrect_confs = [p["confidence"] for p in fused if not p["correct"]]
    high_conf_wrong = [p for p in errors if p["confidence"] >= 0.8]

    domains = _per_domain_metrics(fused, keys)
    no_natural_test = domains.get("natural") is None
    distribution_shift = {
        "domains": domains,
        "reference_domain": "white_removed",
        "ood_domain": "natural",
        "no_domain_test_data": no_natural_test,
        "note": (
            f"Ensemble of {len(eval_dirs)} models ({member_names}), averaged "
            "probabilities, equal weights, evaluated on the shared held-out "
            "test set. Gaps between white_removed and natural accuracy/macro-F1 "
            "indicate mild covariate shift."
        ),
    }

    result = {
        "status": "OK",
        "experiment_id": name,
        "model_version": name,
        "dataset_version": dataset_version,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "integrity": integrity,
        "test_size": len(fused),
        "statistical_warning": (
            f"n={len(fused)} test images (target 200). Metrics are computed "
            "formally but carry no statistical significance at this size."
        ),
        "metrics": {
            "accuracy": round(acc, 4),
            "per_class": {
                keys[i]: {
                    "precision": round(float(prec[i]), 4),
                    "recall": round(float(rec[i]), 4),
                    "f1": round(float(f1[i]), 4),
                    "support": int(support[i]),
                } for i in range(len(keys))
            },
            "macro": {"precision": round(macro_p, 4), "recall": round(macro_r, 4),
                      "f1": round(macro_f1, 4)},
            "weighted": {"precision": round(float(weighted[0]), 4),
                          "recall": round(float(weighted[1]), 4),
                          "f1": round(float(weighted[2]), 4)},
        },
        "confusion_matrix": {
            "columns_predicted": keys,
            "rows_actual": {keys[i]: [int(x) for x in cm[i]] for i in range(len(keys))},
        },
        "confidence_analysis": {
            "mean_confidence_correct": round(float(np.mean(correct_confs)), 4) if correct_confs else None,
            "mean_confidence_incorrect": round(float(np.mean(incorrect_confs)), 4) if incorrect_confs else None,
            "high_confidence_errors_ge_0.8": len(high_conf_wrong),
            "difficult_cases_margin_lt_0.10_or_conf_lt_0.5": len([p for p in fused if p["margin"] < 0.10 or p["confidence"] < 0.5]),
            "calibration_note": "Calibration (ECE/reliability diagram) intentionally NOT computed: requires meaningful test n.",
        },
        "distribution_shift": distribution_shift,
        "_rules_honored": "test set untouched; model weights untouched; averaged probabilities only",
    }
    result["acceptance"] = evaluate_acceptance(result["metrics"], len(fused))

    out = out_root / name
    out.mkdir(parents=True, exist_ok=True)
    (out / "metrics.json").write_text(json.dumps(result, indent=2))
    (out / "distribution_shift.json").write_text(json.dumps(distribution_shift, indent=2))
    (out / "acceptance.json").write_text(json.dumps(result["acceptance"], indent=2))
    with (out / "predictions.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(fused[0].keys()))
        w.writeheader()
        w.writerows(fused)
    with (out / "confusion_matrix.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Actual \\ Predicted"] + keys)
        for i, k in enumerate(keys):
            w.writerow([k] + [int(x) for x in cm[i]])
    with (out / "errors.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["image_id", "true_label", "predicted_label", "confidence",
                    "probabilities", "second_class", "second_confidence"])
        for e in errors:
            w.writerow([e["image_id"], e["true_label"], e["predicted_label"],
                        e["confidence"], json.dumps(e["probabilities"]),
                        e["second_class"], e["second_confidence"]])
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Fuse candidate predictions into an ensemble eval report.")
    ap.add_argument("--name", required=True, help="artifact name, e.g. ENS_V1.0_r2")
    ap.add_argument("--version-label", default="V1.0")
    ap.add_argument("--manifest", default=str(ML_ROOT / "data/prepared/cmtz1x7jz0h05ycmy47mu8lxr_seed42.jsonl"))
    ap.add_argument("model_dirs", nargs="+", help="eval report dirs under reports/evaluation")
    args = ap.parse_args()

    base = ML_ROOT / "reports" / "evaluation"
    dirs = [base / d for d in args.model_dirs]
    missing = [str(d) for d in dirs if not (d / "predictions.csv").exists()]
    if missing:
        raise SystemExit(f"missing predictions.csv in: {missing}")
    res = evaluate_ensemble(args.name, dirs, args.version_label, Path(args.manifest), base)
    print(json.dumps({
        "status": res.get("status"),
        "accuracy": res.get("metrics", {}).get("accuracy"),
        "macro_f1": res.get("metrics", {}).get("macro", {}).get("f1"),
        "test_size": res.get("test_size"),
        "verdict": (res.get("acceptance") or {}).get("verdict"),
    }, indent=2))