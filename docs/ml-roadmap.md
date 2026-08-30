# ML Roadmap

Phases are deliberately sequential. Each phase builds on real artifacts from
the previous one — no stage fabricates results for a later one.

## Phase 0 — Scaffold ✅ (done)
Monorepo structure, database schema, API/frontend skeletons, ML module
placeholders, documentation.

## Phase 1 — Dataset preparation
- Collect mulberry leaf photos (own photos / licensed public datasets)
- Implement `ml/src/data/ingestion.py`, `validation.py`, `deduplication.py`
- Register image metadata in Postgres
- Compute dataset statistics (`statistics.py`)

## Phase 2 — Data labeling & validation
- Label images against `classes.json` (ground truth → Classification rows)
- Review workflow (`UNLABELED → LABELED → REVIEWED`)
- Implement splitting with auditable manifests
- Sanity-check class balance; document imbalance honestly

## Phase 3 — Model training
- Implement preprocessing + augmentation
- Transfer learning (MobileNetV3-Small first) via the `Model` abstraction
- Training loop, checkpointing, model cards under `ml/models/<version>/`

## Phase 4 — Model evaluation
- Test-split metrics: accuracy, precision, recall, F1, confusion matrix
- Write results into the ModelVersion row and model card

## Phase 5 — Inference API
- FastAPI service in `ml/src/inference/service.py` exposing `POST /predict`
- Wire `apps/api/src/services/mlService.ts` to it; flip `isPlaceholder=false`

## Phase 6 — Application UI
- Connect Leaf Analyzer end-to-end (upload → predict → display)
- Dataset browser with real thumbnails

## Phase 7 — Continuous learning
- Feedback-driven retraining candidates from the Feedback table
- Versioned retraining loop; promote new ModelVersion to active after
  evaluation beats the current one
