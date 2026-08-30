# Model Card — `<version>`

> Copy this template into `ml/models/<version>/MODEL_CARD.md` after each
> **real** training run. Never fill values by hand from guesses — metrics must
> come from actual evaluation runs.

## Overview

- **Model version:** e.g. v0.1
- **Architecture:** e.g. MobileNetV3-Small (ImageNet pretrained)
- **Training date:**
- **Framework versions:** PyTorch ___, torchvision ___

## Data

- **Dataset version:**
- **Classes:** (copy from ml/src/config/classes.json at training time)
- **Train / val / test sizes:** ___ / ___ / ___
- **Preprocessing:** resize to ___, normalization per-channel mean/std

## Results

| Metric | Value |
|--------|-------|
| Accuracy | |
| Precision (macro) | |
| Recall (macro) | |
| F1 (macro) | |

### Confusion matrix

```
(paste generated confusion matrix here)
```

## Notes & limitations

- Known failure modes:
- Classes underrepresented in training data:
- Intended use: educational; NOT a substitute for expert agronomic diagnosis.
