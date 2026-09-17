# 🍃 Mulberry Leaf Intelligence (LEAFNET)

LEAFNET (Mulberry Leaf Intelligence) is a full-stack machine-learning
application that visually classifies mulberry leaf health into four classes —
**Healthy, Leaf Rust, Leaf Spot, Leaf Blight** — from photographs. It was built
as a masteral research project across ten disciplined phases: research data
foundation → MobileNetV2 transfer learning → formal evaluation → inference
service → application → feedback/monitoring → hardening.

Built as a real app, not a throwaway notebook: dataset management, model
versioning, prediction with calibrated confidence scores, and human feedback
that feeds future retraining.

## Status

🟢 **System complete and verified end-to-end.**

- **Dataset:** V1.0 — 2,000 images, 500 per class, all expert-approved
  (preliminary annotate → expert confirm, full audit trail).
- **Active model:** `V1.0_r2_EXP-V1.0-FT` (MobileNetV2 fine-tune) — lifecycle
  `active`, serving live predictions.
- **Evaluation** (test n=200): accuracy **0.845**, macro F1 **0.85**.
- **Explainability:** input-gradient saliency (`POST /explain`) rendered as a
  "why did it say that?" heatmap in the Analyzer.
- **Full pipeline exercised:** intake → validate → classify → expert review →
  split → train → evaluate → register → activate, with monitoring and feedback.

> **Honest caveats:** zero dataset rows carry grouping keys, so a truly grouped
> (leaf-correlated) split is impossible — all models are labeled **PILOT** and
> metrics "carry no statistical significance at this size" (**n=200**). The
> classifier is **single-label** (4-way softmax); it does not detect
> co-infections. See `docs/PHASE_10_STATUS.md`.

## Architecture

```
React Frontend (apps/web)
        │  REST /api/*
        ▼
Node.js API (apps/api) ── Prisma ──► PostgreSQL
        │  HTTP only (ML_SERVICE_URL)
        ▼
Python ML Service (ml/src/inference, FastAPI) ──► PyTorch Model
```

The frontend never talks to Python directly; the API never spawns Python.
See [docs/architecture.md](docs/architecture.md).

ML service endpoints (`:8000`): `GET /health`, `GET /model`,
`POST /predict`, `POST /explain` (saliency heatmap), `POST /predict/batch`.

## Project structure

```
├── apps/
│   ├── web/          React + Vite + Tailwind frontend
│   └── api/          Express + TypeScript + Prisma REST API
├── ml/               Independent Python ML layer
│   ├── data/         incoming / validated / prepared split manifests
│   ├── models/       versioned model artifacts (gitignored; see active.json)
│   ├── reports/      evaluation metrics, confusion matrices, saliency
│   ├── src/config/   classes.json + training.json + pipeline.json
│   ├── src/data/     ingestion, validation, dedup, splitting, statistics
│   ├── src/training/ MobileNetV2 transfer-learning (LeafNet)
│   ├── src/evaluation/
│   └── src/inference/ FastAPI service: predict, explain (saliency), model_loader
├── prisma/schema.prisma
├── docs/             phase reports, architecture, dataset, lifecycle, deployment
└── .env.example
```

## Technology stack

- **Frontend:** TypeScript, React, Tailwind CSS (responsive)
- **API:** Node.js + TypeScript + Express + Prisma ORM
- **Database:** PostgreSQL
- **ML:** Python 3.11+, PyTorch, torchvision, Pillow, NumPy, pandas, scikit-learn, FastAPI, matplotlib (saliency rendering)

## Local development setup

### 1. Prerequisites
Node.js 20+, Python 3.11+, a running PostgreSQL instance.

```bash
cp .env.example .env      # then edit DATABASE_URL for your Postgres
npm install               # installs web + api workspaces
```

### 2. Database

```bash
npm run db:migrate        # creates tables from prisma/schema.prisma (incl. auth)
```

### 2b. Populate everything (recommended — zero manual data entry)

Seeds demo users, all 2,000 dataset images, the v1.0 dataset row, and the
registered model versions (metrics + acceptance verdict) from the committed
artifacts, then writes `ml/models/active.json`:

