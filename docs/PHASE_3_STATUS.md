# Phase 3 Status — Dataset Acquisition, Annotation & Validation

**Date:** 2026-08-23
**Model training performed:** **NONE** (strict boundary held — no MobileNetV2 weights, no training, no predictions, no metrics)

---

## 1. Dataset status (live truth, nothing fabricated)

| Metric | Count |
|---|---|
| Research images acquired | **0** |
| Validated | 0 |
| Annotated | 0 |
| Expert verified | 0 |
| Approved | **0** |
| Rejected | 0 |
| Uncertain | 0 |
| Needs review | 0 |
| Dev fixtures in DB (excluded from research counts) | 4 |

The system was exercised end-to-end with clearly-marked `DEVFIX_*` synthetic
images (`isDevFixture=true`); these are excluded from every research metric by
construction and can be purged at any time without touching research state.

## 2. Class status

All four classes at 0/500 acquired · 0/500 approved:

healthy 0 · leaf_rust 0 · leaf_spot 0 · leaf_blight 0

Tracked live via `GET /api/datasets/status` (acquired/annotated/verified/
approved/rejected/uncertain per class + imbalance warnings that explicitly
forbid duplication as a fix).

## 3. Annotation status

Workflow implemented and enforced end-to-end:
UNLABELED → NEEDS_REVIEW → ANNOTATED → EXPERT_REVIEWED → APPROVED
(+ REJECTED / SECOND_OPINION / UNCERTAIN).

Verified behaviors (live API smoke test):
- Preliminary annotation restricted to the 4 approved keys; `diseased` → **422**
- Annotator attempting review → **403**
- Expert confirm without preliminary label → **409**
- Expert confirm → APPROVED + Classification ground-truth row created
- Post-approval relabel → **409** (terminal state)
- Full audit trail written: actor, role, previous/new label, previous/new status, timestamp, reason

## 4. Data quality

- Technical validation gate on ingest: format/size checks before persistence; unsupported → 415.
- Exact duplicates: detected via SHA-256; **preserved and flagged** into NEEDS_REVIEW with an `ImageRelation` row (a real bug was found here during testing — the schema initially forbade duplicate hashes and was corrected).
- Near-duplicates: Python perceptual-hash tooling flags candidates for review (`ml/src/data/deduplication.py`, needs `imagehash`); relations recorded, never auto-deleted.
- Metadata completeness: all Phase-2 optional fields persisted as explicit nulls when missing; never fabricated.
- Automated tests caught and fixed two genuine defects (see §7).

## 5. Provenance

Per-image provenance persisted: original filename, source, source_type,
license, capture metadata, grouping keys (plant/leaf/farm/session), dataset
version linkage, full annotation/review history via append-only
`AnnotationAudit`. External-source requirements remain governed by
[docs/data-sources.md](data-sources.md) — no external data incorporated yet.

## 6. Dataset version

Current version: **none cut yet** (v0.x will be created when the first batch of
approved research images exists). Manifest endpoint implemented:
`GET /api/datasets/:id/manifest` emits reproducible JSONL (approved research
images only; fixtures structurally excluded; split column left to the
group-aware splitter).

## 7. Files created or modified

**Created**
- `apps/api/src/domain/taxonomy.ts` (+ `.test.ts`)
- `apps/api/src/domain/workflow.ts` (+ `.test.ts`)
- `apps/api/src/domain/composition.ts` (+ `.test.ts`)
- `apps/api/src/services/ingestion.ts` (+ `.test.ts`)
- `apps/api/src/routes/annotations.ts`
- `apps/api/src/routes/datasetStatus.ts`
- `apps/api/src/routes/datasetManifest.ts`
- `apps/api/vitest.config.ts`
- `ml/tests/conftest.py`, `ml/tests/test_validation.py`, `ml/tests/test_splitting.py`, `ml/tests/test_manifest_stats.py`
- `docs/PHASE_3_STATUS.md` (this file)

**Modified**
- `prisma/schema.prisma` — added `AnnotationAudit`, `ImageRelation`, `Image.isDevFixture/.notes/.rejectedReason`; made `sha256` non-unique (duplicates preserved & flagged)
- `apps/api/src/routes/images.ts` — multipart ingestion replaces the 501 stub; detail endpoint
- `apps/api/src/server.ts` — new routes wired
- `apps/api/package.json` — multer dep, vitest test script
- `ml/requirements.txt` — pytest, imagehash

## 8. Tests performed

| Suite | Result |
|---|---|
| TypeScript (vitest): taxonomy enforcement ×4, workflow state machine ×12, composition ×5, ingestion/checksums ×4 | **26/26 pass** |
| Python (pytest): validation ×6, leakage-safe splitting ×5, manifest/statistics ×4 | **15/15 pass** |
| Live API smoke test (dev fixtures): ingest→dup-flag→annotate→role-guard→expert-confirm→terminal-guard→audit→composition | all behaviors verified |

Tests use only generated DEV fixtures in temp dirs — zero contact with research storage.

## 9. Manual work remaining (researcher)

1. Acquire real mulberry leaf photos per class (target 500/class) with capture metadata and grouping keys.
2. Supply license/source documentation per batch ([data-sources.md](data-sources.md)).
3. Perform preliminary annotations (annotator role).
4. Engage domain expert for verification (expert role) — including resolving spot/blight boundary cases and uncertain images.
5. Resolve flagged exact/near-duplicate relations (same leaf? distinct?).
6. Cut the first dataset version once a meaningful approved set exists.

## 10. Research risks

- Spot↔blight boundary ambiguity (Phase 2 flag) now has workflow support (SECOND_OPINION/UNCERTAIN) but remains the dominant label-noise risk.
- No blight-containing external dataset identified — acquisition likely field-collection dependent.
- Imbalance risk during acquisition: status endpoint warns but never suggests duplication/augmentation to reach targets.
- Single annotator (no inter-rater reliability process yet) — consider double-annotation of a subset.

## 11. Phase 4 readiness

**Ready.** Once real images are ingested and annotated, the exploration
notebook (`ml/notebooks/01_dataset_exploration.ipynb`), statistics tooling,
duplicate reports, and composition API give Phase 4 everything needed to
analyze class distribution, dimensions, color/brightness, metadata patterns,
and quality issues. With the current empty dataset, Phase 4 analysis would
honestly report zeros — data acquisition is the critical path.
