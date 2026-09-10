# Model Training Workflow — End-to-End (as implemented in code)

> This document walks the **actual, current code path** from mulberry leaf photos in
> the upload directory all the way to a trained, evaluated model that can be promoted
> for serving. Every step names the file, function, and endpoint that implements it
> (post-Sept 1, 2026 state: background-type tagging, distribution-aware splits,
> per-domain evaluation). Where the code does something surprising or under-documented
> (e.g. what "passes" really means), it is called out explicitly.

---

## 0. Orientation — the pipeline in one picture

```
 uploads/ ──ingest──► Image row               apps/api/src/services/ingestion.ts
   │                     │ annotationStatus = UNLABELED | NEEDS_REVIEW
   ▼                     ▼
 LabelTool ─────────► Annotation(PRELIMINARY)  apps/api/src/routes/annotations.ts
   │                     │ Image → ANNOTATED
   ▼                     ▼
 ReviewTool ─────────► Annotation(EXPERT_REVIEW/FINAL_VERIFIED)  (+ Classification row)
   │                     │ Image → APPROVED (ground truth exists)
   ▼                     ▼
 POST /api/datasets/cut ► Dataset version (snapshot of APPROVED, non-dev)
   │                     │  GET /api/datasets/:id/manifest → NDJSON, split:null
   ▼                     ▼
POST /api/tools/pipeline/start ► Python job (ml/src/inference/pipeline.py)
                                   Step 9  exploration report
                                   Step 10 prepare_dataset → run_preflight → train
                                                        (grouped split; PILOT fallback)
                                   Step 11 evaluate_candidate (integrity gate
                                                        + acceptance verdict)
   │                                                  │
   ▼                                                  ▼
 POST /api/tools/models/register ► ModelVersion @ "experimental"
                                  (records accuracy/F1/confusion + acceptanceVerdict)
   ▼
 PATCH /api/tools/models/:id/lifecycle  experimental→evaluated→candidate→approved
   ▼
 POST /api/models/:id/activate → ml/models/active.json + DB isActive=true / active
```

State machine reminder (`apps/api/src/domain/workflow.ts:14-22`):

```
UNLABELED → NEEDS_REVIEW → ANNOTATED → EXPERT_REVIEWED → APPROVED
                (side states) REJECTED · SECOND_OPINION · UNCERTAIN
```

- **Preliminary annotate** is allowed only from `UNLABELED` / `NEEDS_REVIEW`
  (`workflow.ts:111-117`).
- **Expert review actions** (`confirm | relabel | mark_uncertain | reject |
  second_opinion`) are allowed from specific states and only for `expert`/`admin`
  roles (`workflow.ts:34-49, 59-106`).
- `APPROVED` and `REJECTED` are **terminal** (`workflow.ts:51-53`).

---

## Stage 1 — Ingestion (leaf photos enter the system)

**Entry points**

| Route | File | Purpose |
|---|---|---|
| `POST /api/tools/bulk-ingest` | `apps/api/src/routes/toolsBulkIngest.ts:18` | Bulk batch (≤500 files, ≤25 MB each) with shared collection metadata; optional shared preliminary label |
| `POST /api/images` | `apps/api/src/routes/images.ts` | Single-photo ingest |

**What happens per file** (`apps/api/src/services/ingestion.ts`):

1. **Format + content check** — `prepareIngest` (`ingestion.ts:33-63`):
   - extension must be `.jpg/.jpeg/.png` → else `UNSUPPORTED_FORMAT`;
   - **magic-byte** check: JPEG `0xff 0xd8`, PNG `0x89 0x50...` → corrupt/mislabeled
     uploads rejected as `INVALID_IMAGE_CONTENT` (never trust the extension alone);
   - a unique stored name is generated (`timestamp-random-sanitized`) so originals
     are never overwritten; `sha256` of the buffer is computed.
