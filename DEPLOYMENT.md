# LEAFNET — Deployment Guide

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         Render Deployment                        │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │   Leafnet    │    │  Node API    │    │  Python ML       │   │
│  │   Web App    │───▶│  (Express)   │───▶│  (FastAPI)       │   │
│  │   React SPA  │    │  Port 4000   │    │  Port 8000       │   │
│  │   TailwindCSS│    │  Prisma ORM  │    │  PyTorch CPU     │   │
│  └──────────────┘    └──────┬───────┘    └──────────────────┘   │
│                             │                                    │
│                      ┌──────▼──────┐                             │
│                      │ PostgreSQL  │                             │
│                      │ (managed)   │                             │
│                      └─────────────┘                             │
└──────────────────────────────────────────────────────────────────┘
```

**Key design decisions:**
- The Node API serves the React frontend from the same origin (relative `/api` paths)
- The Python ML service is only accessible internally (via Render's private proxy)
- Prisma migrations run automatically on every API start
- Uploads are persisted to a 1GB disk volume

---

## Quick Start (Render Blueprint)

1. Push this repo to GitHub
2. On Render: **New** → **Infrastructure from Blueprint**
3. Connect your GitHub repo
4. Render reads `render.yaml` and provisions all services
5. Set environment variables (see below)
6. Deploy

**Estimated cost:** ~$21/month (3 starter plans) or $0 on free tier.

---

## Environment Variables

### Node API (`leafnet-api`)

| Variable | Source | Description |
|---|---|---|
| `NODE_ENV` | `production` | Enables static file serving for frontend |
| `DATABASE_URL` | Auto from `leafnet-db` | PostgreSQL connection string |
| `ML_SERVICE_URL` | Auto from `leafnet-ml` | Internal URL for Python ML service |
| `WEB_ORIGIN` | Manual (optional) | Comma-separated allowed CORS origins |
| `UPLOAD_DIRECTORY` | `/var/data/uploads` | Persistent disk mount point |

### Python ML (`leafnet-ml`)

| Variable | Source | Description |
|---|---|---|
| `ML_PORT` | `8000` | Port for FastAPI inference service |

---

## Manual Deployment (without Blueprint)

### 1. Create PostgreSQL database
```bash
# On Render dashboard:
# New → PostgreSQL → Name: leafnet-db → Plan: Starter
# Note the Internal Database URL
```

### 2. Deploy Python ML service
```bash
# New → Web Service → Docker
# Dockerfile: docker/ml.Dockerfile
# Docker Context: .
# Plan: Starter
# Health Check Path: /health
```

### 3. Deploy Node API
```bash
# New → Web Service → Docker
# Dockerfile: docker/api.Dockerfile
# Docker Context: .
# Plan: Starter
# Health Check Path: /api/health
# Disk: 1GB mount at /var/data/uploads
#
# Environment Variables:
#   NODE_ENV=production
#   DATABASE_URL=<from leafnet-db>
#   ML_SERVICE_URL=http://leafnet-ml:10000  (internal URL)
```

---

## Database Setup

The PostgreSQL database is managed by Render. Schema migrations run automatically:

```bash
# On every API start (handled in Dockerfile CMD):
npx prisma migrate deploy --schema prisma/schema.prisma
```

For manual migrations during development:
```bash
# Connect to the database:
psql <DATABASE_URL>

# Or use Prisma:
npx prisma migrate dev --schema prisma/schema.prisma
```

---

## Model Training Pipeline

Training happens locally (not on Render). The workflow:

1. **Upload images** via the web UI (Tools → Bulk Ingest)
2. **Annotate** with expert review (Tools → Expert Review)
3. **Cut dataset version** (Tools → Dataset Status → Cut)
4. **Train locally:**
   ```bash
   cd ml
   python -m src.training.train --config src/config/training.json
   ```
5. **Evaluate locally:**
   ```bash
   python -m src.evaluation.evaluate --model models/<version>/checkpoint.pt
   ```
6. **Register model** via API or UI (Tools → Model Register)
7. **Promote to active** ( Models → Promote)

The active model is stored at `ml/models/active.json` and loaded by the ML service on startup.

---

## Local Development

```bash
# Install dependencies
npm install

