# Architecture

## System overview

```
React Frontend (apps/web)
        │  HTTP (JSON, /api/*)
        ▼
Node.js API (apps/api)  ──── Prisma ORM ────► PostgreSQL
        │
        │  HTTP only (ML_SERVICE_URL)
        ▼
Python ML Service (ml/src/inference/)
        │
        ▼
PyTorch Model (ml/models/<version>/)
```

## Key decisions

1. **Strict ML/API boundary.** The Node API never spawns Python processes.
   All inference goes over HTTP through a single client module
   (`apps/api/src/services/mlService.ts`). This lets the ML service be
   developed, scaled, and deployed independently — later it can even become
   a GPU worker.

2. **Config-driven classes.** Leaf-health classes live in
   `ml/src/config/classes.json`. The API serves this file at `/api/classes`,
   so frontend, API, training code, and the model head always agree. Adding
   or renaming a class is a config change plus retraining, not a rewrite.

3. **Metadata in Postgres, binaries on disk.** Images and model weights are
   files; the database stores only metadata (paths, hashes, labels, metrics).
   Content hashes (`sha256`) support future deduplication.

4. **Honest placeholders.** Unimplemented endpoints return `501`/`503` with
   explicit explanations; predictions carry an `isPlaceholder` flag. Nothing
   pretends to be a real result.

5. **Model versioning as data.** Each trained model becomes a `ModelVersion`
   row with its dataset reference and evaluation metrics, enabling A/B
   comparison, rollback (the `isActive` flag), and continuous learning.

## Data flow (future)

```
Image → ModelVersion → Prediction → Feedback → (curated) Training Data
```

User feedback on predictions is stored with optional corrected labels,
forming a natural source of new labeled data for later retraining.