2. **Dedup** — `ingestImage` (`ingestion.ts:101-163`) does `findFirst({ sha256 })`;
   an exact match sets `isExactDuplicate`, the image starts at
   `NEEDS_REVIEW`, and an `ImageRelation { relationType: "exact_duplicate" }` row
   is written (`ingestion.ts:150-161`). **Duplicates are flagged, never deleted.**
3. **Background tag (Sept 1, 2026)** — `tagBackground` (`ingestion.ts:75-98`)
   POSTs the file to `${ML_SERVICE_URL}/tag/background` (10 s timeout) while the
   Python service classifies it as `white_removed | natural | unknown` via a pure
   color heuristic in `ml/src/inference/symptom_analysis.py::detect_background`.
   **Best-effort and non-fatal**: if the ML service is down the image still ingests
   with `backgroundType = null`.
4. **Row creation** — `Image` created with all collection metadata
   (`plantId/leafId/farmId/collectionSessionId`, `source`, `sourceType`, `license`,
   genotype/capture fields, `sha256`, `backgroundType`) and
   `annotationStatus = initialStatus(...)` = `NEEDS_REVIEW` (duplicate/fixture) or
   `UNLABELED` (`ingestion.ts:66-68, 122-148`).
5. **Optional immediate label (bulk route only)** — if an `assignLabel` + `annotator`
   were given and the file is *not* a duplicate, the route creates a `PRELIMINARY`
   annotation, moves the image to `ANNOTATED`, and appends an audit
   `preliminary_annotate` (`toolsBulkIngest.ts:65-93`).

Now the image sits in the labeling queue.

---

## Stage 2 — Preliminary labeling (annotator)

**Route:** `POST /api/images/:id/annotations` — `apps/api/src/routes/annotations.ts:34-86`.
**UI:** `apps/web/src/pages/tools/LabelTool.tsx`.

1. `actor` + `label` required; label must be one of the four approved taxonomy keys
   (`assertValidClassKey`, `apps/api/src/domain/taxonomy.ts:51`).
2. The image must be `UNLABELED` or `NEEDS_REVIEW`
   (`validatePreliminaryAnnotation`, `workflow.ts:111-117`) — else `409`.
3. A `PRELIMINARY` `Annotation` row is created (`preliminaryLabel`, optional
   `confidence`/`severity`/`reviewNotes`); `Image.annotationStatus` → `ANNOTATED`.
4. `AnnotationAudit` row with `action: "preliminary_annotate"`,
   `actorRole: "annotator"`, before/after status + label.

Programmatic note: **an AI prediction can never create this annotation** — predictions
are stored as `Prediction` rows, never `Annotation` (`prisma/schema.prisma:130`;
`workflow.ts:11`).

---

## Stage 3 — Expert review (ground truth is created here)

**Route:** `POST /api/images/:id/review` — `annotations.ts:94-187`.
**UI:** `apps/web/src/pages/tools/ReviewTool.tsx`.

1. Body `{ actor, action, label?, reason? }`; `action ∈ { confirm, relabel,
   mark_uncertain, reject, second_opinion }`.
2. `validateTransition` (`workflow.ts:59-106`) enforces:
   - `expert`/`admin` only (`FORBIDDEN_ROLE` → 403);
   - not from a terminal state (`TERMINAL_STATE` → 409);
   - action allowed from the current status (`INVALID_TRANSITION` → 409);
   - `relabel` needs a `label`; `confirm` needs an existing preliminary label.
3. Review annotation written: `stage = FINAL_VERIFIED` on `confirm`, else
   `EXPERT_REVIEW`; `reviewer`/`reviewedAt`/`reviewNotes` recorded
   (`annotations.ts:138-148`).
4. **Ground truth** — `Classification` is upserted (one per image, `@@unique`) only
   when the image reaches `APPROVED`, or on any `relabel` (`annotations.ts:151-164`).
5. `Image.annotationStatus` updated to the result; `rejectedReason` on `reject`.
6. `AnnotationAudit` with `action: "review_<action>"`.

