# LEAFNET — Tools & Automated Processes

**Date:** August 26, 2026
**Status:** All phases complete (1–10)

---

## Summary

LEAFNET automates the full ML lifecycle for mulberry leaf health classification: data acquisition → annotation → training → evaluation → inference → feedback → monitoring. The system runs as three services (Node API, Python ML, PostgreSQL) with a React frontend.

---

## 1. API Route Handlers (apps/api/src/routes/)

### health.ts
Returns a JSON health-check payload confirming the Node API is alive, with a timestamp and ML service connection status.
- `GET /api/health` — returns `{ status, service, mlServiceConnected, time }`

### classes.ts
Serves the leaf-health classification taxonomy (the 4-class definition) directly from `ml/src/config/classes.json` — the single source of truth shared by frontend, API, and ML.
- `GET /api/classes` — returns the full taxonomy config (class keys, labels, descriptions, visual indicators, annotation guidance, evidence sources)

### images.ts
CRUD for leaf images: list with filters, multipart upload with technical validation (format, magic bytes, corruption check, exact-duplicate flagging), serve stored original files, and fetch full image detail with workflow history.
- `GET /api/images?class=&annotationStatus=&datasetId=&fixtures=include|exclude|only` — filtered image listing (max 200)
- `POST /api/images` — multipart upload (image + metadata), persists with ingestion service
- `GET /api/images/:id/file` — serve the raw stored image file
- `GET /api/images/:id` — full detail with classifications, annotations, audit trail, relations

### annotations.ts
Enforces the annotation workflow state machine (UNLABELED → NEEDS_REVIEW → ANNOTATED → EXPERT_REVIEWED → APPROVED, plus REJECTED/UNCERTAIN/SECOND_OPINION). Provides preliminary annotation, expert review (confirm/relabel/uncertain/reject/second_opinion), audit trail query, and batch confirmation of all pending images.
- `POST /api/images/:id/annotations` — preliminary annotation by researcher (validates class key against taxonomy)
- `POST /api/images/:id/review` — expert review action (confirm, relabel, mark_uncertain, reject, second_opinion)
- `GET /api/images/:id/audit` — full who/when/what/why annotation audit history
- `POST /api/review/batch-confirm` — bulk-confirm all pending images (with optional label override)
- `GET /api/review/batch-confirm-preview` — preview breakdown of pending images by status and label before batch confirm

### predictions.ts
Orchestrates the full prediction flow: receives an imageId, reads the stored file, forwards it to the Python ML service at `/predict`, validates the ML response, persists the prediction with full probability distribution, and collects expert feedback. Includes an in-memory rate limiter (30 predictions/minute/IP).
- `POST /api/predictions` — `{ imageId }` triggers inference via ML service, returns prediction with probabilities and disclaimer
- `GET /api/predictions?limit=20` — prediction history (newest first, max 100)
- `GET /api/predictions/:id` — single prediction detail with feedback and model version
- `POST /api/predictions/:id/feedback` — submit expert feedback (`agree`/`disagree`/`unsure`, optional corrected class and comment)

### models.ts
Lists all model versions from the database. Empty until a model is trained and registered by the pipeline.
- `GET /api/models` — returns all ModelVersion records, newest first

### datasets.ts
Lists dataset versions and cuts new dataset versions from all APPROVED research images. Cutting creates a snapshot with real composition counts and many-to-many image membership.
- `GET /api/datasets` — list all dataset versions with image counts
- `POST /api/datasets/cut` — `{ version, changes?, knownIssues? }` creates a new dataset version from all approved research images

### datasetStatus.ts
Provides live dataset composition tracking — per-class lifecycle counts (acquired/annotated/verified/approved/rejected/uncertain), balance analysis with severity ratings (ok/attention/critical), feedback count, open duplicate flags, and active model info. Dev fixtures are reported separately.
- `GET /api/datasets/status` — full composition breakdown with balance summary

### datasetManifest.ts
Generates a reproducible JSONL manifest for a dataset version. Includes only APPROVED research images (dev fixtures excluded). Output is newline-delimited JSON with standardized fields for ML consumption.
- `GET /api/datasets/:id/manifest` — streams NDJSON manifest with fields: image_id, path, source, source_type, license, class, severity, split, annotation_status, review_status, etc.

