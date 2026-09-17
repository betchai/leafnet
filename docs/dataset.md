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
splits. Images carry optional grouping keys (`collection_session_id`,
`farm_id`, `plant_id`, `leaf_id`). Splitting
(`ml/src/data/splitting.py` → `create_grouped_splits`) is:

1. **Union-find over all identity keys plus the image content hash (`sha256`).**
   Images sharing ANY identifier — including exact duplicates uploaded under
   *different* provenance keys — are merged into one leakage component and can
   therefore never straddle `train` / `validation` / `test`.
2. **Whole groups are assigned to splits per class toward 80/10/10**
   (nearest-subset selection, never the empty pick). A class with ≥ 3 groups is
   **guaranteed ≥ 1 whole group in test AND ≥ 1 in validation**, so no class can
   become unmeasurable just because its sessions are coarser than 10%. On ties,
   natural-background (in-situ) groups are preferred so distribution-shift
   evaluation has support.
3. **Singleton groups (size 1) carry no leakage risk** and are promoted to the
   ungrouped pool rather than running the exhaustive subset search over them.
4. A global rebalance returns any surplus held-out groups to train without ever
   emptying a class's test/validation side, then the audit records the final
   counts, per-class counts, background distribution, and drift vs the 80/10/10
   target in the manifest's `.audit.json`.
5. Grouping keys are **never deleted** — even in a fallback/PILOT run they are
   retained in the manifest so provenance can be re-split later.

### Raw / ungrouped photos — image-level fallback methodology

Raw photos (field/scrape captures) often carry **no grouping metadata at all**,
and each image has a unique content hash, so no leakage components exist and
the splitter drops to the documented image-level fallback (`strategy =
image_level_random_fallback_no_grouping_metadata_available`). This path is
still **class-stratified and leak-safe**:

- **Per-class 80/10/10 (not a global lottery).** Each class is apportioned its
  own `train`/`validation`/`test` counts via largest-remainder of the 80/10/10
  ratio with the same guarantee as the grouped path: a class with ≥ 3 rows gets
  **≥ 1 validation AND ≥ 1 test row**, so a class can never be silently
  unmeasurable (the previous "healthy 495/5/0" bug — the old code filled
  test/validation first-come-first-served, so natural-background rows consumed
  every held-out slot and a lab-scan class like healthy vanished from test).
- **Within a class**, rows are shuffled (fixed seed → reproducible) and
  natural-background (OOD) rows are prioritized into test so covariate-shift
  evaluation keeps support; unlabeled rows go to train only.
- **Global rebalance** then nails the declared partition (for the 2,000-image
  raw set: exactly **1,600 / 200 / 200**, i.e. 400 / 50 / 50 per class) without
  ever draining a class's last held-out row.
- The same leakage guarantees hold: exact duplicates are locked by `sha256`
  union-find *before* the fallback runs, singletons pose no leakage risk, and
  only `APPROVED` rows reach the manifest.

Workflow impact: the raw/ungrouped pipeline runs score **higher on acceptance
criteria** because every class — including ones that were previously homeless
in held-out sets — now has measurable test/validation support, and leakage
cannot silently inflate the numbers since duplicate content never straddles
splits.

### Enforcement (training-time)

`ml/src/training/preflight.py` hard-refuses a manifest where any taxonomy class
is absent, any class with ≥ 3 rows has no test or validation coverage, any
split falls below the 5%-of-total sanity floor, duplicate content (same
`sha256`) straddles splits, or any row is not `APPROVED` with a valid label and
a readable file. The pipeline falls back to a PILOT split only if the grouped
preflight fails, and the PILOT split must pass the same preflight or training
is refused outright.

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