**Shortcuts**
- **Batch confirm** `POST /api/review/batch-confirm` (`annotations.ts:206-276`):
  confirms every eligible image (`ANNOTATED / EXPERT_REVIEWED / SECOND_OPINION`),
  optionally restricted by `imageIds` or overridden to a single `label`; per-image
  audit, per-image error reporting. Preview counts via
  `GET /api/review/batch-confirm-preview`.

When all four classes have `APPROVED` images with `Classification` rows, the dataset
is ready to be versioned.

---

## Stage 4 — Dataset versioning (cut + manifest)

**Route:** `POST /api/datasets/cut  { version }` — `apps/api/src/routes/datasets.ts:21-62`.

1. Requires a unique `version` (`409` otherwise).
2. Pulls **all `APPROVED`, non-dev-fixture** images with their classifications
   (`datasets.ts:28-31`). This is the formal definition of *dataset-ready images*.
3. Real per-class counts computed and stored (`datasets.ts:33-37, 45-46`);
   `totalImages`, `imagesPerClass`, `validationStatus: "pending_exploration"`.
4. `Dataset` row created with `status: "DRAFT"`; `splitCounts` left `undefined`
   (`datasets.ts:47`), because splits are assigned later by the splitter.
5. Membership is saved as a many-to-many JoinTable
   (`images: { set: ... }`) — **cutting a new version never mutates older versions**
   (`datasets.ts:56-59`).

**Manifest** — `GET /api/datasets/:id/manifest` (`apps/api/src/routes/datasetManifest.ts:20-58`)
streams NDJSON with one row per member:
`image_id, path, source, source_type, license, background_type, class, severity,
plant_id, leaf_id, farm_id, collection_session_id, split, annotation_status,
review_status, dataset_version, sha256`.

- `split: null` — explicitly *not* assigned here; the group-aware splitter owns it
  (`datasetManifest.ts:44`).
- `background_type` and `sha256` ride along so the splitter can stratify and detect
  leakage.

---

## Stage 5 — The pipeline runner (Steps 9 → 10 → 11)

**UI:** `apps/web/src/pages/tools/PipelineTool.tsx` — "one click for Steps 9→10→11".
The tool builds two controlled experiments per run — `EXP-<version>-B` (baseline,
frozen backbone, `fineTuneLayers: 0`) and `EXP-<version>-FT` (partial fine-tune,
`fineTuneLayers` default 5) — and posts them to the Node API.

**Node proxy** — `apps/api/src/routes/toolsPipeline.ts` forwards verbatim to the Python
service: `POST /pipeline/start`, `GET /pipeline/status/:jobId`, `GET /pipeline/jobs`.
The Node API **never spawns Python**; everything is HTTP (503 if the ML service is down).

**Python runner** — `ml/src/inference/pipeline.py`.

`POST /pipeline/start` (`pipeline.py:239-265`) requires `{datasetId, versionLabel,
experiments:[{id, strategy, fineTuneLayers, epochs}]}`, stores a job in the in-memory
`_jobs` dict, and spawns a daemon thread. **Jobs are in-memory only** — they do not
survive an ML-service restart (`pipeline.py:46`).

### Step 9 — exploration report (`pipeline.py:77-89`)

Runs `ml/scripts/explore_dataset.py --api <apiBase>` as a subprocess
(validation/dedup/statistics style report against the live API). Non-zero exit → job fails.

### Step 10 — prepare manifest + preflight + train (`pipeline.py:92-174`)

1. `prepare_dataset(api_base, datasetId, seed=42)` (`ml/src/training/data.py:45-89`):
   fetches the Node manifest, keeps only `annotation_status == "APPROVED"` rows with a
   `class`, and refuses with a clear error if there are none
   (`data.py:66-70`). Caches the split output as
   `ml/data/prepared/<datasetId>_seed42.jsonl` (+ `.audit.json`).
2. **Splitting** — `create_grouped_splits` (`ml/src/data/splitting.py:148-291`):
   - group every image by **union-find over provenance keys** (`collection_session_id
     > farm_id > plant_id > leaf_id`) **plus its `sha256`**, so byte-identical
     duplicates can never straddle train/test even across sessions
     (`splitting.py:32-60, 63-97`);