# Start PostgreSQL (via Docker Compose)
docker compose up -d db

# Run migrations
npx prisma migrate dev

# Start API (port 4000)
npm run dev:api

# Start ML service (port 8000)
cd ml && .venv/bin/python -m uvicorn src.api.main:app --port 8000

# Start frontend (port 5174)
npm run dev:web
```

Or use Docker Compose for everything:
```bash
docker compose up -d
```

---

## Project Structure

```
leafnet/
├── apps/
│   ├── api/                 # Node.js Express API
│   │   ├── src/server.ts    # Entry point (serves frontend in production)
│   │   ├── src/routes/      # API route handlers
│   │   └── src/domain/      # Business logic (state machines, lifecycle)
│   └── web/                 # React + Tailwind frontend
│       ├── src/pages/       # Dashboard, Models, Insights, Tools
│       └── src/lib/api.ts   # API client (relative /api paths)
├── ml/                      # Python ML service
│   ├── src/
│   │   ├── api/main.py      # FastAPI inference service
│   │   ├── training/        # MobileNetV2 transfer learning
│   │   ├── evaluation/      # Test-set evaluation
│   │   ├── inference/       # Model loading + prediction
│   │   ├── analytics/       # Research insights engine
│   │   └── config/          # classes.json, training.json
│   ├── models/              # Checkpoints + active.json
│   └── reports/             # Evaluation + experiment artifacts
├── prisma/                  # Database schema
├── docker/                  # Dockerfiles (api, ml)
├── docs/                    # System documentation
├── render.yaml              # Render blueprint
└── docker-compose.yml       # Local development
```

---

## Current State (Post-Pilot Clean Slate)

### What exists
- **421 approved research images** (all labeled ground truth)
  - healthy: 2 | leaf_rust: 3 | leaf_spot: 413 | leaf_blight: 3
  - **Heavily imbalanced** — leaf_spot is 98% of the dataset
- Complete 10-phase system (scaffold → hardening)
- 39 vitest + 59 pytest tests passing
- Research insights analytics (Phase 9)
- Feedback review + monitoring + lifecycle (Phase 9.1)

### What was deleted (pilot artifacts)
- 4 dataset versions (v0.1, v0.2, v1.0, v1.1)
- 4 model versions + all checkpoints
- Evaluation/experiment artifacts
- Prepared split manifests
- All 421 research images + files (wiped for fresh start)
- All 20 dev fixtures + files

### What needs to happen next
1. **Balance the dataset** — acquire more healthy, leaf_rust, leaf_blight images
2. **Bulk upload** real images via Tools → Bulk Ingest
3. **Expert review** each batch (use "Confirm all" dialog for speed)
4. **Cut dataset version** when balanced
5. **Train** with real data (Pipeline Runner or manual)
6. **Evaluate** — expect better results than pilot
7. **Promote** to active model

### Known issues
- `annotations.ts` has pre-existing Prisma enum type errors (non-blocking)
- ML service starts "unhealthy" (no active model) — honest, not fake
- Balance banner stays red/critical until dataset is balanced

---

## Cost Estimate (Render)

| Service | Plan | Monthly Cost |
|---|---|---|
| leafnet-api (Node) | Starter | $7 |
| leafnet-ml (Python) | Starter | $7 |
| leafnet-db (PostgreSQL) | Starter | $7 |
| **Total** | | **$21/mo** |

Free tier is available for demo/thesis defense (services spin down after 15 min inactivity, wake on request).

---

## Troubleshooting

### ML service unhealthy
- Normal if no model is trained yet
- Check `ml/models/active.json` exists and points to a valid checkpoint
- Check ML service logs on Render dashboard

### API can't connect to database
- Verify `DATABASE_URL` is set (auto-populated by Render blueprint)
- Check PostgreSQL service is running on Render dashboard

### Frontend shows blank page
- Check that `NODE_ENV=production` is set on the API service
- Verify `apps/web/dist/` was built during Docker build

### Upload fails
- Check disk is mounted at `/var/data/uploads`
- Verify `UPLOAD_DIRECTORY` env var matches mount path
