#!/usr/bin/env bash
# Clean slate — wipe local LEAFNET data back to a pristine pre-upload state.
#
# Deletes (keeping .gitkeep / git-tracked config):
#   - Postgres tables: feedback, predictions, annotations, classifications,
#     annotation_audits, image_relations, images, datasets,
#     model_versions, system_audits   (RESTART IDENTITY CASCADE)
#   - apps/api/uploads/*               (uploaded images)
#   - ml/models/*                      (checkpoints, active.json)
#   - ml/data/* subdirs                (incoming/raw/processed/prepared/train/
#                                      validation/test/validated/rejected)
#   - ml/reports top-level artifacts   (dataset_summary.json, *.csv)
#
# Does NOT touch: prisma/migrations, docs/, .gitkeep, evaluation/experiments/
# saliency/sweeps report subdirs, docker containers, .env. Local-only — has no
# effect on Render (all wiped paths are runtime-excluded by .dockerignore).
#
# Usage:  bash scripts/clean_slate.sh        (prompts for confirmation)
#         bash scripts/clean_slate.sh -y     (non-interactive)

set -euo pipefail

ASSUME_YES=0
for arg in "$@"; do
  [ "$arg" = "-y" ] || [ "$arg" = "--yes" ] && ASSUME_YES=1
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TABLES=(
  feedback
  predictions
  annotations
  classifications
  annotation_audits
  image_relations
  images
  datasets
  model_versions
  system_audits
)

DATA_DIRS=(
  apps/api/uploads
  ml/models
  ml/data/incoming
  ml/data/raw
  ml/data/processed
  ml/data/prepared
  ml/data/train
  ml/data/validation
  ml/data/test
  ml/data/validated
  ml/data/rejected
)

# Top-level generated report artifacts (kept: evaluation/ experiments/ saliency/ sweeps/)
REPORT_ARTIFACTS=(
  ml/reports/class_distribution.csv
  ml/reports/dataset_summary.json
  ml/reports/duplicate_candidates.csv
  ml/reports/image_quality.csv
  ml/reports/leakage_candidates.csv
  ml/reports/metadata_completeness.csv
  ml/reports/outliers.csv
)

db_counts() {
  node -e '
    require("dotenv").config();
    const { PrismaClient } = require("@prisma/client");
    const p = new PrismaClient();
    const tables = process.env.TABLES.split(",");
    (async () => {
      const out = {};
      for (const t of tables) {
        const [{ n }] = await p.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${t}"`);
        out[t] = n;
      }
      const total = Object.values(out).reduce((a, b) => a + b, 0);
      console.log(JSON.stringify({ rows: out, total }));
    })().catch((e) => { console.error(e.message); process.exit(1); })
      .finally(() => p.$disconnect());
  '
}

count_files() {
  local d="$1"
  [ -d "$d" ] && find "$d" -type f ! -name .gitkeep | wc -l | tr -d " " || echo 0
}

# 1. Reachability guard — refuse to run if the DB is unreachable.
if ! printf 'SELECT 1;\n' | npx prisma db execute --schema prisma/schema.prisma --stdin >/dev/null 2>&1; then
  echo "ERROR: cannot reach the local database (prisma db execute failed). Aborting." >&2
  exit 1
fi

BEFORE=$(TABLES="$(IFS=,; echo "${TABLES[*]}")" db_counts)
BEFORE_ROWS=$(node -e "console.log(JSON.parse(process.argv[1]).total)" "$BEFORE")
FILE_COUNT=0
for d in "${DATA_DIRS[@]}" "${REPORT_ARTIFACTS[@]}"; do
  FILE_COUNT=$((FILE_COUNT + $(count_files "$d")))
done

# 2. Confirm.
if [ "$ASSUME_YES" = 0 ]; then
  echo "Clean slate will PERMANENTLY wipe local data (keeping only .gitkeep files):"
  echo "  - Postgres tables (${BEFORE_ROWS} rows total): ${TABLES[*]}"
  echo "  - ${FILE_COUNT} files under: apps/api/uploads, ml/models, ml/data/*, ml/reports (top-level artifacts)"
  echo ""
  read -r -p "Type 'clean' to continue: " ans
  [ "$ans" = "clean" ] || { echo "Aborted."; exit 1; }
fi

# 3. DB wipe.
QUOTED=""
for t in "${TABLES[@]}"; do QUOTED="$QUOTED \"$t\","; done
QUOTED="${QUOTED%,}"
SQL="TRUNCATE TABLE $QUOTED RESTART IDENTITY CASCADE;"
printf '%s\n' "$SQL" | npx prisma db execute --schema prisma/schema.prisma --stdin

# 4. Filesystem wipe.
REMOVED=0
for d in "${DATA_DIRS[@]}"; do
  [ -d "$d" ] || continue
  N=$(count_files "$d")
  if [ "$N" -gt 0 ]; then
    find "$d" -type f ! -name .gitkeep -delete
    REMOVED=$((REMOVED + N))
  fi
done
for f in "${REPORT_ARTIFACTS[@]}"; do
  [ -f "$f" ] || continue
  rm -f "$f"
  REMOVED=$((REMOVED + 1))
done

# 5. Summary.
AFTER=$(TABLES="$(IFS=,; echo "${TABLES[*]}")" db_counts)
AFTER_ROWS=$(node -e "console.log(JSON.parse(process.argv[1]).total)" "$AFTER")
echo "Clean slate complete:"
echo "  database rows:  $BEFORE_ROWS -> $AFTER_ROWS"
echo "  files removed:  $REMOVED"