- per class, **stratified by dominant `background_type`** (`splitting.py:192-223`)
      so test/val keep the class's background mix (this is what makes covariate-shift
      evaluation meaningful);
   - group-level targets come from `SPLIT_RATIOS` (`splitting.py:28`:
      train 0.8 / val 0.1 / test 0.1, matching `pipeline.json:13` splitRatios).
      Per class × dominant background, test and validation target
      `round(total * 0.1)` each via nearest-subset fit (`splitting.py:214-215`)
      → **train 80 / val 10 / test 10** — the declared and now enforced
      partition (a 2000-image dataset gives the research target of ~200 test);
   - ungrouped images topped up via deficit fill, with `background_type == "natural"`
      rows **prioritized into test** for OOD support (`splitting.py:237-255`);
   - the audit dict records `num_groups`, `duplicate_locked_groups`, `ungrouped_images`,
     `strategy`, `final_counts`, and **`background_dist`** per split
     (`splitting.py:277-291`).
3. **Preflight gate** — `run_preflight` (`ml/src/training/preflight.py:12-78`) refuses
   training when any of: non-`APPROVED` rows present; labels outside the taxonomy;
   a class missing; empty/invalid splits; **exact-duplicate sha256 leakage across
   splits**; missing files.
4. **PILOT fallback** (`pipeline.py:94-116`) — if the grouped split fails preflight
   (classically: too few collection sessions per class to guarantee val/test groups),
   the runner logs the *reason*, retries with `force=True, pilot=True` (image-level
   split, grouping keys retained), and tags every experiment's `notes` with the
   fallback reason. Even PILOT mode failing → job fails.
5. **Re-run safety** (`pipeline.py:120-143`) — if `models/<versionLabel>_<expId>`
   already exists, experiment ids get a run prefix (`r2_`, `r3_`, …) so history is
   never overwritten.
6. **Training per experiment** (`pipeline.py:147-174`) — calls
   `trainer.run_experiment(..., freeze_backbone=True, fine_tune_layers=...,
   epochs=?, on_epoch=...)`. The `on_epoch` callback writes live
   `epoch / train_accuracy / val_accuracy / seconds` into the job's step state, which
   the UI polls every 3 s.

### Step 11 — evaluate each candidate (`pipeline.py:176-229`)

For each trained model dir `ml/models/<version>_<expId>`:

1. `evaluate_candidate(...)` (`ml/src/evaluation/evaluate.py:154-326`) runs a **single
   pass on the isolated test split**; a `REFUSED` result aborts the whole job with
   `evaluation refused: integrity failure` (`pipeline.py:185-186`). The job step
   records `accuracy`, `test_size` and the **acceptance verdict**
   (`pipeline.py:189-192`).
2. On success, a `MODEL_CARD.md` is auto-written into the model dir
   (`_write_model_card`, `pipeline.py:284-341`), always from real numbers — including a
   dedicated **"Acceptance verdict" section** with the per-criterion table
   (threshold / observed / met) and the statement that the verdict is advisory.
3. **Auto-registration** — the runner POSTs to
   `${apiBase}/api/tools/models/register` with `versionLabel, experimentId,
   architecture, framework, trainedAt, notes, accuracy, f1Score, confusionMatrix`
   plus `acceptanceVerdict` (`pipeline.py:204-217`), which the Node route persists on
   the `ModelVersion` row. Registration failure is reported but **not fatal**.
4. A dated results section (each line showing `accuracy`, `macro F1`, test n **and the
   acceptance verdict**) is appended to `docs/PHASE_6_STATUS.md`
   (`pipeline.py:219-229`).
5. Job → `completed` (or `failed` with traceback tail).

---

## Stage 6 — Training mechanics (inside `run_experiment`)

`ml/src/training/train.py::run_experiment` (`train.py:42-206`):

- **Loaders** — `make_loaders` (`ml/src/training/data.py:166-178`) builds **train +
  validation** loaders only; the test loader is deliberately not created
  ("Phase 6 only"). The test set is never loaded during training.
