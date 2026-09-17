"""Objective acceptance verdict (PASS / FAIL / INCONCLUSIVE) tests.

The verdict is computed against PRE-REGISTERED thresholds in
ml/src/config/acceptance.json. It is advisory: promotion/activation remains an
expert decision (this is asserted explicitly via the `advisory` flag).
"""

from __future__ import annotations

import src.evaluation.evaluate as ev


def _metrics(accuracy: float = 0.9, macro_f1: float = 0.88,
             per_class_f1: dict | None = None,
             macro_precision: float = 0.87, macro_recall: float = 0.86,
             per_class_precision: dict | None = None,
             per_class_recall: dict | None = None) -> dict:
    keys = ["healthy", "leaf_rust", "leaf_spot", "leaf_blight"]
    per_f1 = per_class_f1 or {k: 0.9 for k in keys}
    per_prec = per_class_precision or {k: 0.9 for k in keys}
    per_rec = per_class_recall or {k: 0.9 for k in keys}
    return {
        "accuracy": accuracy,
        "per_class": {k: {"precision": per_prec[k], "recall": per_rec[k], "f1": per_f1[k]}
                      for k in keys},
        "macro": {"precision": macro_precision, "recall": macro_recall, "f1": macro_f1},
    }


def test_acceptance_pass_when_all_criteria_met():
    verdict = ev.evaluate_acceptance(_metrics(), test_size=200)
    assert verdict["verdict"] == "PASS"
    assert verdict["met_all"] is True
    assert verdict["sufficient_evidence"] is True
    assert all(r["met"] for r in verdict["results"])


def test_acceptance_fail_when_accuracy_is_low():
    verdict = ev.evaluate_acceptance(_metrics(accuracy=0.5), test_size=200)
    assert verdict["verdict"] == "FAIL"
    acc = next(r for r in verdict["results"] if r["criterion"] == "accuracy")
    assert acc["met"] is False


def test_acceptance_fail_when_macro_f1_is_low():
    verdict = ev.evaluate_acceptance(_metrics(macro_f1=0.4), test_size=200)
    assert verdict["verdict"] == "FAIL"
    macro = next(r for r in verdict["results"] if r["criterion"] == "macro_f1")
    assert macro["met"] is False


def test_acceptance_fail_when_macro_precision_is_low():
    verdict = ev.evaluate_acceptance(_metrics(macro_precision=0.3), test_size=200)
    assert verdict["verdict"] == "FAIL"
    row = next(r for r in verdict["results"] if r["criterion"] == "macro_precision")
    assert row["value"] == 0.3 and row["met"] is False


def test_acceptance_fail_when_macro_recall_is_low():
    verdict = ev.evaluate_acceptance(_metrics(macro_recall=0.3), test_size=200)
    assert verdict["verdict"] == "FAIL"
    row = next(r for r in verdict["results"] if r["criterion"] == "macro_recall")
    assert row["value"] == 0.3 and row["met"] is False


def test_acceptance_fail_when_worst_class_is_neglected():
    """per_class_f1_min guards against one class being silently ignored."""
    pc = {"healthy": 0.95, "leaf_rust": 0.92, "leaf_spot": 0.9, "leaf_blight": 0.15}
    verdict = ev.evaluate_acceptance(_metrics(per_class_f1=pc), test_size=200)
    assert verdict["verdict"] == "FAIL"
    worst = next(r for r in verdict["results"] if r["criterion"] == "worst_class_f1")
    assert worst["value"] == 0.15 and worst["met"] is False


def test_acceptance_fail_when_worst_class_precision_is_low():
    pp = {"healthy": 0.95, "leaf_rust": 0.92, "leaf_spot": 0.9, "leaf_blight": 0.15}
    verdict = ev.evaluate_acceptance(_metrics(per_class_precision=pp), test_size=200)
    assert verdict["verdict"] == "FAIL"
    worst = next(r for r in verdict["results"] if r["criterion"] == "worst_class_precision")
    assert worst["value"] == 0.15 and worst["met"] is False


def test_acceptance_fail_when_worst_class_recall_is_low():
    pr = {"healthy": 0.95, "leaf_rust": 0.92, "leaf_spot": 0.9, "leaf_blight": 0.15}
    verdict = ev.evaluate_acceptance(_metrics(per_class_recall=pr), test_size=200)
    assert verdict["verdict"] == "FAIL"
    worst = next(r for r in verdict["results"] if r["criterion"] == "worst_class_recall")
    assert worst["value"] == 0.15 and worst["met"] is False


def test_acceptance_inconclusive_when_test_too_small():
    verdict = ev.evaluate_acceptance(_metrics(), test_size=3)
    assert verdict["verdict"] == "INCONCLUSIVE"
    assert verdict["met_all"] is None
    assert verdict["sufficient_evidence"] is False
    assert "not enough held-out test images" in verdict["note"].lower()


def test_acceptance_is_advisory_by_design():
    for n, met in ((200, True), (200, False)):
        verdict = ev.evaluate_acceptance(_metrics(accuracy=0.9 if met else 0.4), test_size=n)
        assert verdict["advisory"] is True, "verdict must never bypass the expert decision"


def test_acceptance_config_is_preregistered_and_fixed():
    cfg = ev.load_acceptance()
    criteria = cfg["criteria"]
    assert cfg["version"] == "2"
    assert set(criteria) == {
        "test_size_min", "accuracy_min",
        "macro_f1_min", "macro_precision_min", "macro_recall_min",
        "per_class_f1_min", "per_class_precision_min", "per_class_recall_min",
    }
    assert criteria["test_size_min"] == 30
    assert criteria["accuracy_min"] == 0.6
    assert criteria["macro_f1_min"] == 0.6
    assert criteria["macro_precision_min"] == 0.6
    assert criteria["macro_recall_min"] == 0.6
    assert criteria["per_class_f1_min"] == 0.4
    assert criteria["per_class_precision_min"] == 0.4
    assert criteria["per_class_recall_min"] == 0.4
    # every result row cites the pre-registered threshold verbatim
    verdict = ev.evaluate_acceptance(_metrics(), test_size=200)
    criterion_to_key = {
        "test_size": "test_size_min",
        "accuracy": "accuracy_min",
        "macro_f1": "macro_f1_min",
        "macro_precision": "macro_precision_min",
        "macro_recall": "macro_recall_min",
        "worst_class_f1": "per_class_f1_min",
        "worst_class_precision": "per_class_precision_min",
        "worst_class_recall": "per_class_recall_min",
    }
    thresholds = {criterion_to_key[r["criterion"]]: r["threshold"] for r in verdict["results"]}
    assert thresholds == criteria