### toolsBulkIngest.ts
Bulk ingestion tool — accepts up to 500 images in a single multipart upload with shared collection metadata and optional preliminary label assignment. Each image goes through the audited ingestion pipeline.
- `POST /api/tools/bulk-ingest` — multipart upload of images array with metadata; returns counts of ingested, duplicates flagged, labeled, and failed

### toolsPipeline.ts
Thin HTTP proxy from the Node API to the Python ML service pipeline endpoints. Never spawns Python directly — forwards requests over HTTP.
- `POST /api/tools/pipeline/start` — starts a background pipeline job (Steps 9/10/11) in the ML service
- `GET /api/tools/pipeline/status/:jobId` — polls pipeline job status (step-by-step progress, logs)

### toolsModelRegister.ts
Registers evaluated model candidates as ModelVersion rows in the database. Called automatically by the Python pipeline after Step 11 (evaluation). Never sets isActive — promotion remains a human decision.
- `POST /api/tools/models/register` — `{ versionLabel, experimentId, architecture, framework, trainedAt, accuracy, f1Score, confusionMatrix, notes }` upserts a ModelVersion record

### toolsInsights.ts
Research insights orchestration — proxies the Python analytics engine for dataset/model research insights, and computes APPLICATION insights from the Postgres database (predictions per class, feedback rate, disagreement rate, low-confidence rate). Research and application data are kept separate.
- `GET /api/insights?dataset_version=&dataset_id=` — returns combined research + application insights bundle

### toolsFeedbackReview.ts
Phase 9.1 feedback review queue, candidate training data, model lifecycle management, and monitoring summary. Expert/admin workflow for verifying application feedback, transitioning model lifecycle states, and viewing performance monitoring data.
- `GET /api/tools/feedback?status=&verdict=&modelVersion=` — feedback review queue with filters
- `PATCH /api/tools/feedback/:id/review` — expert review action (start_review, verify, verify_corrected, mark_uncertain, reject)
- `GET /api/tools/candidates` — images with VERIFIED labels eligible for next dataset version
- `PATCH /api/tools/models/:id/lifecycle` — model lifecycle transition (experimental → evaluated → candidate → approved → active → retired)
- `GET /api/tools/monitoring/summary` — comprehensive monitoring: per-model stats, confusion pairs, verified accuracy, review backlog

---

## 2. Domain Logic & Services (apps/api/src/)

### server.ts
Express application server — wires all routes, configures CORS, helmet security headers, request-ID tracking, logging, error handling. In production, serves the built React frontend as static files from the same origin. Runs on port 4000.

### domain/workflow.ts
Pure-function annotation workflow state machine. Enforces valid transitions, role-based access (only experts can review), and prevents AI predictions from driving any status change.

### domain/lifecycle.ts
Pure-function model lifecycle state machine (experimental → evaluated → candidate → approved → active → retired) and feedback review workflow (SUBMITTED → UNDER_REVIEW → VERIFIED/REJECTED). Enforces role-based access and valid transitions.

### domain/taxonomy.ts
Taxonomy enforcement — loads the approved 4-class labels from `ml/src/config/classes.json` and validates that any class key used anywhere in the system matches the approved taxonomy.

### domain/composition.ts
Pure-function dataset composition tracking — computes per-class lifecycle counts (acquired/annotated/verified/approved/rejected/uncertain), class imbalance metrics, and research vs dev fixture separation from raw image rows.

### services/ingestion.ts
Image ingestion service — pure validation + naming (format check, magic-byte content verification, SHA-256 hashing, unique stored name generation) separated from database persistence. Originals are never overwritten; exact duplicates are flagged, not refused.

### services/mlService.ts
ML service client — the single deliberate boundary between Node API and Python ML service. Provides a typed `predict()` function that forwards inference requests over HTTP.

### web/src/lib/api.ts
Frontend typed API client (thin wrapper over fetch). The `api` object provides methods for health, classes, images, datasets, models, predictions, upload-and-predict, and feedback. The `toolsApi` object extends it for researcher tools. The frontend never talks to the Python ML service directly.

---

## 3. Web Pages (apps/web/src/pages/)

### Landing.tsx
Public landing page for Leafnet — hero section with features, a 4-step workflow diagram (Upload → Analyze → Review → Feedback), and a schematic diagram. No app chrome; standalone presentation.

### Dashboard.tsx
Functional application dashboard — shows live system status (approved images vs target, active model, feedback count, open duplicate flags), leaf health classes with descriptions, and the 5 most recent predictions.

