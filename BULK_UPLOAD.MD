# LEAFNET — Bulk Upload & Dataset Completion Guide

Step-by-step operating manual from bulk upload through training.

---

## Per-batch loop (every time you get new leaf photos)

### Step 1 — Bulk upload (Tools → Bulk Ingest)
- One batch = one **(collection session × class)** combination
- Fill in: source, session ID, farm ID, license
- If all photos in the batch show the same condition → set bulk label + your annotator name
- ⚠️ Never mix classes in one batch if using the bulk label

### Step 2 — Check results
- Duplicates flagged → they go to NEEDS_REVIEW automatically
- Failures → note filenames, fix and re-upload

### Step 3 — Expert review (Tools → Expert Review)
- Queue "Awaiting expert review" → **Confirm** correct labels
- Wrong labels → **Relabel**, then confirm on the second pass
- Can't tell? → **Uncertain** or **2nd opinion** — never force a class
- Duplicate-flagged images → decide same-leaf vs distinct; reject true duplicates

### Step 4 — Verify balance (Tools → Dataset Status)
- Check per-class approved counts
- Make the next batch target your *weakest* class

Repeat Steps 1–4 until done acquiring.

---

## Periodic milestone (every ~100 approved images)

### Step 5 — Cut version
Dataset Status → Cut version (`v0.3`, `v0.4`, …). Versions are immutable snapshots.

### Step 6 — Re-run exploration report
```bash
cd ml && .venv/bin/python scripts/explore_dataset.py
```
Check class balance, duplicates, quality flags. Adjust acquisition strategy if a class lags.

---

## Final gates (when ~500 approved per class)

### Step 7 — Final integrity pass
Resolve ALL uncertain / needs-review / duplicate-flagged images. Every image must end APPROVED or REJECTED.

### Step 8 — Cut the research version (`v1.0`)
This exact snapshot is what trains your model. Never modify it afterward.

### Step 9 — Re-run exploration on v1.0
```bash
cd ml && .venv/bin/python scripts/explore_dataset.py
```
Read the scorecard. Fix anything marked Critical before training.

---

## Training & evaluation

### Step 10 — Train candidates
```bash
python scripts/run_experiment.py --dataset-id <v1.0-id> --version-label v1.0 \
  --exp EXP-101 --strategy baseline
python scripts/run_experiment.py --dataset-id <v1.0-id> --version-label v1.0 \
  --exp EXP-102 --strategy fine_tune
```
⚠️ NO `--pilot` flag this time — grouped splitting and full leakage protection are enforced.

### Step 11 — Evaluate once, both candidates
```bash
python scripts/evaluate.py --dataset-id <v1.0-id> --version-label v1.0 \
  --models v1.0_EXP-101 v1.0_EXP-102
```
This is the ONE look at the test set. No tuning afterward.

---

## Then hand off to the assistant

### Step 12
Say training + evaluation are done. The assistant handles: model cards with real metrics,
Phase 6 status update, Phase 7 inference API, promoting the winner to `isActive`,
and the app serving real predictions.

---

## The three rules that protect everything

1. **Never approve your own labels as the same person** — annotator ≠ expert name.
2. **Never force uncertain images into a class** to hit 500.
3. **The test set is touched exactly once** — at Step 11.

---

## Quick reference: where things live

| Task | Where |
|---|---|
| Upload images | Tools → Acquire & Label / Bulk Ingest |
| Propose labels | Tools → Acquire & Label (or bulk label) |
| Confirm ground truth | Tools → Expert Review |
| Track progress | Tools → Dataset Status |
| Cut dataset versions | Tools → Dataset Status → Cut version |
| Exploration reports | `ml/scripts/explore_dataset.py` |
| Training | `ml/scripts/run_experiment.py` |
| Evaluation | `ml/scripts/evaluate.py` |
