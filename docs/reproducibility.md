# Reproducibility

Exact chain from raw image to application prediction, with artifact locations.

## Research pipeline

```
1. Raw images (ml/data/raw, gitignored)
2. Ingestion → hash (sha256) + metadata → PostgreSQL Image row
3. Validation → ml/src/data/validation.py
4. Deduplication flags → ml/src/data/deduplication.py + ImageRelation rows
5. Annotation (preliminary) → Annotation(stage=PRELIMINARY)
6. Expert verification → Annotation(EXPERT_REVIEW/FINAL_VERIFIED)
   → Classification row = ground truth (only after APPROVED)
7. Dataset version cut → Dataset row + membership (many-to-many) 
   + manifest via GET /api/datasets/:id/manifest
8. Prepared split manifest → ml/data/prepared/<id>_seed42.jsonl
   (group-aware splitter: ml/src/data/splitting.py; audit JSON alongside)
9. Preflight → ml/src/training/preflight.py (must pass or training refuses)
10. Training → ml/scripts/run_experiment.py → 
    artifacts: ml/models/<v>_<exp>/{model_best.pt, metadata.json,
    training_history.json, class_mapping.json}
11. Evaluation → ml/scripts/evaluate.py →
    ml/reports/evaluation/<candidate>/ (metrics, predictions, errors, confusion)
12. Promotion → lifecycle endpoint + models/active.json pointer
13. Serving → ml/src/api/main.py (loads active model at startup)
14. Application → Node API /api/predictions → React Leaf Analyzer
```

## Required environment (recorded in every checkpoint)

- Python 3.14 (venv), PyTorch 2.13.0+cpu, torchvision 0.28.0
- Node.js 20.x, Prisma 6.x
- Seeds: Python/NumPy/torch/DataLoader all set from `training.json.randomSeed` (42)
- OS/platform recorded in each `metadata.json`

## Reproducing the final training run

1. Restore PostgreSQL backup containing dataset v0.2 (or later frozen version)
2. Ensure `ml/models/<version>/model_best.pt` matches the MANIFEST.json sha256
3. `python scripts/run_experiment.py --dataset-id <id> --version-label <v> ...`
4. `python scripts/evaluate.py --dataset-id <id>` — identical procedure to Phase 6

## Regression protection

A re-deployed model must produce identical predictions on fixed inputs
(verified by `test_integration_predict_shape_and_reproducibility`) and its
checkpoint sha256 must match the manifest.