- **Transforms** — `build_transforms(config, train)` (`data.py:105-135`):
  augmentation **on train only** (RandomHorizontalFlip p=0.5, RandomRotation ±10°,
  ColorJitter), then Resize 224×224 → ToTensor → ImageNet normalize. Eval is
  deterministic resize+normalize. Augmentation choices are documented with rationales in
  `ml/src/config/training.json`.
- **Model** — `create_mobilenetv2` (`ml/src/training/model.py:44-75`):
  - MobileNetV2 with `IMAGENET1K_V2` weights, classifier replaced by
    `AdaptiveAvgPool2d(1) → Dropout(0.5) → Linear(1280, 4)` (`LeafNet`, `model.py:23-41`);
  - **unfreeze logic** (`model.py:57-74`): backbone starts frozen; if
    `fine_tune_layers = N > 0`, exactly the last N of 19 feature blocks are made
    trainable. Hence:
    - **Baseline / `-B`** → `freeze_backbone=True, fineTuneLayers=0` → 5,124 trainable
      params (head only);
    - **Partial fine-tune / `-FT`** → `fineTuneLayers=5` → 1,686,468 trainable params
      (last 5 blocks + head).
    The pipeline path always passes `freeze_backbone=True`, so `FT` is genuinely
    *partial* (the historical wiring bug that made sweep runs full-fine-tunes no longer
    applies — see `docs/sweep_results_and_methodology.md`).
- **Optimizer** — Adam, discriminative groups: head LR 1e-4, trainable backbone 1e-5,
  weight decay 1e-4; `ReduceLROnPlateau(factor 0.5, patience 2)`; `CrossEntropyLoss`.
- **Loop** — per-epoch train+val; best checkpoint by **validation loss** →
  `model_best.pt`; `model_latest.pt` always saved; early stopping after 5 epoch
  patience; scheduler steps on val loss.
- **Artifacts** — `ml/models/<dataset_version>_<expId>/`:
  `metadata.json`, `training_history.json`, `class_mapping.json`, model card; plus
  `ml/reports/experiments/<expId>/config.json, history.json, report.json,
  training_curves.png`. Metadata records `status: "candidate"` (or
  `"PILOT_PIPELINE_VALIDATION"` when train notes carry a PILOT marker).

---

## Stage 7 — Evaluation and the integrity gate ("does it pass?")

`ml/src/evaluation/evaluate.py`:

- **Gate — `test_set_integrity`** (`evaluate.py:108-141`) refuses evaluation when: no
  `test` split; test rows outside taxonomy; test rows not `APPROVED`; missing test
  files; or **content-hash leakage** (a test image byte-identical to any train/val
  image). Failure → `evaluate_candidate` returns `{"status": "REFUSED", "integrity"}`
  (`evaluate.py:162-164`) and the pipeline job dies (`pipeline.py:185-186`).
- **Metrics** (`evaluate.py:204-216`) — accuracy; per-class precision/recall/F1/support;
  macro + weighted F1; 4×4 confusion matrix; `predictions.csv` records the **full
  probability distribution** per image, never just the argmax.
- **Confidence/error analysis** (`evaluate.py:219-228`) — mean confidence by
  correct/incorrect, `high_confidence_errors` (conf ≥ 0.8), `difficult_cases`
  (margin < 0.10 or conf < 0.5), and an explicit note that calibration/ECE is deferred.
- **Distribution shift (Sept 1, 2026)** (`evaluate.py:224-245, 329-360`) — per
  `backgroundType` domain accuracy / macro-F1 / per-class F1; reference domain
  `white_removed`, OOD domain `natural`; `no_domain_test_data: true` when natural test
  rows are absent, with an explanatory note — **a number is never fabricated**.