### Analyzer.tsx
Primary user journey — the Leaf Analyzer. Full upload-to-result flow: drag-and-drop or file select (JPEG/PNG, max 20MB) → preview → analyze → processing spinner → prediction result with class probabilities and confidence → expert feedback (agree/disagree/unsure with optional comment).

### Insights.tsx
Research insights dashboard (Phase 9). Sections: Dataset composition, Model performance (per-model), Per-class analysis, Confusion matrix, Confidence distribution, Error analysis, Application data, and Improvement opportunities.

### Models.tsx
Model registry page — lists trained model candidates with version, architecture, dataset version, training date, accuracy, F1 score, and active status. Includes a balance honesty overlay that warns when dataset class imbalance makes accuracy metrics unreliable.

### Dataset.tsx
Dataset browser — shows real images filtered by class and annotation status. Displays images in a grid with filename, class, and status tags.

### tools/ToolsLayout.tsx
Encapsulated researcher tools section layout. Provides a tabbed navigation (Acquire & Label, Bulk Ingest, Expert Review, Feedback Review, Monitoring, Dataset Status, Pipeline Runner, Phase 2 Validator) with an `<Outlet>` for nested routes.

### tools/LabelTool.tsx
Acquire & Label tool — ingest images (upload form with source metadata) then assign preliminary labels from the 4-class taxonomy. Shows a queue of unlabeled and needs-review images.

### tools/BulkIngestTool.tsx
Bulk ingestion tool — upload many images at once (up to 500) with shared collection metadata (source, session, farm, license) and optional preliminary label assignment to all of them.

### tools/ReviewTool.tsx
Expert review queue — shows images in ANNOTATED/EXPERT_REVIEWED/SECOND_OPINION/UNCERTAIN states. Supports individual review actions (confirm, relabel, uncertain, reject, second opinion) and batch confirmation of all pending images with optional label override.

### tools/FeedbackReviewTool.tsx
Phase 9.1 feedback review queue — expert verification of application feedback. Shows feedback items with the original prediction, image, suggested class, and expert actions (verify, verify_corrected, mark_uncertain, reject). Verified labels become CANDIDATE training data.

### tools/MonitoringTool.tsx
Phase 9.1 monitoring dashboard — shows prediction totals, average confidence, low-confidence percentage, feedback rate, review backlog, verified outcomes (accuracy over expert-verified cases only), per-model breakdown, and real-world confusion pairs.

### tools/StatusTool.tsx
Dataset status tool — live acquisition/verification progress vs the 500/class target. Shows per-class lifecycle table (acquired/annotated/verified/approved/rejected/uncertain) with progress bars toward the target, balance severity warnings, and duplicate flag counts.

### tools/PipelineTool.tsx
Pipeline runner — one-click execution of Steps 9 → 10 → 11 (explore → train → evaluate) for a selected dataset version. Runs two experiments per methodology (baseline + fine-tune) for controlled comparison. Polls job status every 3 seconds and shows step-by-step progress and logs.

### tools/Phase2Check.tsx
Phase 2 validation panel — validates the class configuration integrity (4 classes, all keys unique) and shows per-class image counts vs 500/class targets.

---

## 4. Python ML Modules (ml/src/)

### api/main.py
FastAPI inference service (Phase 7) — loads one explicitly-identified model from `ml/models/active.json` at startup. Serves `/health`, `/model`, `/predict` (single image), `/predict/batch` (up to 100 images). Includes the pipeline router and insights router.

### api/schemas.py
Pydantic response models for the ML API: `PredictionResponse`, `HealthResponse`, `ModelInfoResponse`, and `TopKEntry`.

### api/insights_router.py
Research insights API — reads evaluation artifacts from `ml/reports/evaluation/` and prepared manifests from `ml/data/prepared/`, builds dataset insights and per-candidate model insights via the analytics engine.

### inference/pipeline.py
Automated Step 9/10/11 pipeline runner — the core ML automation. Runs as a background job: (1) refreshes exploration reports, (2) prepares manifest + preflight checks + trains each experiment candidate, (3) evaluates candidates on the isolated test set, (4) auto-registers candidates in the Node API database. Supports pilot fallback for tiny datasets.
- `POST /pipeline/start` — starts a background job; returns `{ jobId }`
- `GET /pipeline/status/{jobId}` — full step-by-step job state with logs
- `GET /pipeline/jobs` — list all known jobs

### inference/model_loader.py
Loads the active model checkpoint from `ml/models/active.json`. Returns a bundle with the model (LeafNet in eval mode), device, metadata, checkpoint data, load time, file size, and SHA-256 hash.

