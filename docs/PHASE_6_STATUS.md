# Phase 6 Status — Model Evaluation & Error Analysis

**Date:** 2026-08-24
**Mode:** Formal evaluation procedure executed on Phase-5 PILOT candidates (11-image dataset)

---

## 1. Objective
Formally evaluate candidate MobileNetV2 models on the held-out test set with a
disciplined, identical, reproducible procedure: integrity checks → metrics
(accuracy/precision/recall/F1) → confusion matrix → per-prediction probability
records → error & confidence analysis.

## 2. Models evaluated
- **v0.2_EXP-001** — frozen backbone, head-only training
- **v0.2_EXP-002** — last 3 blocks fine-tuned
Both from dataset version **v0.2** (the only existing version).

## 3. Dataset evaluated
v0.2 · 11 approved images · splits 9/1/1 · **test set = 1 leaf_spot image**
(target research test set is 200 images).

## 4. Test-set integrity result
**PASS** for both evaluations: labels approved & valid, files readable, no
content-duplicate leakage between test and train/val (SHA-256 verified),
model weights and test data unmodified. The evaluation was run exactly once
per candidate; no re-tuning occurred after seeing results.

## 5–7. Overall metrics / per-class / confusion matrix

| | EXP-001 | EXP-002 |
|---|---|---|
| Accuracy | 0.0 | 0.0 |
| Macro F1 | 0.0 | 0.0 |
| Confusion | leaf_spot→leaf_rust ×1 | leaf_spot→leaf_rust ×1 |

⚠️ **n=1.** Metrics are formally computed but statistically meaningless.
The spot→rust confusion direction is consistent with the Phase-2 flagged
ambiguity risk — noted as an anecdote requiring investigation, not evidence.

## 8. Confidence findings
Error confidence was LOW (0.287 / 0.293), top-2 margin small (~0.03–0.07);
no high-confidence errors; true class ranked in top-2 for both models.
Calibration analysis deliberately deferred (meaningless at this n).

## 9. Error-analysis findings
The single error produced an error record + gallery per candidate
(`errors.csv`, `error_galleries/`, `difficult_cases.json`). The image was also
flagged as a difficult case (margin < 0.10).

## 10. Bias/leakage findings
Integrity checks found no leakage. Bias analysis impossible at n=1.

## 11. Model comparison
EXP-002 trained deeper (lower train loss) but both scored 0 on the single test
image — no basis to prefer either as a *research* model.

## 12. Selected candidate
**None promoted.** The beta demo service (clearly labeled BETA) remains
decoupled from research claims. Candidates for Phase 7 will be produced by
retraining on the complete dataset, then re-evaluated through this exact pipeline.

## 13. Limitations
Test n=1 vs target 200 · 11-image total · limited farms/geography · no severity
metadata · uncalibrated confidence · spot/blight taxonomy ambiguity (Phase 2).

## 14. Issues discovered
- scikit-learn missing from venv → installed and added to requirements
- Evaluation must reuse the SAME prepared manifest its models trained on
  (fixed: `--manifest` defaults to the matching PILOT manifest)
- All issues handled without touching test data or model weights

## 15. Files created or modified
**Created:** `ml/src/evaluation/evaluate.py` · `ml/scripts/evaluate.py` ·
`ml/tests/test_evaluation.py` · `ml/reports/evaluation/v0.2_EXP-00{1,2}/`
(metrics.json, predictions.csv, errors.csv, confusion_matrix.csv/.png,
difficult_cases.json, error_galleries/) · `ml/reports/evaluation/v0.2_results.json` ·
`docs/model-evaluation-report.md` · `docs/PHASE_6_STATUS.md` (this file)
**Modified:** `ml/src/config/classes.json` untouched ✅ · `ml/requirements.txt` (+scikit-learn already present via install)

## 16. Tests performed
34/34 pytest pass — including new tests: cross-split duplicate-leakage detection,
4×4 confusion matrix dimensions, prediction-record required fields,
one-record-per-test-image, metric internal consistency, refusal on integrity failure,
and verification that evaluation does not modify model weights or test data.

## 17. Phase 7 readiness: **NOT READY** (for research claims) / infrastructure READY

- The **evaluation infrastructure** is ready and reusable unchanged.
- A **defensible candidate** does not exist yet: 1 test image cannot support any
  generalization claim, so promoting a model into user-facing inference on this
  basis would violate every honesty rule of this project.
- Path forward: complete acquisition/annotation/expert review → cut final
  version → retrain → re-run `scripts/evaluate.py` → then Phase 7 with real numbers.

**Stopping here per phase boundary.** No test-set manipulation, no silent corrections, no fabricated or rounded results.

---

## APPENDIX — Pilot re-evaluation via Pipeline Runner (2026-08-24, later run)

The researcher executed the automated pipeline (Steps 9–11) on v0.2 after the
Pipeline Runner tool was added. Two candidates were trained and evaluated:

| Candidate | Strategy | Best epoch | Best val loss | Train acc (final) | Test acc (n=1) |
|---|---|---|---|---|---|
| v0.2_EXP-0.2-B | frozen backbone | 6 | 1.4783 | 22% | 0.0 |
| v0.2_EXP-0.2-FT | fine-tune last 5 blocks | 7 | 1.3665 | 78% | 0.0 |

Findings unchanged from the original assessment: the fine-tuned variant fits
training data far better while test behavior remains uninformative at n=1.
Both models registered as ModelVersions with PILOT labeling; neither is
promoted. The spot→rust single-error pattern again matches the Phase-2
ambiguity risk.

**Verdict stands: NOT READY for research claims until the full dataset exists.**

### Pipeline run 8a023c61a27a — 2026-08-23T19:46:51.495195+00:00

Dataset version: v0.2 · Pilot fallback: True

- `v0.2_EXP-AUTO4`: accuracy **0.0**, macro F1 **0.0**, test n=1

### Pipeline run b92c1a0f8776 — 2026-08-24T12:23:09.147771+00:00

Dataset version: v1.0 · Pilot fallback: True

- `v1.0_EXP-1.0-B`: accuracy **0.8182**, macro F1 **0.225**, test n=11
- `v1.0_EXP-1.0-FT`: accuracy **0.9091**, macro F1 **0.4868**, test n=11

### Pipeline run 137a156e3827 — 2026-08-24T12:28:16.189266+00:00

Dataset version: v1.0 · Pilot fallback: True

- `v1.0_r2_EXP-1.0-B`: accuracy **0.8182**, macro F1 **0.225**, test n=11
- `v1.0_r2_EXP-1.0-FT`: accuracy **0.8182**, macro F1 **0.225**, test n=11

### Pipeline run 2fc1a0070647 — 2026-08-30T05:49:04.370924+00:00

Dataset version: V1.0 · Pilot fallback: True

- `V1.0_r2_EXP-V1.0-FT`: accuracy **0.845**, macro F1 **0.85**, test n=200
