# LEAFNET Dataset Specification — Version 1

> Status: **specification only.** No images have been collected, labeled, or
> fabricated. The system must function correctly with an empty dataset.

## 1. Purpose

LEAFNET performs **four-class, single-label visual classification** of
mulberry (*Morus* spp.) leaf health from photographs under realistic field
conditions. The dataset exists to support a defensible visual assessment —
not laboratory-level biological diagnosis.

## 2. Approved taxonomy (do not modify without methodology approval)

| id | key           | display name         | category        |
|----|---------------|----------------------|-----------------|
| 0  | `healthy`     | Healthy Mulberry Leaf | condition |
| 1  | `leaf_rust`   | Mulberry Leaf Rust    | fungal disease |
| 2  | `leaf_spot`   | Mulberry Leaf Spot    | fungal disease (symptom grouping) |
| 3  | `leaf_blight` | Mulberry Leaf Blight  | disease |

Machine-readable definitions with visual indicators, annotation guidance,
confounding conditions, and cited evidence live in
[`ml/src/config/classes.json`](../ml/src/config/classes.json).

### Scientific basis (summary)

- **Healthy:** uniform green coloration appropriate to leaf age; no necrotic
  spots, pustules, or chlorotic halos. Expert-annotated mulberry datasets
  (e.g. Frontiers in Plant Science 2023, doi:10.3389/fpls.2023.1175515)
  establish "disease-free" as a distinct expert-verifiable category.
- **Leaf rust:** caused by rust fungi — principally *Cerotelium fici*, also
  *Peridiopsora mori* / *Aecidium mori* (recently recombined as
  *Gymnosporangium mori*, Mycoscience 2024). Visual signature: pinhead
  brown/black spots developing into **raised powdery pustules**
  (yellowish-orange/brown spore masses with yellow halos), frequently on the
  leaf underside; advanced stages yellow and wither prematurely
  (Baiyewu et al. 2005; Gonçalves et al. 2022; Mordue 1991).
- **Leaf spot:** flat, discrete necrotic spots caused by diverse fungi
  (*Cercospora moricola*, *Pseudocercospora mori*, *Mycosphaerella mori* /
  *Phloeospora maculans*, *Bipolaris sorokiniana*, *Curvularia lunata*, …).
  Spots range from small dark dots to ~1 cm dry circular lesions, often with
  pale centers and chlorotic halos; severe cases coalesce (Arunakumar et al.
  2023, PMC10665727; Soylu et al. 2003; Frontiers 2025).
- **Leaf blight:** rapid, extensive tissue death — large irregular spreading
  necrotic areas (often from tips/margins), water-soaked margins typical of
  bacterial blight (*Pseudomonas syringae* pv. *mori*) (Texas A&M Plant
  Disease Handbook; J-Stage 2014 "Mulberry Diseases and Their Control").

### Research risks flagged for human review

1. **Leaf spot ↔ leaf blight boundary is scientifically ambiguous.**
   Literature explicitly documents coalesced leaf-spot lesions producing a
   "blightened" appearance (PMC10665727). Boundary cases MUST go to expert
   review, never be forced into a class.
2. **Leaf spot is a symptom grouping**, not one disease. Many pathogens share
   the profile; visual classification cannot identify causal species.
3. **Rust's early stage** resembles leaf-spot pinhead lesions before pustules
   form. Early-stage images should be marked uncertain.
4. **Visual ≠ biological diagnosis.** An image alone cannot establish the
   causative agent (bacterial vs fungal, etc.).

## 3. Visual classification vs biological diagnosis

The system answers: *"What does this leaf visually resemble?"* — never *"What
biological agent is causing this?"*. All application language must use
cautious phrasing ("Visual classification suggests…") rather than definitive
diagnostic claims ("This leaf definitely has…"). This constraint applies to
model outputs, UI copy, and documentation.

## 4. Single-label design

One image → exactly one primary class (`@@unique([imageId])` on
Classification). The schema deliberately preserves room for future secondary
observations without redesign:

- `Annotation.severity`, `uncertain`, review notes
- future columns/JSON for pest damage, physical damage, nutrient symptoms,
  secondary conditions

These are metadata only — **not additional ML classes in v1**.

## 5. Dataset composition and partition

- **Total: 2,000 images** — the complete dataset.
  - healthy: 500 · leaf_rust: 500 · leaf_spot: 500 · leaf_blight: 500
- **Partition: 80 / 10 / 10**
  - Training: **1,600** · Validation: **200** · Testing: **200**