```bash
npm run seed:everything --workspace @mulberry/api
```

Idempotent — safe to re-run. Honors `UPLOAD_DIRECTORY` and `ACTIVE_MODEL`
(e.g. `ACTIVE_MODEL=v1.0_EXP-1.0-FT`).

### 3. Start the ML service (port 8000)

```bash
cd ml
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn src.api.main:app --port 8000
```

The service loads the model named in `ml/models/active.json`. Note: it has no
`--reload`; restarting it also stops any running pipeline job (jobs run in the
same process).

### 4. Start the API (port 4000)

```bash
npm run dev:api
```

### 5. Start the frontend (port 5173)

```bash
npm run dev:web
```

Open http://localhost:5173 — the Vite dev server proxies `/api/*` to the API.

## Web application

- **Analyzer** — upload a leaf photo, get a 4-class prediction with confidence,
  per-class probabilities, margin, and a **"Why did the model say this?"**
  saliency heatmap vs. the runner-up class. Send agree/disagree/unsure feedback.
- **Insights** — confusion matrix, per-class precision/recall/F1, difficult cases.
- **Models** — model registry with lifecycle
  (experimental → evaluated → candidate → approved → active).
- **Dataset / Dashboard** — approval coverage and per-class counts.
- **Tools** — bulk ingest, labeling, review, feedback review, monitoring,
  pipeline runner (baseline + fine-tune experiments with live epoch progress),
  and phase-2 data-quality checks.

## Model lifecycle & review

- Every prediction ships a confidence and a recommended-review flag
  (`confidence < 0.50`) — never an automatic verdict. An expert decides.
- Model registration records accuracy, F1, confusion matrix, and an integrity
  audit; only an expert can promote a model to `active`.
- Ground-truth labels come only from humans; the full annotation audit trail
  (`preliminary_annotate` → `review_confirm`) is stored per image.

## Current limitations (honest)

- ☐ **PILOT-grade models** — no grouped split possible (no group keys in the
  dataset), so split leakage between leaves cannot be excluded.
- ☐ **Statistical significance** — test n=200 is the research target, but
  metrics at this size are formally computed, not statistically proven.
- ☐ **Single-label only** — softmax is exclusive (classes sum to 1); the system
  cannot classify a co-infection. Multi-label support is a known future change
  (taxonomy + re-annotation + sigmoid head).
- ☐ **Confidence ≠ calibration** — probabilities reflect the model's score
  distribution, not true likelihood of correctness.
- ✅ Four-class taxonomy is config-driven
  (`ml/src/config/classes.json`; changing it requires methodology approval).

## Development principles

No fabricated predictions/metrics/datasets · unfinished features stay visible
· clear TODO(phase:) markers · modular ML code · strict separation between
frontend, backend, and ML · strong typing · simple architecture first.

## Documentation

| Topic | Document |
|---|---|
| Architecture & MobileNetV2 | `docs/architecture.md`, `docs/model-architecture.md` |
| Dataset design | `docs/dataset.md`, `docs/dataset-versioning.md` |
| ML API contract | `docs/ml-api.md` |
| Application guide | `docs/application.md` |
| Insights & analytics | `docs/insights.md`, `docs/analytics-methodology.md` |
| Model acceptance (Objective 4) | `docs/acceptance-criteria.md` |
| Feedback / monitoring / lifecycle | `docs/feedback-and-review.md`, `docs/model-monitoring.md`, `docs/model-lifecycle.md`, `docs/continuous-learning.md` |
| Deployment & checklist | `docs/deployment.md`, `docs/deployment-checklist.md` |
| Reproducibility & limitations | `docs/reproducibility.md`, `docs/limitations.md` |
| Research handoff | `research-handoff/README.md`, `docs/research-traceability-matrix.md`, `docs/manuscript-implementation-check.md` |
| Phase reports | `docs/PHASE_{1..10}_STATUS.md`, `docs/PHASE_10_FINAL_STATUS.md` |
| Operating guides | `BULK_UPLOAD.MD`, `decom_beta.md` |