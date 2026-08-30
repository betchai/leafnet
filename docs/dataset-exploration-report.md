# Dataset Exploration Report — Phase 4

**Generated:** 2026-08-23 · **Dataset version:** none cut yet ·
**Analysis tooling:** `ml/scripts/explore_dataset.py` (+ `ml/src/analysis/eda.py`),
reports in `ml/reports/`

> Principle honored: this report reflects the dataset as it actually is.
> Nothing is embellished to make the dataset look ready.

## 1. Dataset status

| Metric | Actual | Target |
|---|---|---|
| Research images acquired | **1** | 2,000 |
| Annotated | 0 | — |
| Expert verified / Approved | **0** | 2,000 |
| Rejected / Uncertain | 0 / 0 | — |
| Dev fixtures (excluded from research) | 4 | n/a |

The single "research" record is itself a smoke-test artifact from Phase 3 and
should be purged or formally reviewed before real acquisition begins.

## 2. Class distribution

All four classes at 0 approved (0% of the 25%-per-class target):

healthy 0/500 · leaf_rust 0/500 · leaf_spot 0/500 · leaf_blight 0/500

**Shortfall: 2,000 images.** No rebalancing performed or possible.

## 3. Metadata quality

Completeness percentages are computed per field by the tooling
(`reports/metadata_completeness.csv`). With one unverified image, no meaningful
completeness assessment exists. Required fields (source, source_type, license)
are enforced at ingest; all optional fields persist explicit nulls.

## 4. Image quality

Technical analysis ran on 1 file. Quality flags (brightness/contrast/sharpness)
are implemented and unit-tested but cannot characterize an empty dataset.
No image was modified or rejected algorithmically.

## 5. Visual diversity

- Observed: unknown — insufficient data.
- Potential implication of current state: none assessable; any diversity claim would be fabricated.
- Recommended action: acquire across multiple sessions, farms/devices, lighting conditions, and cultivars from the start, logging grouping metadata.

## 6. Potential bias

- Known structural risk (documented since Phase 2): the only identified external dataset lacks leaf_blight entirely; field acquisition will be the sole blight source, risking geographic/device confounding with that class.
- Recommended action: capture metadata (farm/session/camera) for every image so class×context correlation can be tested here once data exists.

## 7. Leakage

- Split not yet performed (by design — happens before training).
- Controls in place and tested: group-aware stratified splitter, SHA-256 exact-duplicate detection, `ImageRelation` near-duplicate/same-leaf relations, session/plant/leaf/farm grouping keys.
- Current duplicate groups within research data: 0. Open duplicate relations in DB: 2 (from dev-fixture smoke tests).

## 8. Outliers

`reports/outliers.csv` — currently flags the lone smoke-test image on sample-size grounds. Outlier galleries activate automatically as data grows.

## 9. Readiness decision: **NOT READY**

0 of 2,000 target images are expert-verified/approved. No class has any
verified representative. Proceeding to MobileNetV2 training now would produce a
model with no defensible evaluation basis. This verdict is based purely on the
analysis above.

## 10. Required actions before Phase 5

1. Acquire research images per class with full provenance + grouping metadata (critical path).
2. Preliminary annotation → expert verification workflow for every image.
3. Resolve spot/blight boundary cases via second-opinion review.
4. Purge or adjudicate the Phase-3 smoke-test record and dev fixtures.
5. Re-run this exploration when ≥100 approved images exist; reassess scorecard.
6. Only then: leakage-safe grouped split → Phase 5 training.

## Scorecard

| Dimension | Status | Findings |
|---|---|---|
| Class balance | Critical | 0 approved in all classes |
| Image quality | Unknown | Tooling ready; no data |
| Metadata completeness | Needs Attention | Enforcement exists; nothing populated |
| Annotation completeness | Critical | No annotations |
| Expert verification | Critical | None |
| Duplicate risk | Good (controls) | Detection tested; 0 research dups |
| Leakage risk | Acceptable | Grouped-split controls ready & tested |
| Visual diversity | Unknown | Unassessable |
| Environmental diversity | Unknown | Unassessable |
| Cultivar diversity | Unknown | Unassessable |
| Collection diversity | Unknown | Unassessable |
| Label ambiguity | Needs Attention | Spot/blight boundary risk documented |
| Dataset readiness | **NOT READY** | Acquisition is critical path |
