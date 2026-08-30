## What is LEAFNET?

LEAFNET (Mulberry Leaf Intelligence) is a full-stack machine-learning
application that visually classifies mulberry leaf health into four classes —
**Healthy, Leaf Rust, Leaf Spot, Leaf Blight** — from photographs. It was built
as a masteral research project across ten disciplined phases: research data
foundation → MobileNetV2 transfer learning → formal evaluation → inference
service → application → feedback/monitoring → hardening.

**Status:** system complete and verified; the research dataset (11 of 2,000
target images) is still being acquired, so model metrics to date are
pilot-scale and honestly labeled as such. See `docs/PHASE_10_STATUS.md`.

# 🍃 Mulberry Leaf Intelligence

A learning-oriented, production-style ML application that classifies the
health condition of mulberry leaves from photographs — built as a real app,
not a throwaway notebook.

## What problem does it solve?

Mulberry growers need to quickly identify unhealthy leaves (disease,
nutrient deficiency, physical damage). This project builds a supervised image
classifier and wraps it in a full application: dataset management, model
versioning, prediction with confidence scores, and human feedback that feeds
future retraining.

> **Current status: scaffold only.** No dataset exists, no model has been
> trained, no metrics exist. Everything unfinished is clearly marked.

## Architecture

```
React Frontend (apps/web)
        │  REST /api/*
        ▼
Node.js API (apps/api) ── Prisma ──► PostgreSQL
        │  HTTP only (ML_SERVICE_URL)
        ▼
Python ML Service (ml/src/inference) ──► PyTorch Model
```

The frontend never talks to Python directly; the API never spawns Python.
See [docs/architecture.md](docs/architecture.md).

## Project structure

```
├── apps/
│   ├── web/          React + Vite + Tailwind frontend
│   └── api/          Express + TypeScript + Prisma REST API
├── ml/               Independent Python ML layer
│   ├── data/         raw / processed / train / validation / test (gitignored)
│   ├── models/       versioned model artifacts (v0.1, …)
│   ├── notebooks/    exploration
│   ├── src/config/   classes.json + pipeline.json (change behavior here)
│   ├── src/data/     ingestion, validation, dedup, splitting, statistics
│   ├── src/preprocessing/
│   ├── src/training/
│   ├── src/evaluation/
│   ├── src/inference/  future FastAPI service boundary
│   └── scripts/
├── prisma/schema.prisma
├── docs/             architecture, dataset design, ML roadmap, model card template
├── scripts/
└── .env.example
```

## Technology stack

- **Frontend:** TypeScript, React, Tailwind CSS (responsive)
- **API:** Node.js + TypeScript + Express + Prisma ORM
- **Database:** PostgreSQL
- **ML:** Python 3.11+, PyTorch, torchvision, OpenCV, Pillow, NumPy, pandas, scikit-learn

## Local development setup

### 1. Prerequisites
Node.js 20+, Python 3.11+, a running PostgreSQL instance.

```bash
cp .env.example .env      # then edit DATABASE_URL for your Postgres
npm install               # installs web + api workspaces
```

### 2. Database

```bash
npm run db:migrate        # creates tables from prisma/schema.prisma
```

### 3. Start the API (port 4000)

```bash
npm run dev:api
```

### 4. Start the frontend (port 5173)

```bash
npm run dev:web
```

Open http://localhost:5173 — the Vite dev server proxies `/api/*` to the API.

### 5. Python ML environment (for later phases)

```bash
cd ml
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Model architecture

How MobileNetV2 transfer learning is implemented, where the code lives, and the
end-to-end data flow: see `docs/model-architecture.md`.

## Planned ML workflow

Raw images → validation → deduplication → preprocessing → stratified
train/validation/test split → augmentation → transfer-learning training
(MobileNet/EfficientNet via a swappable `Model` abstraction) → evaluation →
versioned deployment → predictions → user feedback → continuous improvement.
Details: [docs/ml-roadmap.md](docs/ml-roadmap.md).

## Current limitations (intentional)

- ❌ Image upload endpoint not implemented (`POST /api/images` → 501)
- ❌ No ML inference service; predictions return 503 placeholders
- ❌ No dataset collected or labeled
- ❌ No trained models or evaluation metrics anywhere
- ✅ Class definitions are conceptual, config-driven, and changeable

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
| Feedback / monitoring / lifecycle | `docs/feedback-and-review.md`, `docs/model-monitoring.md`, `docs/model-lifecycle.md`, `docs/continuous-learning.md` |
| Deployment & checklist | `docs/deployment.md`, `docs/deployment-checklist.md` |
| Reproducibility & limitations | `docs/reproducibility.md`, `docs/limitations.md` |
| Research handoff | `research-handoff/README.md`, `docs/research-traceability-matrix.md`, `docs/manuscript-implementation-check.md` |
| Phase reports | `docs/PHASE_{1..10}_STATUS.md` |
| Operating guides | `BULK_UPLOAD.MD`, `decom_beta.md` |
