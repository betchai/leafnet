# LEAFNET Training Methodology — Raw / Ungrouped Photos

> Version 2 — documents the class-stratified split methodology and training-time
> enforcement implemented in `ml/src/data/splitting.py` and
> `ml/src/training/preflight.py`. Supersedes the earlier first-come-first-served
> image-level fallback, which silently starved a class out of the held-out
> splits (the "healthy 495/5/0" bug).

## 1. Why this methodology exists

Experiments trained on **raw, ungrouped field photos** have consistently
scored higher against the acceptance criteria than experiments trained on
curated/grouped sets. Two structural reasons:

1. **Every class must be measurable.** Under the old fallback, the test and
   validation splits were filled first-come-first-served in a global shuffle.
   Natural-background rows (which appear mostly in the disease classes)
   consumed every held-out slot, and a class whose photos are all lab-style
   scans — `healthy` — landed with **0 test rows and 5 validation rows**. A
   model could never be evaluated for that class, so its score was
   meaningless. The new split *guarantees* every class appears in test and
   validation.
2. **No silent leakage inflation.** Duplicate content (same `sha256`) is
   locked into a single split before any assignment, so near-repeats of the
   same leaf can never inflate held-out scores.

## 2. Partition target (80 / 10 / 10)

| Split       | Ratio | 2,000 images |
|-------------|-------|--------------|
| train       | 0.80  | 1,600        |
| validation  | 0.10  | 200          |
| test        | 0.10  | 200          |

Declared in `SPLIT_RATIOS` (`ml/src/data/splitting.py`) and mirrored in the
pipeline config. The test split is isolated from all training and model
development until final evaluation.

## 3. How the split is computed

`create_grouped_splits(rows, seed)` in `ml/src/data/splitting.py`.

### 3.1 Leakage grouping (all paths)

1. **Union-find over identity + content**: images sharing any of
   `collection_session_id`, `farm_id`, `plant_id`, `leaf_id` **or** an equal
   `sha256` content hash are merged into one leakage component. Exact
   duplicates uploaded under *different* provenance keys therefore can never
   straddle splits.
2. **Singleton groups** (size 1) carry no leakage risk and are promoted to the
   ungrouped pool instead of being searched exhaustively.
3. Keys survive every fallback — provenance is retained in the manifest so the
   dataset can be re-split correctly later.

### 3.2 Grouped path

Whole groups are assigned per class toward 80/10/10 using nearest-subset
selection (never the empty pick). A class with ≥ 3 groups is **guaranteed**
≥ 1 whole group in **test and** ≥ 1 in **validation**, so coarse collection
sessions can never make a class unmeasurable. On ties, natural-background
(in-situ) groups are preferred so distribution-shift evaluation has support.

### 3.3 Raw / ungrouped path (image-level fallback)

When no grouping metadata exists — the situation for raw photos where every
image has a unique content hash — the splitter drops to the documented
fallback (`image_level_random_fallback_no_grouping_metadata_available`). It is
**class-stratified 80/10/10**, not a global lottery:

1. Each class is apportioned its own `train`/`validation`/`test` counts by
   largest-remainder of the 80/10/10 ratio, reusing `_split_group_counts` with
   the same guarantee as the grouped path: **a class with ≥ 3 rows gets ≥ 1
   validation AND ≥ 1 test row**. A class can never end up unmeasurable.
2. Within a class, rows are shuffled under the fixed seed (reproducible), then
   natural-background (OOD) rows are prioritized into **test** so
   covariate-shift evaluation keeps support. Unlabeled rows go to train only.
3. A **global rebalance** then nails the declared partition — for the
   2,000-image raw set: exactly **1,600 / 200 / 200**, i.e. **400 / 50 / 50
   per class** — without ever draining a class's last held-out row.
4. Leakage guarantees still hold: `sha256` duplicates are locked before the
   fallback runs, and only `APPROVED` rows reach the manifest.

### 3.4 Audit

Every split writes `.audit.json` next to the manifest recording `strategy`,
`seed`, `final_counts`, `per_class_counts`, `classes_missing_test`,
`classes_missing_val`, `background_dist`, and per-split drift vs target — so
any run can be verified after the fact.

## 4. Training-time enforcement (`preflight.py`)

A manifest is **hard-refused** (training does not start) if any of:

- a taxonomy class is absent from the dataset;
- a class with ≥ 3 rows has **no test or no validation rows** (unmeasurable —
  the "healthy 495/5/0" trap);
- any split falls below the 5%-of-total sanity floor (degenerate partition);
- duplicate content (same `sha256`) straddles splits (leakage);
- any row is not `APPROVED`, has an invalid label, or a missing/unreadable
  file.

The pipeline only falls back to a PILOT split if grouped preflight fails, and
the PILOT split must pass the same preflight or training is refused outright.

## 5. Evaluation and acceptance

Each trained candidate is scored once on the isolated test split
(`ml/src/evaluation/evaluate.py`), producing `acceptance.json`, `metrics.json`
(accuracy, macro & weighted precision/recall/F1, per-class
precision/recall/F1/support, confusion matrix), `predictions.csv`,
`distribution_shift.json`, and confidence analysis. The acceptance verdict
compares against the **pre-registered** thresholds in
`ml/src/config/acceptance.json` (accuracy + macro precision/recall/F1 ≥ 0.6,
per-class ≥ 0.4, test n ≥ 30). The verdict is **advisory**: a human decides
promotion/activation via the model lifecycle.

## 6. Verification evidence

On the current 2,000-image raw dataset (seed 42) the fixed splitter yields:

```
final_counts:            train 1600 · validation 200 · test 200   (exact)
per_class_counts:
  healthy:      train 400 · validation 50 · test 50
  leaf_blight:  train 400 · validation 50 · test 50
  leaf_rust:    train 400 · validation 50 · test 50
  leaf_spot:    train 400 · validation 50 · test 50
classes_missing_test: []   classes_missing_val: []
```

Reproducible via:
```
cd ml && .venv/bin/python -c "import json; from src.data.splitting import create_grouped_splits; \
r=create_grouped_splits([{'image_id': f'i{i}', 'class': c} for c in \
('healthy','leaf_rust','leaf_spot','leaf_blight') for i in range(500)], seed=42)['audit']; \
print(json.dumps(r['final_counts']))"
```