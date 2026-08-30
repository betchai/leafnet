# Deployment Guide

## Prerequisites
Node.js 20+ · Python 3.11+ · PostgreSQL 14+ · (optional) Docker + Compose

## Environment variables
Copy `.env.example` → `.env`. Required:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `API_PORT` | Node API port (default 4000) |
| `ML_SERVICE_URL` | Python inference service URL |
| `UPLOAD_DIRECTORY` | where uploaded images are stored |
| `WEB_ORIGIN` | **production**: allowed browser origin(s) for CORS |

Production additionally: strong `POSTGRES_PASSWORD`, `NODE_ENV=production`.
Never commit `.env`.

## Option A — Docker Compose (recommended for deployment)

```bash
export POSTGRES_PASSWORD=<strong-password>
docker compose up -d --build          # db + ml + api
# first run: apply migrations
docker compose exec api npx prisma migrate deploy \
  --schema prisma/schema.prisma
```

Frontend production build:
```bash
npm run build --workspace @mulberry/web   # outputs apps/web/dist/
# serve dist/ with any static host / reverse proxy routing /api → api:4000
```

Health checks: `GET :4000/api/health` · `GET :8000/health`

### Rollback
Models are versioned; activating a previous approved model restores behavior
(`PATCH /api/tools/models/:id/lifecycle`). The API container is stateless —
redeploy the previous image tag to roll back code.

## Option B — Local development

```bash
cp .env.example .env                    # edit DATABASE_URL
npm install
npm run db:migrate                      # or db:push for prototypes

cd ml && python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# three terminals:
.venv/bin/python -m uvicorn src.api.main:app --port 8000   # ML service
npm run dev:api                                            # Node API
npm run dev:web -- -- --port 5174                          # frontend
```

## Database backup / recovery

```bash
pg_dump "$DATABASE_URL" > leafnet_backup_$(date +%F).sql     # backup
psql "$DATABASE_URL" < leafnet_backup_2026-01-01.sql         # restore
```
Also back up `uploads/` (original images) and `ml/models/` (artifacts) — these
are not in PostgreSQL. Research integrity requires all three stores.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Analyzer: "ML service not available" | start uvicorn (terminal 1) |
| `/health` unhealthy | check `ml/models/active.json` points at an existing model dir |
| DB connection errors | verify PostgreSQL running + DATABASE_URL |
| CORS errors in browser | set WEB_ORIGIN to your frontend origin, restart API |
