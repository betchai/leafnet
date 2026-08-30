# Analytics Methodology

Formulas and provenance for every insight LEAFNET computes.

## Dataset insights

- `images_per_class[c]` = count of APPROVED rows with class c
- `pct_per_class[c]` = 100 × count_c / total_approved
- `imbalance_ratio` = max(counts of present classes) / min(counts of present classes);
  absent classes reported as shortfalls, not "smallest"
- `shortfall[c]` = 500 − count_c when positive

## Performance insights (source: Phase-6 metrics.json)

Read verbatim from the formal test evaluation: accuracy, per-class
precision/recall/F1/support (scikit-learn definitions), macro and weighted averages.
Best/weakest classes ranked by F1; most sensitive by recall; most precise by precision.
The ranking metric is always displayed next to the claim.

## Confusion insights (source: metrics.json confusion_matrix)

- Directional pair (actual=A, predicted=B, count=n) for every off-diagonal n>0
- Ranked descending; A→B and B→A reported separately
- Total misclassified = sum of off-diagonal counts

## Confidence / error insights (source: predictions.csv)

- errors = rows with correct=false
- high-confidence error: error ∧ confidence ≥ 0.8 (configurable)
- low-confidence prediction: confidence < 0.5 (configurable)
- mean/min/max confidence computed separately for correct vs incorrect sets
- comparative finding emitted only when both groups are non-empty; direction
  reported honestly either way ("possible overconfidence pattern" if errors are
  more confident)

## Application insights (source: PostgreSQL via Node API)

- prediction counts per class over non-placeholder predictions (≤1000 latest)
- low_confidence_rate = 100 × (confidence<0.5)/total
- feedback_rate = 100 × feedbacks/total · disagreement_rate among feedback
- Suppressed with "insufficient data" below 30 observations

## What is intentionally NOT computed

- Calibration/ECE (Phase 6 deferred until meaningful test n)
- Causal claims of any kind
- Disease prevalence from application distribution (sampling design unsupported)
