# Model Acceptance Criteria (Objective 4)

This document defines *what makes a good model* in LEAFNET, anchored to the
study's **Objective 4** from the manuscript and implemented as pre-registered
thresholds in `ml/src/config/acceptance.json` (`evaluate_acceptance` in
`ml/src/evaluation/evaluate.py:55`).

## Objective 4 (manuscript)

> To test and evaluate the performance of the proposed machine learning model
> using appropriate evaluation metrics in terms of **1.1 accuracy, 2.2
> precision, 3.3 recall, and 4.4 F1-score**.

The manuscript defines "Performance Evaluations" as the quantitative assessment
of the MobileNetV2 transfer-learning model using the Confusion Matrix,
Accuracy, Precision, Recall (Sensitivity), and F1-score. The acceptance
criteria operationalize that objective: **each of the four metrics has an
explicit, pre-registered bar** that a candidate must clear on a leak-proof
held-out test set before it can be described as meeting the research bar.

## Criteria → Objective mapping

| Objective # | Manuscript metric | Criterion (config key) | Threshold | Grade on |
|---|---|---|---|---|
| 4.1 | Accuracy | `accuracy_min` | ≥ 0.60 | overall accuracy |
| 4.2 | Precision | `macro_precision_min` | ≥ 0.60 | macro-average precision |
| 4.2 | Precision | `per_class_precision_min` | ≥ 0.40 | worst-class precision |
| 4.3 | Recall / Sensitivity | `macro_recall_min` | ≥ 0.60 | macro-average recall |
| 4.3 | Recall / Sensitivity | `per_class_recall_min` | ≥ 0.40 | worst-class recall |
| 4.4 | F1-score | `macro_f1_min` | ≥ 0.60 | macro-average F1 |
| 4.4 | F1-score | `per_class_f1_min` | ≥ 0.40 | worst-class F1 |
| — (evidence floor) | — | `test_size_min` | ≥ 30 | held-out test images |

Config `version: 2`. Threshold values:

- **Macro bars (0.60):** comfortable margin above 0.25 chance (4-class
  problem) at the *average* level; guards against accuracy being inflated by a
  dominant class.
- **Worst-class bars (0.40):** no class may be silently neglected in any of
  the three Objective-4 quality metrics (precision, recall, F1).
- **Evidence floor (30):** below this test size the verdict is `INCONCLUSIVE` —
  no statistically meaningful support. 10% of the full 2,000-image dataset is
  200 (the research target); 30 is a conservative pilot-run floor.

## Verdict semantics

Every evaluated candidate receives an automatic verdict from `evaluate_acceptance`:

| Verdict | Condition |
|---|---|
| `PASS` | test_size ≥ 30 **and** all metric thresholds met |
| `FAIL` | test_size ≥ 30 but at least one metric threshold not met |
| `INCONCLUSIVE` | test_size < 30 (insufficient evidence) |

**Advisory by design.** The verdict states objectively what was met on the
held-out test set, but promotion/activation stays an explicit **human expert
decision** (lifecycle `experimental → evaluated → candidate → approved →
active`). A non-PASS verdict does not block promotion; a human may promote a
`FAIL` candidate with documented justification. See
`docs/model-training-workflow.md` and `docs/model-lifecycle.md`.

## Pre-registration stance

- Thresholds are fixed **before** a training run and before results are seen;
  they are **never tuned after results exist**.
- **Change history:** v1 (Sept 10, 2026) gated accuracy + F1 only. **v2**
  added precision and recall bars so all four Objective-4 metrics are gated.
  No v1 threshold value changed; the change was intentionally additive and is
  recorded in git (`git log` on `ml/src/config/acceptance.json`).

## How it is surfaced

- `metrics.json` (per-candidate evaluation artifact) embeds the `acceptance`
  block, including per-criterion rows (criterion / threshold / observed / met).
- A standalone `acceptance.json` is written per evaluation.
- The Models page shows the verdict badge plus the full criteria table
  (`apps/web/src/pages/Models.tsx`).
- `ModelVersion.acceptanceVerdict` persists the verdict for registered models.

## References

- Manuscript Objective 4 + "Definition of Terms" (Performance Evaluations,
  Precision, Recall, F1) — `docs/manuscript-implementation-check.md` for
  alignment status.
- `ml/src/config/acceptance.json` — the thresholds themselves.
- `ml/src/evaluation/evaluate.py` (`evaluate_acceptance`) — the verdict logic.
- `ml/tests/test_acceptance.py` — tests enforcing the pre-registered values.
- `docs/research-traceability-matrix.md` — acceptance as a research element.