- **Acceptance verdict** — `evaluate_acceptance` (`evaluate.py:50-106`) compares the
  candidate against the **pre-registered** thresholds in
  `ml/src/config/acceptance.json` (v1: `test_size_min 30`, `accuracy_min 0.6`,
  `macro_f1_min 0.6`, `per_class_f1_min 0.4`) — fixed *before* the run, never tuned
  after results. Verdict is `PASS` / `FAIL` / `INCONCLUSIVE` (the last when
  `test_size < test_size_min` = no statistically meaningful evidence). Every criterion
  is reported per-row (threshold / observed / met). Written to
  `acceptance.json`, embedded in `metrics.json`, surfaced on the pipeline step, the
  model card, the insights bundle and the Models page. **Advisory by design** — see below.
- **Artifacts** — under `ml/reports/evaluation/<model_version>/`:
  `metrics.json`, `distribution_shift.json`, `acceptance.json`, `predictions.csv`,
  `errors.csv`, `confusion_matrix.csv` + PNG, `error_galleries/`, `difficult_cases.json`.

> **What "pass" means here, honestly — the objective gate vs the human decision:**
> `evaluate_candidate` still only `REFUSED`s on *integrity* failures (no test rows,
> label/approval/file problems, hash-level leakage). On top of that, every candidate now
> also receives an **automated, objective acceptance verdict** (`PASS`/`FAIL`/`INCONCLUSIVE`)
> from the pre-registered thresholds. That verdict is **advisory, not blocking**: it states
> what was objectively met on the held-out test set, but **a human expert still decides**
> whether to promote/activate/use the model — nothing in the lifecycle or the UI prevents
> promoting a `FAIL` candidate with documented justification. This is the deliberate
> system/ML vs human split: the *system* decides (objectively, pre-registered) whether
> criteria were met; the *expert* decides whether the model is used. There remains a
> `statistical_warning` when test n < 200 (research target) and an insights-layer warning
> when per-class test support < 30 ("must not be quoted as model performance").

---

## Stage 8 — Automatic registration

`POST /api/tools/models/register` — `apps/api/src/routes/toolsModelRegister.ts:10-45`.

1. Requires `versionLabel` + `experimentId`; the dataset version must exist (`404`
   otherwise).
2. Upserts `ModelVersion.version = "<versionLabel>_<experimentId>"` with
   `artifactId`/`artifactPath = ml/models/<version>/model_best.pt`,
   `architecture = "mobilenet_v2"`, and the evaluation's `accuracy`, `f1Score`
   (macro F1), `confusionMatrix` and `acceptanceVerdict` copied from `metrics.json`.
3. **Never sets `isActive`** — the row lands at `lifecycleStatus = "experimental"`
   (schema default; `prisma/schema.prisma:218`).

---

## Stage 9 — Promotion → activation ("the ML decides, the human approves")

There is no auto-promotion. The lifecycle is a human-driven state machine:

**Lifecycle** (`apps/api/src/domain/lifecycle.ts:14-37`):

```
experimental → evaluated → candidate → approved → active
                                        └───────→ retired
```

- `validateLifecycleTransition` (`lifecycle.ts:23-32`) permits only the edges above.
- `canActivate(status)` (`lifecycle.ts:35-37`) is `true` **only** for `approved`.
- Promotion endpoint `PATCH /api/tools/models/:id/lifecycle { to, actor, reason }`
  (`apps/api/src/routes/toolsFeedbackReview.ts:191-227`): validates the edge, and when
  promoting to `active` it first deactivates **all** other models, then sets
  `lifecycleStatus` + `isActive`, and writes a `SystemAudit` `model_status_change` /
  `model_activation`.
- Activation endpoint `POST /api/models/:id/activate { actor }`
  (`apps/api/src/routes/models.ts:84-137`):
  1. `actor` required (expert-only action);
  2. `canActivate` gate → `409` unless `approved`;
  3. calls the ML service `POST /models/<version>/activate`
     (`ml/src/api/main.py:114-134`), which requires `ml/models/<version>/model_best.pt`
     to exist, **writes `ml/models/active.json`** pointing at that version, resets the
     in-process model bundle, reloads, and returns `{ ok, model_version,
     sha256_prefix, pilot }`;
  4. DB: `updateMany isActive:false` then this row → `active` / `isActive: true`;
  5. writes `SystemAudit` `model_activation` with the old/new state.

