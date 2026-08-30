# ML Layer

All machine-learning code lives here, fully independent of the Node.js API.

## Layout

- `data/` — raw → processed → train/validation/test images. Large files are gitignored.
- `models/` — trained model artifacts, one directory per version (`v0.1/`, …).
- `notebooks/` — exploration only; anything useful gets promoted into `src/`.
- `src/config/` — `classes.json` (class labels/IDs) and `pipeline.json` (sizes, splits, augmentation). **Change config, not code.**
- `src/data/` — ingestion, validation, deduplication, splitting, statistics.
- `src/preprocessing/` — image transforms and augmentation.
- `src/training/` — model abstraction + training loop.
- `src/evaluation/` — metrics and confusion matrix.
- `src/inference/` — the REST inference service the Node API calls.
- `scripts/` — runnable CLI entry points per phase.

## Pipeline (planned)

```
Raw Images → Validation → Deduplication → Preprocessing
           → Train/Val/Test Split → Augmentation → Training Dataset
```

Nothing in this pipeline is implemented yet. Every module contains a
`TODO(phase: ...)` marker describing its responsibilities.

## Setup

```bash
cd ml
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Python 3.11+ recommended.
