# How to run LEAFNET locally

Development full-stack for the Mulberry Leaf Intelligence app: a React frontend
(Vite), a Node/Express API, a Python (FastAPI) ML inference service, and
PostgreSQL.

```
Browser ──> Vite (dev)   http://localhost:5173
                └─ /api proxy ──> Node API        http://localhost:4000
                                      └─> Python ML service  http://localhost:8000
                                      └─> PostgreSQL         localhost:5432
```

## Prerequisites

| Thing | Requirement | Notes |
|---|---|---|
| Node | v20+ (nvm suggests this repo's node) | `node --version` |
| Python | 3.11+ | venv already exists at `ml/.venv` |
| PostgreSQL | running on `localhost:5432` | native/Homebrew here; `docker-compose.yml` is an alternative if you have Docker (this machine does not) |
| `.env` | at repo root | already present; if missing, `cp .env.example .env` and fill `DATABASE_URL` / `POSTGRES_PASSWORD` |

## One-time setup

```bash
# 1. Node deps (installs all workspaces: api + web + tooling)
npm install

# 2. Python deps (into the existing venv)
ml/.venv/bin/pip install -r ml/requirements.txt
```

### 3. DB env for the API (important — see "The .env quirk" below)

The API loads `dotenv/config`, i.e. it reads `.env` from its **working
directory**. `npm run dev:api` runs workspace scripts with `cwd = apps/api`,
so it looks for `apps/api/.env`. Link the root `.env` there once:

```bash
ln -s ../../.env apps/api/.env
```

(Or copy it instead of symlinking. Either works. This keeps `UPLOAD_DIRECTORY=./uploads`
resolving to `apps/api/uploads`, which is where images are stored and where
`scripts/clean_slate.sh` wipes.)

### 4. Database schema

Ensure the schema exists (idempotent; the DB already has tables on this machine):

```bash
npx prisma migrate deploy --schema prisma/schema.prisma   # fresh DB
# or, for dev iteration on schema changes:
npm run db:push
```

After editing `prisma/schema.prisma`, regenerate the client with `npm run db:generate`.

### 5. Note on models

There is currently **no trained model** (clean slate). The ML service still
starts; its `/health` will report `healthy` on a fresh process but `/predict`
and `/explain` need a registered, activated model in `ml/models/` + `active.json`.
You can run the full UI without one — predictions just won't work until you
train/register/promote a model.

## Start the stack (one terminal each, from the repo root)

### Terminal 0 — PostgreSQL

```bash
pg_isready -h localhost -p 5432     # expect: accepting connections
# if not running:
brew services start postgresql@16   # or postgresql@14/@15, whatever you installed
```

### Terminal 1 — Node API (`:4000`)

```bash
npm run dev:api
```

`tsx watch` auto-restarts on file changes. Verify: `curl http://localhost:4000/api/health`

### Terminal 2 — Python ML service (`:8000`)

```bash
cd ml
.venv/bin/python -m uvicorn src.api.main:app --port 8000 --reload
```

Verify: `curl http://localhost:8000/health`

### Terminal 3 — Web dev server (Vite, `:5173`)

```bash
npm run dev:web
```

Open **http://localhost:5173** → **Leaf Analyzer** is the main journey
(upload → analyze → predict → explanation → feedback).

## Verify it's all wired

```bash
curl -s http://localhost:4000/api/health
# {"status":"ok","service":"leafnet-api","mlServiceConnected":true|false,...}

curl -s http://localhost:8000/health
# {"status":"healthy|unhealthy","model_loaded":false,...}   <- model_loaded=false until you add a model
```

Then in the UI: Tools → LabelTool to ingest images, ReviewTool to confirm
labels, Dataset tools to cut/prepare, Explorer for analysis. The whole loop is
local (DB, uploads, ML).

## Day-to-day

- **Stop:** Ctrl-C each terminal. `tsx watch` may leave a child process — stop it too.
- **Restart everything after a clean slate**: API, ML, and web keep running, but
  restart **ML** so it reloads `active.json` — otherwise it keeps serving the
  stale model it loaded before the wipe.
- **Reset all data** (mistaken labels, want a clean re-upload):

  ```bash
  bash scripts/clean_slate.sh        # asks for confirmation
  bash scripts/clean_slate.sh -y     # non-interactive
  ```

  Wipes Postgres tables + `apps/api/uploads/*` + `ml/models/*` + `ml/data/*` +
  stale `ml/reports` artifacts. Local-only; doesn't touch Render.
- **Serve the built web app from the API** (prod-style, single port `:4000`):

  ```bash
  npm run build --workspace @mulberry/web
  ```

  Then browse `http://localhost:4000` directly. Build again after web changes.
- **Run tests / check types:**

  ```bash
  npm run build --workspaces --if-present      # tsc for api + web
  cd ml && .venv/bin/python -m pytest          # ML tests
  ```

## The `.env` quirk (why setup step 3 exists)

`import "dotenv/config"` in `apps/api/src/server.ts` reads `.env` from
`process.cwd()`. npm workspace scripts run with `cwd = apps/api`, **not** the
repo root — so plain `npm run dev:api` won't see the root `.env`, and Prisma
fails with "Environment variable not found: DATABASE_URL". The `apps/api/.env`
symlink fixes it cleanly.

Alternative without the symlink — run the API from the repo root directly:

```bash
npx tsx watch apps/api/src/server.ts
```

Root cwd loads the root `.env`. Caveat: `UPLOAD_DIRECTORY=./uploads` then
resolves to `<root>/uploads` instead of `apps/api/uploads`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `mlServiceConnected:false` in `/api/health` | ML service down on `:8000`, or `ML_SERVICE_URL` wrong in `.env`. Start it; check `curl :8000/health`. |
| Prisma "Environment variable not found: DATABASE_URL" | The `.env` quirk — do setup step 3 (`apps/api/.env`), or run the API from repo root. |
| `/predict` returns 4xx/5xx | No active model after clean slate. Register/activate a model (`ml/models` + `active.json`), then restart ML. |
| `/health` reports a stale model version | ML still holds the pre-clean-slate model in memory — restart the ML process. |
| Port 4000/8000/5173 already in use | Another instance is running. Kill it, or change `API_PORT`/`uvicorn --port`. |
| Vite page loads but API calls fail | Vite only proxies `/api` → `:4000` (see `apps/web/vite.config.ts`). Ensure the API is on `4000`. |
| Postgres down → 500s on DB routes | `pg_isready`; start Postgres (Homebrew: `brew services start postgresql@16`). |
| API logs say nothing / watch reloads twice | Multiple `tsx watch` processes — kill extras from earlier terminals. |