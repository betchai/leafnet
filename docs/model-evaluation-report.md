# Model Evaluation Report — Phase 6 (PILOT)

**Evaluation date:** 2026-08-24
**Models evaluated:** v0.2_EXP-001 (frozen backbone) · v0.2_EXP-002 (fine-tune, last 3 blocks)
**Dataset version:** v0.2 · **Test set size: 1 image**

> ⚠️ **Read this first.** The research test set should contain 200 images.
> The current dataset contains 11 approved images total, so the held-out test
> split contains **1 image**. The metrics below were computed through the full,
> formal, identical procedure for both candidates — but at n=1 they carry **zero
> statistical significance** and must not be quoted as model performance anywhere.

## Executive summary

Both Phase-5 pilot candidates were formally evaluated on the isolated test set
through an identical procedure with a passing integrity preflight. The single
test image (actual: leaf_spot) was misclassified by both models (predicted:
leaf_rust), yielding accuracy 0.0. Confidence on the error was low (0.287 /
0.293) — the models were *not* confidently wrong. These results validate the
evaluation pipeline; they say essentially nothing about real-world performance.

## Dataset

- Version v0.2 · 11 approved images · splits 9/1/1
- Test class distribution: leaf_spot ×1

## Model & integrity

- MobileNetV2, IMAGENET1K_V2 pretrained, head Dropout(0.5)+Linear(1280→4)
- Integrity checks passed for both evaluations: test rows APPROVED, labels valid,
  files readable, no content-duplicate leakage across splits, model weights and
  test data unmodified during evaluation

## Overall & per-class performance

| Metric | EXP-001 | EXP-002 |
|---|---|---|
| Accuracy | 0.0 | 0.0 |
| Macro P/R/F1 | 0 / 0 / 0 | 0 / 0 / 0 |
| Weighted F1 | 0.0 | 0.0 |

Per-class (both models): leaf_spot support=1, recall 0, precision 0; other classes support 0.
Full details: `ml/reports/evaluation/v0.2_EXP-00*/metrics.json`.

## Confusion matrix findings

Single observation in each matrix: leaf_spot → leaf_rust. This is consistent
with the Phase-2 flagged risk (early-stage rust and spot lesions look alike),
but one observation is anecdote, not evidence.

## Confidence analysis

- Error confidence was LOW (EXP-001: 0.287; EXP-002: 0.293) with a small top-2 margin (~0.03–0.07)
- No high-confidence (≥0.8) errors observed
- Both models placed the true class among top-2 predictions
- Calibration (ECE/reliability diagrams) deliberately NOT computed — requires meaningful test n. Confidence must not be treated as correctness probability.

## Generalization comparison

EXP-002 reached lower training loss than EXP-001 while both scored 0 on test —
the classic small-data pattern where train/test behavior is decoupled. No
generalization claim is possible.

## Model comparison & recommendation

No recommendation is made. Neither candidate may proceed to production
inference claims. The beta demo service remains clearly labeled BETA and is
excluded from research claims.

## Limitations (formal)

n=1 test · 11-image dataset · 2 farms · 1 geographic region · no severity data ·
spot/blight label ambiguity documented in Phase 2 · confidence uncalibrated ·
possible session/device confounding unmeasured.

## Research implications

These results establish: the evaluation pipeline works, integrity controls work,
and artifacts are reproducible. They do NOT establish anything about how well
MobileNetV2 classifies mulberry leaf health. That question becomes answerable
only when the 200-image test set exists.

## Required before re-evaluation

Complete acquisition → annotation → expert review to targets → cut final
dataset version → regenerate prepared manifest → retrain EXP candidates on the
full data → re-run this exact pipeline (`python scripts/evaluate.py`).
