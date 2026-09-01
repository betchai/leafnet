"""Insights analytics engine (Phase 9).

Pure functions over evaluation artifacts + dataset records. Every insight is
traceable to its source; nothing is fabricated. Language rules follow the
Phase-9 distinction: observed fact / statistical finding / possible explanation.

Zero-data safe: every builder returns honest empty/insufficient states.
"""

from __future__ import annotations

import csv
import json
import csv
import json
from collections import Counter
from pathlib import Path

TARGET_PER_CLASS = 500
TARGET_TEST = 200


# ---------- dataset insights ----------

def dataset_insights(rows: list[dict]) -> dict:
    """rows: prepared-manifest rows (approved research images with splits)."""
    total = len(rows)
    per_class = Counter(r.get("class") for r in rows)
    per_split: dict[str, Counter] = {}
    for r in rows:
        per_split.setdefault(r.get("split") or "unassigned", Counter())[r.get("class")] += 1

    classes = ["healthy", "leaf_rust", "leaf_spot", "leaf_blight"]
    counts = {c: per_class.get(c, 0) for c in classes}
    present_counts = [v for v in counts.values() if v > 0]
    # largest/smallest computed over PRESENT classes only; absent classes are
    # reported as shortfalls rather than "smallest".
    present = [c for c in classes if counts[c] > 0]
    largest = max(present, key=lambda c: counts[c]) if present else None
    smallest = min(present, key=lambda c: counts[c]) if present else None

    observations = []
    if total == 0:
        observations.append("No approved research images recorded yet.")
    else:
        if largest and smallest and counts[largest] != counts[smallest]:
            observations.append(
                f"Observed fact: {largest} is the largest class ({counts[largest]} images) "
                f"and {smallest} the smallest ({counts[smallest]})."
            )
            ratio = counts[largest] / max(1, counts[smallest])
            if ratio >= 1.5:
                observations.append(
                    f"Statistical finding: class imbalance ratio {ratio:.2f}:1 — "
                    "flagged for investigation (imbalance ≠ bias, but may matter for training)."
                )
        shortfalls = {c: TARGET_PER_CLASS - n for c, n in counts.items() if n < TARGET_PER_CLASS}
        if shortfalls:
            observations.append(
                "Shortfall vs target 500/class: "
                + ", ".join(f"{c} −{d}" for c, d in shortfalls.items())
            )

    return {
        "total_images": total,
        "target": {"total": 4000 // 2, "per_class": TARGET_PER_CLASS},
        "per_class": counts,
        "pct_per_class": {c: round(100 * n / total, 1) if total else 0.0 for c, n in counts.items()},
        "splits": {k: dict(v) for k, v in per_split.items()},
        "largest_class": largest,
        "smallest_class": smallest,
        "imbalance_ratio": (
            round(counts[largest] / max(1, counts[smallest]), 2)
            if present_counts and counts[largest] and counts[smallest] else None
        ),
        "observations": observations,
    }


# ---------- performance insights (from Phase-6 metrics.json) ----------

def performance_insights(metrics: dict) -> dict:
    m = metrics["metrics"]
    pc = m["per_class"]
    best_f1 = max(pc, key=lambda k: pc[k]["f1"])
    worst_f1 = min(pc, key=lambda k: pc[k]["f1"])
    most_sensitive = max(pc, key=lambda k: pc[k]["recall"])
    most_precise = max(pc, key=lambda k: pc[k]["precision"])

    findings = [
        f"Statistical finding: overall test accuracy was {m['accuracy']:.4f} on a test set of "
        f"{metrics['test_size']} image(s).",
        f"Best-performing class by F1: {best_f1} (F1={pc[best_f1]['f1']}).",
        f"Weakest-performing class by F1: {worst_f1} (F1={pc[worst_f1]['f1']}).",
    ]
    if metrics["test_size"] < 30:
        findings.append(
            f"⚠️ Insufficient observations ({metrics['test_size']} < 30) for reliable comparison — "
            "these values must not be quoted as model performance."
        )
    return {
        "model_version": metrics["model_version"],
        "dataset_version": metrics["dataset_version"],
        "test_size": metrics["test_size"],
        "accuracy": m["accuracy"],
        "macro": m["macro"],
        "weighted": m["weighted"],
        "per_class": pc,
        "best_class_by_f1": best_f1,
        "weakest_class_by_f1": worst_f1,
        "most_sensitive_class": most_sensitive,
        "most_precise_class": most_precise,
        "statistical_warning": metrics.get("statistical_warning"),
        "findings": findings,
    }


# ---------- confusion insights ----------

def confusion_insights(metrics: dict) -> dict:
    cm = metrics["confusion_matrix"]
    keys = list(cm["rows_actual"].keys())
    pairs = []
    for actual, row in cm["rows_actual"].items():
        for i, predicted_count in enumerate(row):
            pred = keys[i]
            if actual != pred and predicted_count > 0:
                pairs.append({"actual": actual, "predicted": pred,
                              "count": predicted_count})
    ranked = sorted(pairs, key=lambda p: -p["count"])
    return {
        "matrix_raw": cm,
        "ranked_confusion_pairs": ranked,
        "most_frequent_confusion": ranked[0] if ranked else None,
        "total_misclassified": sum(p["count"] for p in pairs),
        "note": ("Directional: A→B and B→A are distinct confusions. "
                 "No biological cause inferred from confusion alone."),
    }


# ---------- confidence & error insights (from predictions.csv rows) ----------

def confidence_error_insights(predictions: list[dict], threshold_high: float = 0.8,
                              threshold_low: float = 0.5) -> dict:
    errors = [p for p in predictions if str(p.get("correct")).lower() == "false"]
    correct = [p for p in predictions if str(p.get("correct")).lower() == "true"]

    def conf(vals):
        nums = [float(v) for v in vals]
        if not nums:
            return None
        return {"mean": round(sum(nums) / len(nums), 4),
                "min": round(min(nums), 4), "max": round(max(nums), 4)}

    high_conf_errors = [e for e in errors if float(e["confidence"]) >= threshold_high]
    low_conf = [p for p in predictions if float(p["confidence"]) < threshold_low]

    finding = None
    if correct and errors:
        mc, me = float(np_mean([p["confidence"] for p in correct])), float(np_mean([p["confidence"] for p in errors]))
        if mc > me:
            finding = ("Observed model behavior: correct predictions generally exhibited higher "
                       f"confidence (mean {mc:.3f}) than incorrect ones ({me:.3f}).")
        elif me > mc:
            finding = ("Observed model behavior: incorrect predictions did NOT show lower "
                       f"confidence (mean {me:.3f}) than correct ones ({mc:.3f}) — possible overconfidence pattern.")
    elif not predictions:
        finding = "Insufficient data to establish this insight."

    return {
        "total_predictions": len(predictions),
        "total_errors": len(errors),
        "error_pct": round(100 * len(errors) / len(predictions), 2) if predictions else 0.0,
        "errors": errors,
        "high_confidence_errors": high_conf_errors,
        "low_confidence_predictions": len(low_conf),
        "error_rate_low_confidence": round(100 * len([p for p in low_conf if p in errors]) / len(low_conf), 2) if low_conf else None,
        "mean_confidence_correct": conf([p["confidence"] for p in correct]),
        "mean_confidence_incorrect": conf([p["confidence"] for p in errors]),
        "finding": finding or "Insufficient data to establish this insight.",
        "calibration_note": "Calibration has not been formally established; confidence ≠ probability of correctness.",
    }


def np_mean(vals):
    try:
        import numpy as np
        return np.mean(vals)
    except Exception:
        return sum(map(float, vals)) / len(vals)


# ---------- distribution-shift (covariate/OOD) insights ----------

def distribution_shift_insights(metrics: dict) -> dict:
    """Summarize per-background_type eval into an honest OOD story.

    Reads the `distribution_shift` block produced by evaluate_candidate. Never
    fabricates an OOD number: when there is no natural-background (in-situ)
    test data it reports that explicitly rather than inventing a comparison.
    """
    ds = metrics.get("distribution_shift") or {}
    domains = ds.get("domains") or {}
    white = domains.get("white_removed") or {}
    natural = domains.get("natural")

    findings = []
    if natural is None:
        findings.append(
            "No verified in-situ (natural-background) images exist in the test "
            "set, so out-of-distribution accuracy cannot be measured yet."
        )
    else:
        gap = None
        if white.get("accuracy") is not None and natural.get("accuracy") is not None:
            gap = round(white["accuracy"] - natural["accuracy"], 4)
            if abs(gap) < 0.001:
                findings.append(
                    "Observed fact: accuracy is identical on curated (white-removed) "
                    "and in-situ (natural-background) test images."
                )
            elif gap > 0:
                findings.append(
                    f"Statistical finding: accuracy drops {gap:.4f} on in-situ natural-"
                    "background images vs the curated white-removed test set — "
                    "consistent with mild covariate shift. Verify support before quoting."
                )
            else:
                findings.append(
                    f"In-situ (natural-background) accuracy is {abs(gap):.4f} HIGHER than "
                    "curated white-removed — likely small-sample noise; do not over-read."
                )
        findings.append(
            f"natural domain support = {natural.get('support', 0)} test image(s); "
            "small support makes any OOD metric statistically meaningless."
        )

    return {
        "reference_domain": ds.get("reference_domain", "white_removed"),
        "ood_domain": ds.get("ood_domain", "natural"),
        "no_domain_test_data": ds.get("no_domain_test_data", natural is None),
        "domains": domains,
        "white_removed": white,
        "natural": natural,
        "findings": findings,
    }


def improvement_opportunities(perf: dict, conf_err: dict, ds: dict) -> list[dict]:
    """Evidence-ranked recommendations. Each cites its evidence."""
    ops = []
    if perf.get("weakest_class_by_f1"):
        w = perf["weakest_class_by_f1"]
        ops.append({"opportunity": f"Investigate weak per-class performance for {w}",
                    "evidence": f"{w}: F1={perf['per_class'][w]['f1']} on test set"})
    if conf_err["high_confidence_errors"]:
        ops.append({"opportunity": "Review high-confidence misclassifications with an expert",
                    "evidence": f"{len(conf_err['high_confidence_errors'])} error(s) with confidence ≥0.8"})
    shortfall = [c for c, v in ds["per_class"].items() if v < TARGET_PER_CLASS]
    if shortfall:
        ops.append({"opportunity": f"Collect more images for underrepresented classes: {', '.join(shortfall)}",
                    "evidence": f"targets 500/class unmet (see dataset insights)"})
    if ds.get("imbalance_ratio") and ds["imbalance_ratio"] >= 1.5:
        ops.append({"opportunity": "Investigate class imbalance before training",
                    "evidence": f"imbalance ratio {ds['imbalance_ratio']}:1"})
    return ops


def build_all(manifest_rows: list[dict], eval_dirs: list[tuple[str, Path]]) -> dict:
    """Assemble the full insights bundle.
    eval_dirs: [(display_name, path-to-metrics.json)]"""
    out: dict = {"dataset": dataset_insights(manifest_rows), "models": {}}
    for name, metrics_path in eval_dirs:
        if not metrics_path.exists():
            continue
        metrics = json.loads(metrics_path.read_text())
        preds_path = metrics_path.parent / "predictions.csv"
        preds: list[dict] = []
        if preds_path.exists():
            with preds_path.open() as f:
                preds = list(csv.DictReader(f))
        perf = performance_insights(metrics)
        ce = confidence_error_insights(preds)
        improvements = improvement_opportunities(perf, ce, out["dataset"])
        out["models"][name] = {
            "performance": perf,
            "confusion": confusion_insights(metrics),
            "confidence_errors": ce,
            "distribution_shift": distribution_shift_insights(metrics),
            "improvements": improvements,
        }
    return out
