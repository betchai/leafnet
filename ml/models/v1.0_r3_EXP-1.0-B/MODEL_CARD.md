# Model Card — v1.0_r3_EXP-1.0-B

> Generated automatically from real training + evaluation runs on 2026-09-17T08:19:11.730716+00:00.
> Metrics are test-set results at n=200 (target research test size: 200).
> 

- **Model version:** v1.0_r3_EXP-1.0-B
- **Architecture:** MobileNetV2 (torchvision.IMAGENET1K_V2)
- **Transfer learning:** frozen_backbone_head_only
- **Dataset version:** v1.0
- **Trained:** 2026-09-17T04:30:18.714914+00:00 · best epoch 20 · best val loss 0.5657
- **Parameters:** 5,124 trainable / 2,228,996 total

## Test metrics

| Class | Support | Precision | Recall | F1 |
|---|---|---|---|---|
| healthy | 50 | 1.0 | 1.0 | 1.0 |
| leaf_rust | 50 | 0.7955 | 0.7 | 0.7447 |
| leaf_spot | 50 | 0.5441 | 0.74 | 0.6271 |
| leaf_blight | 50 | 0.8158 | 0.62 | 0.7045 |

| Aggregate | Value |
|---|---|
| Accuracy | 0.765 |
| Macro F1 | 0.7691 |

## Acceptance verdict: **PASS** (advisory)

Evaluated against the PRE-REGISTERED thresholds in `ml/src/config/acceptance.json` (v2) — fixed before the run and never tuned after results. The verdict only states what was objectively met on the held-out test set; an expert still decides whether to promote/activate this model.

| Criterion | Threshold | Observed | Met |
|---|---|---|---|
| test_size | 30 | 200 | True |
| accuracy | 0.6 | 0.765 | True |
| macro_f1 | 0.6 | 0.7691 | True |
| macro_precision | 0.6 | 0.7888 | True |
| macro_recall | 0.6 | 0.765 | True |
| worst_class_f1 | 0.4 | 0.6271 | True |
| worst_class_precision | 0.4 | 0.5441 | True |
| worst_class_recall | 0.4 | 0.62 | True |

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
      35,
      14,
      1
    ],
    "leaf_spot": [
      0,
      7,
      37,
      6
    ],
    "leaf_blight": [
      0,
      2,
      17,
      31
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
