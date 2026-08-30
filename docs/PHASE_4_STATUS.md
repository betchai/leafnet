# Phase 4 Status — Dataset Exploration & Quality Analysis

**Date:** 2026-08-23
**Model training performed:** **NONE** (no MobileNetV2 weights loaded, no transfer learning, no predictions, no accuracy)

---

## 1. Phase objective

Exploratory data analysis and quality assessment of the LEAFNET research
dataset to determine readiness for Phase 5 (MobileNetV2 training) — covering
completeness, class distribution, metadata, technical/visual quality, diversity,
bias, leakage, and outliers.

## 2. Dataset analyzed

- **Dataset version:** none cut yet (first version requires approved images)
- **Research images:** 1 (a Phase-3 smoke-test record; unapproved, flagged for purge/adjudication)
- **Approved images:** 0
- **Class distribution:** healthy 0 · leaf_rust 0 · leaf_spot 0 · leaf_blight 0 (target 500 each)
- Dev fixtures in DB: 4 — analyzed separately, never merged into research findings.

## 3. Data-quality findings

- The research dataset is effectively empty. Every quantitative "finding" would
  be meaningless; the tooling therefore reports zeros and Unknown statuses.
- Analysis infrastructure is complete and verified: technical characteristics,
  brightness/contrast/sharpness flags, duplicate grouping, leakage group sizing,
  outlier z-scores, metadata completeness — all unit-tested and zero-image-safe.
- Quality outputs are review flags only; no image was modified or auto-rejected.

## 4. Metadata findings

Completeness machinery distinguishes required (source, source_type, license)
from optional fields and treats optional missingness as non-error. Actual
populated percentages: not assessable with one unverified record. High-missingness
fields will surface automatically as data accumulates.

## 5. Image-quality findings

Quality metrics implemented (mean brightness, contrast σ, gradient-energy
sharpness proxy) with thresholds for severely dark / overexposed / low-contrast /
possibly blurry flags. Verified on synthetic extremes via tests. Real-data
assessment impossible at current dataset size.

## 6. Diversity findings

Visual, environmental, cultivar, and collection diversity: **Unknown** —
unassessable. No claims of representativeness are made or supportable.

## 7. Leakage findings

- No train/val/test split exists yet (correctly deferred to pre-training).
- Leakage controls built and tested: grouped splitting keeps plant/leaf/farm/
  session clusters intact; exact-duplicate hashing; near-dup relations recorded
  for human resolution.
- Open items: 2 dev-fixture duplicate relations from Phase-3 smoke tests; the
  lone research smoke-test record should be purged or adjudicated.

## 8. Bias findings

- Documented structural risk: leaf_blight will depend entirely on field
  acquisition (the known external dataset lacks blight), creating risk that
  blight correlates with a specific farm/device/session.
- Metadata bias analysis (class × farm/cultivar/camera/session cross-tabs) is
  implemented and will flag confounders automatically once data exists.

## 9. Outliers

Outlier detection (z-score > 3 on dimensions/file size + quality flags) active;
currently flags only the single smoke-test record on sample-size grounds.
Nothing removed — every exclusion remains traceable by design.

## 10. Dataset readiness: **NOT READY**

Rationale: 0 of 2,000 expert-approved images exist; all classes have zero
verified representatives; no diversity/bias/quality conclusions are possible.
Training now would be indefensible.

## 11. Required remediation (before Phase 5)

1. Acquire real research images per class (critical path) with provenance, licenses, and grouping keys.
2. Run annotation → expert verification for each image; resolve spot/blight boundary cases.
3. Purge or adjudicate the Phase-3 smoke-test record and dev fixtures.
4. Re-run exploration at ≥100 approved images and reassess the scorecard.
5. Perform the leakage-safe grouped split immediately before training.

## 12. Files created or modified

**Created**
- `ml/src/analysis/__init__.py`? *(not needed — namespace package)*, `ml/src/analysis/eda.py`
- `ml/scripts/explore_dataset.py`
- `ml/tests/test_eda.py`
- `ml/reports/dataset_summary.json`, `class_distribution.csv`, `metadata_completeness.csv`, `image_quality.csv`, `duplicate_candidates.csv`, `leakage_candidates.csv`, `outliers.csv`
- `docs/dataset-exploration-report.md` (incl. scorecard)
- `docs/PHASE_4_STATUS.md` (this file)

**Modified**
- `ml/notebooks/01_dataset_exploration.ipynb` — full Phase-4 section structure wired to live tooling
- `ml/requirements.txt` — numpy, imagehash, matplotlib installed into venv

## 13. Tests performed

| Suite | Result |
|---|---|
| Python pytest (all suites incl. new EDA tests: technical chars, quality flags, completeness semantics, duplicates, leakage groups, class distribution, zero-safety) | **22/22 pass** |
| TypeScript vitest (Phase-3 regression) | 26/26 pass |
| Live EDA run (`explore_dataset.py`) against running API | executed cleanly, honest zeros, 7 report files written |

## 14. Phase 5 recommendations (NOT implemented)

1. MobileNetV2 ImageNet-pretrained backbone, new 4-unit classifier head (frozen backbone first, then fine-tune last blocks).
2. Input pipeline from `pipeline.json`: 224×224, per-channel normalization computed from THIS dataset (not assumed).
3. Train on grouped split only; keep test set untouched until final evaluation.
4. Augmentation limited to training split (flip/rotation/mild jitter); never counted toward the 2,000 research total.
5. Class-weighted loss if acquisition imbalance persists; report per-class metrics, macro-F1, confusion matrix.
6. Baseline sanity check: verify the model beats majority-class baseline before any claim of learning.
7. Model card completed from a REAL run only (template ready).

---

**Stopping here per phase boundary.** Phase 5 (training) requires explicit go-ahead AND a populated verified dataset — currently NOT READY.