### inference/preprocessing.py
Inference-time image preprocessing — validates uploaded image bytes (format, dimensions, corruption), then applies the exact same transforms as training-time evaluation.

### inference/predictor.py
Model forward pass + postprocessing — runs inference on one preprocessed tensor, produces softmax probabilities for all 4 classes, top-k ranking, margin, and inference timing. Applies a configurable low-confidence review flag (threshold 0.50).

### training/train.py
Training loop with checkpointing, early stopping, and experiment reports. Sets seeds for reproducibility, manages the training/validation cycle, saves best checkpoint, and produces training reports.

### training/model.py
Model abstraction + MobileNetV2 transfer-learning factory. The `LeafNet` class wraps a pretrained backbone with a task-specific head (Dropout + Linear). `create_mobilenetv2()` builds the model with ImageNet-pretrained weights and a fresh 4-class classification head.

### training/data.py
Manifest-driven dataset preparation — fetches manifests from the Node API, assigns splits using the group-aware leakage-safe splitter, persists split assignments, and builds PyTorch Datasets with taxonomy-driven labels and augmentation (train only).

### training/preflight.py
Pre-training integrity checks — verifies all rows are APPROVED, labels are valid against the taxonomy, every class is present, splits are valid and isolated, and all referenced image files are readable. Training is refused if any check fails.

### evaluation/evaluate.py
Formal model evaluation on the held-out test set (Phase 6). Enforces test-set integrity preflight, runs identical procedure for every candidate, records full probability distributions per image, and produces accuracy, F1, precision/recall, and confusion matrix.

### data/validation.py
Image file validation — checks readability, format, dimensions, color channels, and corruption for individual images or entire directories. Produces per-file verdicts without mutating or deleting anything.

### data/deduplication.py
Duplicate detection — finds exact duplicates (SHA-256 content hashes) and near duplicates (perceptual hashing with Hamming distance threshold of 5 bits). Duplicates are NEVER deleted automatically — flagged for human review.

### data/statistics.py
Dataset statistics computation — totals, per-class counts, unlabeled counts, split distributions, missing metadata fields, and image dimension/file-size distributions from a JSONL manifest.

### data/manifest.py
Dataset manifest generation — reads and writes JSONL (JSON Lines) manifest files with standardized fields. Computes content hashes for audit.

### data/splitting.py
Group-aware, leakage-preventing dataset splitting. Target: 2000 images → train 1600 / validation 200 / test 200 (80/10/10). Images sharing a grouping key land in the SAME split. Stratified by class with a fixed seed.

### analytics/insights.py
Pure-function insights analytics engine (Phase 9). Computes dataset insights (per-class composition, imbalance ratio, shortfall analysis, split distributions) and model performance insights (per-candidate metrics, confidence behavior, confusion analysis).

### analysis/eda.py
Pure image-analysis functions for Phase 4 EDA — technical characteristics, quality metrics (brightness, contrast, sharpness), metadata completeness checks, and color-space analysis. Never modifies research files.

---

## 5. ML Standalone Scripts (ml/scripts/)

### explore_dataset.py
Phase 4 dataset exploration and quality analysis. Reads the current dataset state through the Node API, analyzes image files in place using the EDA module, and writes machine-readable reports to `ml/reports/`.
```bash
python scripts/explore_dataset.py --api http://localhost:4000
```

### evaluate.py
Phase 6 formal evaluation of candidate models on the held-out test set.
```bash
python scripts/evaluate.py --dataset-id <id> [--models v0.2_EXP-001 v0.2_EXP-002]
```

### dataset_report.py
Human-readable dataset health report — validation status, duplicate flags, manifest statistics vs the 2,000-image target, and split counts.
```bash
python scripts/dataset_report.py [manifest_path]
```

### run_experiment.py
Phase 5 experiment runner — locks a dataset version, runs preflight integrity checks, then trains the requested experiment.
```bash
python scripts/run_experiment.py --dataset-id <id> --exp EXP-001 --strategy baseline [--epochs 5] [--pilot]
```

---

## 6. Docker Automation

### docker-compose.yml
Development full-stack orchestration — PostgreSQL 16, Python ML service (port 8000), and Node API (port 4000). Frontend runs outside Docker via Vite dev server. Uses named volumes for database persistence and uploads.

