# LEAFNET Application Guide

How the application fits together and how to run it locally.

## Architecture

```
React + TypeScript + Tailwind  (apps/web)
        │  /api/* (JSON)
        ▼
Node.js + TypeScript REST API  (apps/api)
        │  Prisma                    │  HTTP (ML_SERVICE_URL)
        ▼                            ▼
PostgreSQL                 Python FastAPI service  (ml/src/api)
        └────────── MobileNetV2 checkpoints (ml/models) ──────────┘
```

The React app **never** talks to the Python service directly; the Node API is
the only orchestrator and the only database writer.

## User workflow

1. **Upload** a leaf photo (drag & drop or browse; JPEG/PNG ≤ 20 MB) — Leaf Analyzer
2. **Preview** and optionally replace/remove the image
3. **Analyze Leaf** → "Analyzing your leaf image…" (honest loading state)
4. **Prediction** appears: primary class, model confidence, ranked probabilities
5. Low-confidence results are flagged ("consider consulting an expert")
6. **Feedback**: Yes / No / Unsure + optional comment — stored for Phase 9.1 review,
   never auto-applied to datasets
7. Recent analyses listed on-page and on the Dashboard

## Scope disclaimer

Every result carries: *"Visual classification suggestion only — not a laboratory
diagnosis or definitive determination of biological cause."* Confidence is the
model's predicted-class probability, not calibrated correctness.

## Local development

```bash
# terminal 1 — Python ML inference service (:8000)
cd ml && .venv/bin/python -m uvicorn src.api.main:app --port 8000

# terminal 2 — Node API (:4000)
npm run dev:api

# terminal 3 — frontend (:5173/5174)
npm run dev:web -- -- --port 5174
```

Environment: see `.env.example` (`DATABASE_URL`, `ML_SERVICE_URL`, `API_PORT`,
`UPLOAD_DIRECTORY`).

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Analyze returns "ML service not available" | Start the uvicorn service (terminal 1) |
| `/health` says unhealthy | No active model configured in `ml/models/active.json` |
| Upload fails 413/422 | File too large or unsupported format — see limits above |
| Dashboard shows zeros | Honest empty state: acquire and approve images first |

## Security notes

Uploads restricted to JPEG/PNG ≤20 MB · MIME + dimension validation server-side ·
in-memory rate limiting (30 predictions/min/IP) · safe generated filenames ·
no internal paths/URLs exposed to clients · ML responses validated before persistence ·
feedback can never alter ground truth automatically.