The test set remains isolated from all training and model development until
final evaluation.

### Leakage prevention

Multiple photos of the same physical leaf/plant/farm/session must not straddle
splits. Images carry optional grouping keys (`plant_id`, `leaf_id`,
`farm_id`, `collection_session_id`). Recommended strategy:

1. Group images by the finest available key chain
   (session → farm → plant → leaf).
2. Assign **whole groups** to splits using stratified group sampling so each
   split keeps approximately the 500-per-class balance.
3. Only fall back to image-level random split when no grouping metadata exists
   — and record that fact in the manifest/version notes.

Implemented in `ml/src/data/splitting.py` (`create_grouped_splits`).

## 6. Labeling philosophy & expert ground truth

Workflow: **Unlabeled → Needs Review → Annotated → Expert Reviewed → Approved**,
with side states Rejected / Second Opinion / Uncertain
(`AnnotationStatus` in the Prisma schema).

- Preliminary labels are recorded via `Annotation(stage=PRELIMINARY)` with
  annotator identity, timestamp, and self-reported confidence.
- Expert review produces `Annotation(stage=EXPERT_REVIEW)` /
  `FINAL_VERIFIED`; only then does `Classification` become confirmed ground
  truth and `annotationStatus = APPROVED`.
- **An AI prediction can never write an Annotation or set APPROVED.**
- An image that cannot be confidently classified is marked `UNCERTAIN` or
  `NEEDS_REVIEW`. **Uncertain images are never forced into a class to hit the
  500-per-class target** — a smaller trustworthy dataset beats a padded one.

## 7. Image requirements

- Formats: JPEG/PNG. Minimum ~800×800 px recommended (see pipeline.json).
- Symptom-bearing region visible and in focus; single dominant leaf preferred
  but multiple leaves acceptable when symptoms are clearly attributable.
- Real-world conditions welcome: natural backgrounds, varied lighting,
  orientations, devices. Controlled-background images are not required.
- Every image carries its source and license.

## 8. Metadata

Full field-by-field specification: [`docs/annotation-schema.md`](annotation-schema.md).
Required: filename, source, source_type, license, primary label workflow state.
Optional: capture date/time/location, cultivar, leaf age, growth stage,
lighting, camera, orientation, severity, grouping keys.
**Missing metadata is never fabricated** — fields stay null and are reported.

## 9. Image quality rules

| Verdict | Criteria |
|---|---|
| ✅ Acceptable | Symptoms identifiable; adequate focus on relevant region; readable exposure; natural background OK |
| ⚠️ Questionable | Slight blur on symptom area; heavy shadows over part of lesion; extreme angle; heavy compression — route to human review |
| ❌ Rejected | Unreadable/corrupt file; symptom fully occluded/out of frame; unresolvable blur; thumbnails/extreme downscale; exact duplicates of already-included images |

Near-duplicates are flagged for review, never auto-deleted
(`ml/src/data/deduplication.py`).

## 10. Quality standards & exclusion criteria

- All included images pass validation (`ml/src/data/validation.py`) and reach
  `APPROVED` annotation status.
- Exclude: corrupt files, non-mulberry subjects, watermarked images without
  license permission, exact duplicates, images whose class cannot be agreed by
  reviewers.
- Class imbalance beyond ±5% of target triggers a version note.

## 11. Dataset versioning

See [`docs/dataset-versioning.md`](dataset-versioning.md). Each `Dataset`
version records composition, split counts, sources, changes, known issues —
making it possible to determine exactly which data trained any model version.

## 12. Severity (metadata only)

Provisional scale **0 none · 1 mild · 2 moderate · 3 severe**, defined per
condition in [annotation-schema.md](annotation-schema.md#severity). Not
scientifically validated; per-condition definitions differ (e.g., % leaf area
affected vs pustule density). Never an ML class in v1.

## 13. Known limitations

- Blight/spot ambiguity (flagged above) will produce some irreducible label noise.
- Geographic/cultivar bias depends entirely on collection sources; document provenance per image.
- External datasets (e.g. the Rajshahi, Bangladesh mulberry dataset — healthy/
  rust/spot only, no blight) cover only part of the taxonomy and carry their own
  labeling standards; see [data-sources.md](data-sources.md).
- Severity scale unvalidated.

## 14. Ethical / legal / licensing

Every external image records source name, URL, license, citation, access date,
usage restrictions ([docs/data-sources.md](data-sources.md)). No copyrighted
material is incorporated merely because it is publicly visible. If location
data identifies private farms, it must be generalized before publication.