### docker/ml.Dockerfile
Production Docker image for the Python ML inference service. Platform locked to linux/amd64 (PyTorch CPU wheels). Installs system deps for OpenCV, Python requirements, copies ML source/models/data, runs uvicorn on port 8000.

### docker/api.Dockerfile
Multi-stage production Docker image for Node API + React frontend. Stage 1: installs all workspace deps, generates Prisma client, builds both web (Vite) and API (TypeScript). Stage 2: slim production image with only runtime deps. On startup: runs `prisma migrate deploy` then starts the API server. Serves the built React frontend as static files from the same origin.

### docker/requirements-prod.txt
Production-only Python dependencies for the ML service. Strips dev tools from the full requirements.

---

## 7. Cloud Deployment

### render.yaml
Render Blueprint for one-click cloud deployment. Defines three services: Node API + Frontend (starter plan), Python ML Inference Service (starter plan), and managed PostgreSQL database. Estimated cost: ~$21/mo or $0 on free tier.

---

## 8. NPM Scripts (package.json)

| Command | What it does |
|---|---|
| `npm run dev:api` | Start the Express API dev server |
| `npm run dev:web` | Start the Vite React dev server |
| `npm run build` | Build all workspaces |
| `npm run db:migrate` | Run Prisma dev migrations |
| `npm run db:push` | Push Prisma schema to database |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:studio` | Open Prisma Studio GUI |

---

## 9. Configuration Files

### ml/src/config/classes.json
Single source of truth for the 4-class taxonomy. Contains approved class definitions (healthy, leaf_rust, leaf_spot, leaf_blight) with: numeric IDs, display names, categories, descriptions, visual indicators, annotation guidance, confounding conditions, evidence sources, and definition confidence levels.

### ml/src/config/training.json
Centralized training configuration — experiment defaults (image size 224x224, batch size 8, learning rates, epochs, scheduler, early stopping, dropout, freeze settings), augmentation parameters with documented rationales, and preprocessing pipeline.

### ml/src/config/pipeline.json
Pipeline configuration — dataset targets (2000 total, 500/class), supported formats, split ratios (80/10/10), random seed, augmentation settings, and quality rules.

### prisma/schema.prisma
Database schema (PostgreSQL via Prisma) defining all models: Dataset, Image, Classification, Annotation, AnnotationAudit, ModelVersion, Prediction, Feedback, ImageRelation, SystemAudit.

---

## 10. Key Automation Flows

| Flow | Trigger | Components |
|------|---------|------------|
| **Leaf Analysis** | User uploads photo in Analyzer | React → Node API (images + predictions) → Python ML (/predict) → MobileNetV2 inference → Response with probabilities |
| **ML Pipeline (Steps 9–11)** | PipelineRunner UI or POST /api/tools/pipeline/start | Node API → Python ML pipeline.py: exploration → manifest + preflight → train (baseline + fine-tune) → evaluate → auto-register candidates |
| **Bulk Ingestion** | BulkIngestTool UI or POST /api/tools/bulk-ingest | Node API: multer upload → ingestion service (validation + hashing + dedup flagging) → optional preliminary labeling |
| **Dataset Versioning** | POST /api/datasets/cut | Node API: snapshot all APPROVED images into a versioned dataset with composition counts and many-to-many membership |
| **Feedback Review Loop** | FeedbackReviewTool UI | Application users submit feedback → experts verify/reject → VERIFIED labels become candidate training data → next dataset cut includes them |
| **Model Lifecycle** | toolsFeedbackReview.ts PATCH /models/:id/lifecycle | experimental → evaluated → candidate → approved → active (deactivates others) → retired |
| **Cloud Deployment** | render.yaml Blueprint | Three services: Node API + Frontend, Python ML, PostgreSQL — auto-wired |
| **Local Dev** | docker-compose.yml | PostgreSQL + ML service + Node API containers; frontend via Vite dev server outside Docker |

---

## 11. Test Files

| File | Purpose |
|------|---------|
| `apps/api/src/domain/workflow.test.ts` | Annotation workflow state machine (12 tests) |
| `apps/api/src/domain/lifecycle.test.ts` | Model lifecycle + feedback review transitions (13 tests) |
| `apps/api/src/domain/taxonomy.test.ts` | Taxonomy enforcement (4 tests) |
| `apps/api/src/domain/composition.test.ts` | Dataset composition computation (5 tests) |
| `apps/api/src/services/ingestion.test.ts` | Image ingestion service (5 tests) |
| `ml/tests/` | ML pytest suite (59 tests) |
