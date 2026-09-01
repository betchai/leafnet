"""Phase 9 insights analytics tests — synthetic data, no research contamination."""

from __future__ import annotations

import json

from src.analytics.insights import (
    confidence_error_insights,
    confusion_insights,
    dataset_insights,
    distribution_shift_insights,
    improvement_opportunities,
    performance_insights,
)


def _metrics(n_test=200):
    return {
        "model_version": "vTEST",
        "dataset_version": "vT",
        "test_size": n_test,
        "statistical_warning": None if n_test >= 30 else "too small",
        "metrics": {
            "accuracy": 0.85,
            "macro": {"precision": 0.84, "recall": 0.83, "f1": 0.835},
            "weighted": {"precision": 0.86, "recall": 0.85, "f1": 0.84},
            "per_class": {
                "healthy":      {"precision": 0.9, "recall": 0.95, "f1": 0.92, "support": 50},
                "leaf_rust":    {"precision": 0.88, "recall": 0.9, "f1": 0.89, "support": 50},
                "leaf_spot":    {"precision": 0.8, "recall": 0.7, "f1": 0.75, "support": 50},
                "leaf_blight":  {"precision": 0.78, "recall": 0.77, "f1": 0.77, "support": 50},
            },
        },
        "confusion_matrix": {
            "columns_predicted": ["healthy", "leaf_rust", "leaf_spot", "leaf_blight"],
            "rows_actual": {
                "healthy": [47, 1, 2, 0],
                "leaf_rust": [2, 45, 3, 0],
                "leaf_spot": [0, 8, 35, 7],
                "leaf_blight": [1, 0, 6, 43],
            },
        },
    }


def test_dataset_insights_counts_and_observations():
    rows = ([{"class": "healthy", "split": "train"}] * 100
            + [{"class": "leaf_spot", "split": "test"}] * 10)
    d = dataset_insights(rows)
    assert d["total_images"] == 110
    assert d["per_class"]["healthy"] == 100 and d["per_class"]["leaf_spot"] == 10
    assert d["largest_class"] == "healthy" and d["smallest_class"] == "leaf_spot"
    assert d["imbalance_ratio"] == 10.0
    assert any("imbalance ratio" in o for o in d["observations"])


def test_dataset_insights_zero_safe():
    d = dataset_insights([])
    assert d["total_images"] == 0
    assert "No approved research images" in d["observations"][0]


def test_performance_insights_identifies_best_and_weakest():
    p = performance_insights(_metrics())
    assert p["best_class_by_f1"] == "healthy"
    assert p["weakest_class_by_f1"] == "leaf_spot"
    assert any("accuracy" in f for f in p["findings"])
    # statistical warning present for small n
    small = performance_insights({**_metrics(5), "test_size": 5})
    assert any("Insufficient" in f for f in small["findings"])


def test_confusion_insights_directional_pairs():
    c = confusion_insights(_metrics())
    pairs = {(p["actual"], p["predicted"]): p["count"] for p in c["ranked_confusion_pairs"]}
    # spot->blight (7) vs blight->spot (6): directions are distinct entries
    assert pairs[("leaf_spot", "leaf_blight")] == 7
    assert pairs[("leaf_blight", "leaf_spot")] == 6
    assert c["most_frequent_confusion"]["actual"] == "leaf_spot"
    assert c["total_misclassified"] == 30


def test_confidence_insights_groups_and_thresholds():
    preds = [
        {"correct": "True", "confidence": 0.95},
        {"correct": "True", "confidence": 0.85},
        {"correct": "False", "confidence": 0.90},   # high-confidence error
        {"correct": "False", "confidence": 0.30},   # low-confidence error
    ]
    ce = confidence_error_insights(preds)
    assert len(ce["high_confidence_errors"]) == 1
    assert ce["mean_confidence_correct"]["mean"] > ce["mean_confidence_incorrect"]["mean"]
    assert "higher confidence" in ce["finding"]


def test_confidence_insight_does_not_force_positive_relationship():
    # incorrect predictions MORE confident than correct ones
    preds = [
        {"correct": "True", "confidence": 0.55},
        {"correct": "False", "confidence": 0.99},
    ]
    ce = confidence_error_insights(preds)
    assert "overconfidence" in ce["finding"]


def test_improvements_are_evidence_linked():
    perf = {"weakest_class_by_f1": "leaf_spot",
            "per_class": {"leaf_spot": {"f1": 0.4}}}
    ce = {"high_confidence_errors": [1, 2]}
    ds = {"per_class": {"healthy": 100, "leaf_spot": 20},
          "imbalance_ratio": 5.0}
    ops = improvement_opportunities(perf, ce, ds)
    evidence_texts = " | ".join(o["evidence"] for o in ops)
    assert all("evidence" in o for o in ops)  # every recommendation cites evidence
    assert "leaf_spot" in evidence_texts


def test_zero_data_everywhere():
    assert dataset_insights([])["total_images"] == 0
    ce = confidence_error_insights([])
    assert "Insufficient" in ce["finding"]


def test_distribution_shift_reports_ood_gap_honestly_missing():
    # no natural domain -> must say so, not invent a number
    metrics = _metrics()
    metrics["distribution_shift"] = {
        "domains": {"white_removed": {"support": 180, "accuracy": 0.9}},
        "no_domain_test_data": True,
    }
    d = distribution_shift_insights(metrics)
    assert d["no_domain_test_data"] is True
    assert d["natural"] is None
    assert any("cannot be measured" in f for f in d["findings"])


def test_distribution_shift_reports_gap_when_natural_present():
    metrics = _metrics()
    metrics["distribution_shift"] = {
        "domains": {
            "white_removed": {"support": 180, "accuracy": 0.9,
                              "macro_f1": 0.85, "per_class_f1": {}},
            "natural": {"support": 20, "accuracy": 0.7,
                        "macro_f1": 0.6, "per_class_f1": {}},
        },
        "no_domain_test_data": False,
    }
    d = distribution_shift_insights(metrics)
    assert d["no_domain_test_data"] is False
    assert d["natural"]["accuracy"] == 0.7
    assert any("drops" in f and "0.2000" in f for f in d["findings"])  # 0.9 - 0.7 = 0.2
    assert any("support" in f for f in d["findings"])
