# Annotation Schema — LEAFNET v1

Companion to [dataset.md](dataset.md). Field definitions for each image record.
Mirrors the Prisma `Image` / `Annotation` / `Classification` models and the
manifest columns (`ml/src/data/manifest.py`).

## Required (research integrity)

| Field | Type | Description |
|---|---|---|
| `image_id` | string | stable unique ID |
| `filename` | string | original filename |
| `source` | string | who/where provided the image |
| `source_type` | enum | `field_photo` \| `lab_scan` \| `external_dataset` \| `web_upload` |
| `license` | string | license or usage permission |
| `primary_label` | class key? | one of `healthy`/`leaf_rust`/`leaf_spot`/`leaf_blight`; **may be null** if uncertain/rejected |
| `annotation_status` | enum | workflow state (below) |

## Optional (capture context — never fabricated)

| Field | Notes |
|---|---|
| `capture_date`, `capture_time` | ISO 8601 when known |
| `location` | generalized; generalize private farm locations before publication |
| `cultivar`, `leaf_age`, `growth_stage` | free text / controlled vocab TBD |
| `lighting_condition`, `camera_type`, `image_orientation` | |
| `severity` | int 0–3, see below |

## Future (not required in v1)

`plant_id`, `leaf_id`, `farm_id`, `collection_session_id` (grouping keys —
populated when known, used by leakage-safe splitting), secondary observations
(pest damage, physical damage, nutrient symptoms), expert notes,
`annotator_certification_level`.

## Annotation workflow fields

| Field | Purpose |
|---|---|
| `annotator`, `annotation_timestamp` | who proposed preliminary label, when |
| `preliminary_label`, `annotation_confidence` | first-pass label + self-reported confidence 0–1 |
| `reviewer`, `review_timestamp` | expert verification |
| `final_verified_label` | ground truth only after expert review |
| `review_notes`, `uncertainty` | reviewer reasoning and residual doubt |
| `review_status` | see below |

### Workflow states (`AnnotationStatus`)

```
UNLABELED → NEEDS_REVIEW → ANNOTATED → EXPERT_REVIEWED → APPROVED
                                  ↘ SECOND_OPINION ↗
REJECTED   (any stage)      UNCERTAIN  (terminal unless new evidence)
```

- Only `APPROVED` images contribute confirmed ground truth.
- AI predictions are stored as `Prediction` rows only — they can never create
  annotations or advance the workflow.
- Uncertain images are never forced into a class.

## Severity (metadata, not a class)

Provisional scale: **0 none · 1 mild · 2 moderate · 3 severe**.

Condition-specific guidance (unvalidated — treat as provisional):

- **leaf_rust:** pustule density / % lower-leaf-surface coverage
  (0 = n/a, 1 = scattered pustules, 2 = numerous pustules + chlorosis, 3 = extensive coverage/withering).
- **leaf_spot:** % leaf area with necrotic spots
  (1 <5%, 2 = 5–25%, 3 >25% or coalescing).
- **leaf_blight:** % leaf area with spreading dead tissue
  (1 <10% marginal, 2 = 10–40%, 3 >40% or whole-leaf collapse).

Severity definitions differ between conditions by necessity; document which
definition was used per annotation.