**Serving** — the ML service lazy-loads the model named in `ml/models/active.json`
(`ml/src/inference/model_loader.py::read_active_pointer / load_active_model`), requires
the checkpoint to have `class_mapping`, `dataset_version`, `model_state`
(`model_loader.py:59-62`). `/health` reports `healthy` only when a bundle is loaded;
`/predict` and `/explain` return the classification + saliency/criterion explanation;
responses append `" [pilot-grade model]"` whenever the metadata notes carry a PILOT /
PIPELINE marker (`main.py:90-92, 205`).

---

## Reference map (file → stage)

| Stage | Location |
|---|---|
| Ingest | `apps/api/src/services/ingestion.ts`, `routes/toolsBulkIngest.ts`, `routes/images.ts` |
| Background tagging | `ml/src/inference/symptom_analysis.py` (`detect_background`), `ml/src/api/main.py:315` (`/tag/background`) |
| Label workflow | `apps/api/src/routes/annotations.ts`, `domain/workflow.ts`, `pages/tools/LabelTool.tsx` |
| Review | `apps/api/src/routes/annotations.ts:94` (`/review`), `:206` (`/batch-confirm`), `pages/tools/ReviewTool.tsx` |
| Cut + manifest | `apps/api/src/routes/datasets.ts:21`, `routes/datasetManifest.ts` |
| Pipeline proxy | `apps/api/src/routes/toolsPipeline.ts` |
| Pipeline runner | `ml/src/inference/pipeline.py` (Steps 9–11, jobs, model card) |
| Splitting | `ml/src/data/splitting.py` |
| Preflight | `ml/src/training/preflight.py` |
| Dataset prep | `ml/src/training/data.py` (`prepare_dataset`, loaders, transforms) |
| Training | `ml/src/training/train.py` (`run_experiment`), `ml/src/training/model.py` |
| Evaluation | `ml/src/evaluation/evaluate.py` (`test_set_integrity`, `evaluate_candidate`, `evaluate_acceptance`) |
| Registration | `apps/api/src/routes/toolsModelRegister.ts` |
| Lifecycle/promotion | `apps/api/src/domain/lifecycle.ts`, `routes/toolsFeedbackReview.ts:191` |
| Activation | `apps/api/src/routes/models.ts:84`, `ml/src/api/main.py:114`, `ml/src/inference/model_loader.py` |
| Config knobs | `ml/src/config/classes.json`, `training.json`, `pipeline.json`, `acceptance.json` |

---

## Honest caveats (as true in the code today)

- **The acceptance verdict is advisory, never a hard gate.** The only hard failures are
  test-set integrity violations (evaluation `REFUSED`) and preflight violations. The
  pre-registered `PASS`/`FAIL`/`INCONCLUSIVE` verdict states objectively what was met,
  but promotion/activation is still a human lifecycle decision — a `FAIL` candidate can
  still be promoted with documented justification. Do not describe the pipeline as
  "auto-accepts good models".
- **80/10/10 is now enforced in the splitter** (`SPLIT_RATIOS`, `splitting.py:28`): grouped
  assignment uses `round(total * 0.1)` per stratum and the ungrouped deficit fill uses the
  same ratios. When group granularity makes a non-empty test/val impossible at 10% (too few
  coarse sessions), the dataset falls back to the PILOT path — it does not silently invert
  the ratios.
- **PILOT fallback is automatic**: datasets too small to guarantee grouped val/test
  still train on an image-level (leakage-guarded) split and are labeled PILOT.
- **Pipeline jobs are in-memory** (`ml/src/inference/pipeline.py:46`) — they die with
  the ML process. Restarting the service cancels any running job.
- **Clean slate**: as of the Sept 1, 2026 reset, `ml/models/` and `ml/data/prepared/`
  are empty and no model is active; the ML service reports `unhealthy` (no model)
  until a new checkpoint is trained, registered, approved, and activated.