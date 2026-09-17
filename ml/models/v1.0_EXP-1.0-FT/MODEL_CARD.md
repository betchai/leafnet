# Model Card — v1.0_EXP-1.0-FT

> Generated automatically from real training + evaluation runs on 2026-09-17T08:20:10.476776+00:00.
> Metrics are test-set results at n=200 (target research test size: 200).
> 

- **Model version:** v1.0_EXP-1.0-FT
- **Architecture:** MobileNetV2 (torchvision.IMAGENET1K_V2)
- **Transfer learning:** partial_fine_tune_last_5_blocks
- **Dataset version:** v1.0
- **Trained:** 2026-09-17T08:18:16.902168+00:00 · best epoch 19 · best val loss 0.4014
- **Parameters:** 1,686,468 trainable / 2,228,996 total

## Test metrics

| Class | Support | Precision | Recall | F1 |
|---|---|---|---|---|
| healthy | 50 | 1.0 | 1.0 | 1.0 |
| leaf_rust | 50 | 0.8 | 0.8 | 0.8 |
| leaf_spot | 50 | 0.65 | 0.78 | 0.7091 |
| leaf_blight | 50 | 0.95 | 0.76 | 0.8444 |

| Aggregate | Value |
|---|---|
| Accuracy | 0.835 |
| Macro F1 | 0.8384 |

## Acceptance verdict: **PASS** (advisory)

Evaluated against the PRE-REGISTERED thresholds in `ml/src/config/acceptance.json` (v2) — fixed before the run and never tuned after results. The verdict only states what was objectively met on the held-out test set; an expert still decides whether to promote/activate this model.

| Criterion | Threshold | Observed | Met |
|---|---|---|---|
| test_size | 30 | 200 | True |
| accuracy | 0.6 | 0.835 | True |
| macro_f1 | 0.6 | 0.8384 | True |
| macro_precision | 0.6 | 0.85 | True |
| macro_recall | 0.6 | 0.835 | True |
| worst_class_f1 | 0.4 | 0.7091 | True |
| worst_class_precision | 0.4 | 0.65 | True |
| worst_class_recall | 0.4 | 0.76 | True |

> Objective criteria met on the held-out test set. This verdict is advisory: an expert still decides whether to promote/activate/use the model.

## Confusion matrix
Columns = predicted, rows = actual:

```
{
  "columns_predicted": [
    "healthy",
    "leaf_rust",
    "leaf_spot",
    "leaf_blight"
  ],
  "rows_actual": {
    "healthy": [
      50,
      0,
      0,
      0
    ],
    "leaf_rust": [
      0,
      40,
      10,
      0
    ],
    "leaf_spot": [
      0,
      9,
      39,
      2
    ],
    "leaf_blight": [
      0,
      1,
      11,
      38
    ]
  }
}
```

## Known limitations
- Dataset scope limited to collected farms/sessions/conditions
- Confidence NOT calibrated — do not read as probability of correctness
- Spot/blight visual ambiguity documented in Phase 2


## Intended use / non-intended use
Intended: research evaluation and (after promotion) application suggestions with cautious language.
NOT intended: biological diagnosis or any claim beyond the evaluated dataset scope.
