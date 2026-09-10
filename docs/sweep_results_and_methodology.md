# Fine-Tuning Choice — Results & Methodology Explainers

> This document serves two people: **the reader who is not the researcher** (Section 1,
> plain language) and **the study's methodology section** (Section 2, defensible research
> account). Every number below comes from real, logged runs. The corrected comparison
> (V1.1) is the one used for any research claim; the earlier sweep is retained and
> explained because it is what caught a real engineering bug that would otherwise have
> invalidated every earlier fine-tuning claim.
>
> **Revised Sept 1, 2026** — adds the covariate-shift (out-of-distribution) capability:
> automatic `background_type` tagging, distribution-aware splits, per-domain
> (white-background vs in-situ) evaluation metrics, and the `no_domain_test_data` honesty
> flag. The dataset pool was clean-slated on that date; the V1.1 comparison and sweep
> below remain the canonical log for the fine-tuning choice.

---

## Section 1 — What we wanted to know, in plain language

### The question

The model arrives with excellent general "eyes" learned from ImageNet (millions of generic
web photos). To specialize it for mulberry leaf diseases we do *fine-tuning*: we change a
few knobs and ask how the model's quality changes. Two knobs matter:

1. **How much of the "eye" to let adapt** — 0 blocks (eyes stay frozen, only a new 4-way
   "decision layer" learns) vs. the last 5 internal feature-blocks vs. all 18 blocks.
2. **How many training rounds (epochs) to allow** — we started with 20.

We ran an experiment (the "sweep") to prove these were wise choices, not luck.

### What the first experiment taught us (surprising!)

The sweep turned up something unexpected: **the "partial fine-tune" runs were not actually
partial**. Because of a wiring bug in the training pipeline, every "unfreeze last N blocks"
run was really *full* fine-tuning — the entire model was re-trained. You can see it in the
evidence: runs with 3 blocks, 5 blocks, or all 18 blocks produced **identical** validation
curves and **identical** final scores, as if the knob did nothing. A knob that does nothing
is the fingerprint of a bug, not a good result.

Even so, the sweep was valuable:

- The **full fine-tune** that was secretly happening still improved the model a lot (val
  accuracy 0.694 frozen → 0.806 full fine-tune), and its best checkpoint was found by
  **epoch 5**.
- A separate 40-epoch run of the same setup stopped improving at epoch 13 (no better
  result found in 8 follow-up rounds) — so the **20-epoch budget is fine**; it is not the
  bottleneck.

### What we did about it

1. **Fixed the code** so a frozen backbone truly stays frozen, and a "last-5-blocks"
   partial fine-tune really unfreezes exactly the last 5 of 19 blocks (verified by counting
   trainable parameters).
2. **Built a fresh data cut (V1.1)** — 2,019 images balanced across the four classes.
3. **Fixed a data leak**: the original split accidentally let two copies of the *same
   photo* (uploaded twice under different sessions) land on opposite sides of the
   train/test boundary, which inflated every earlier score. New splitter: photos are
   grouped by their true origin (collection session / farm / plant / leaf) *and* by
   content hash, so identical photos can never straddle the boundary; each class's test set
   is ~100 photos.
4. **Re-ran the honest comparison** on V1.1: fully-frozen baseline vs. partial fine-tune
   of the last 5 blocks.

### The honest results (V1.1, test set of 404 photos never used in training)

| Model | Test accuracy | Macro F1 | Healthy | Rust | Spot | Blight |
|---|---|---|---|---|---|---|
| Baseline — backbone frozen (5,124 trainable params) | **0.611** | **0.617** | 0.954 | 0.430 | 0.443 | 0.642 |
| Partial fine-tune — last 5 blocks (1,686,468 trainable params) | **0.671** | **0.677** | 0.995 | 0.534 | 0.428 | 0.753 |

F1 values are per class. Partial fine-tuning meaningfully beats the frozen baseline overall
(+0.06 accuracy, +0.06 macro F1), and it is *dramatically* better on blight (0.642 → 0.753)
and rust (0.430 → 0.534). It is roughly flat on spot — the hardest class, where the two
most similar disease classes (rust and spot) are nearly always confused, both before and
after.

These are **lower** than the numbers reported earlier in the project (which looked like
0.81+). That is expected and good: the earlier number was inflated by the leak and by the
full-fine-tune bug. The 0.67 measured here is the honest generalization estimate from a
clean, proven-to-be-leak-free test split.

### The newest addition: checking the model on real field photos (Sept 1, 2026)

Every number above was measured on polished, white-background images (the curated research
cut). Real-world users photograph leaves in the field with natural backdrops (soil, grass,
sky) — a *different distribution*. To keep Section 2 honest about that gap, the pipeline was
extended on Sept 1, 2026:

- **Automatic background tagging.** Each image is auto-classified as `white_removed`
  (curated), `natural` (in-situ field backdrop), or `unknown` by a lightweight color
  heuristic (`detect_background`) that never needs the active model — it runs even when
  the service has no model loaded (`/tag/background`).
- **Distribution-aware splits.** The leak-proof splitter keeps each split's background mix
  proportional to the class as a whole, and preserves in-situ `natural` (out-of-domain)
  photos into the test set instead of letting them drown in the white-removed majority.
- **Per-domain scores.** Evaluation reports accuracy/macro-F1 separately for `white_removed`
  vs `natural` test images, and prints an explicit `no_domain_test_data` flag when the test
  set lacks either domain — never a fabricated number. A growing pool of expert-verified
  field photos (live analyzer uploads + feedback corrections) is what will eventually make
  this measurement statistically meaningful.
- **Richer "why":** on the same day, predict/explain began shipping per-criterion evidence
  (necrosis fraction, spot density, rust-pustule signal, green-leaf fraction) scored against
  class-pair criteria profiles, rendered as a voter matrix in the Analyzer.

---

## Section 2 — Methodology (defensible research account)

### 2.1 Data

- **Source cuts.** V1.0 (2,000 images) was used for all earlier runs and for the sweep.
  V1.1 (2,019 images) is the cut used for the corrected comparison: acquired/approved totals
  were 500 healthy, 504 leaf rust, 508 leaf spot, 507 leaf blight.
- **Annotation.** Images carry a class label from domain-expert review, and each image was
  automatically classified by the then-active model into bio-class groups; the label set is
  `{healthy, leaf_rust, leaf_spot, leaf_blight}`.

### 2.2 Train/validation/test splitting (leak-proof)

- **Grouping.** Images are grouped by provenance identifiers (collection session, farm,
  plant, leaf) **and** by their `sha256` content hash using a union-find over those keys.
  Two images that are byte-identical (same photo uploaded under different sessions) are
  locked into the same group — they can never land on opposite sides of a split.
  Images with *no* identifiers are treated as ungrouped and allocated by a stratified,
  seed-fixed fill.
- **Assignment.** Components are allocated per class by nearest-subset fit toward the
  declared 80/10/10 target (`SPLIT_RATIOS` in `ml/src/data/splitting.py`), so each split
  holds approximately the class's share of images. The archived V1.1 run below predates
  the 80/10/10 enforcement — it used a 20%/20% group assignment and recorded
  **train ≈ 60%, validation ≈ 20%, test ≈ 20%**. For V1.1 this produced 25 groups (6 of
  them duplicate-locked):
  **train 1,208 / validation 407 / test 404**, with per-class test support of
  100 / 101 / 101 / 102.
  - *Distribution-aware stratification (Sept 1, 2026).* Since the covariate-shift work,
    selection is additionally stratified, inside each class, by the group's *dominant*
    `background_type` (`white_removed` | `natural` | `unknown`, missing values default to
    `unknown`), so test and validation inherit the same background mix as the class as a
    whole. Ungrouped `natural` (in-situ) rows are prioritized into test so OOD evaluation
    is not starved of field-photo support.
- **Integrity audit.** Every split records the number of groups and duplicate-locked
  groups and reassigns training **and** test images to groups for a post-hoc audit, and
  (since Sept 1, 2026) records `background_dist` — exact per-`background_type` counts per
  split — so the test set's distribution composition is verifiable. The
  evaluation step re-checks the manifest for hash-level cross-split duplicates and refuses
  to evaluate (`evaluation refused: integrity failure`) if any are found. One earlier
  pipeline run was rejected by precisely this gate, which is how the two-session duplicate
  photo was caught.
- **Reproducibility.** Splits derive from a fixed seed (42) and a deterministic algorithm.

### 2.3 Training protocol

- **Architecture.** MobileNetV2 (torchvision, ImageNet init), input 224×224, dropout 0.5 on
  the classification head, 4 outputs.
- **Transfer learning (the controlled variable).**
  - *Baseline:* the entire pretrained backbone is frozen; only the new classification head
    learns — **5,124 trainable of 2,228,996** parameters.
  - *Partial fine-tune:* the final 5 of 19 feature blocks are unfrozen and train at a lower
    rate, head unfrozen at the normal rate — **1,686,468 trainable of 2,228,996**.
- **Optimization.** Adam; head LR 1e-4, backbone LR 1e-5 (discriminative fine-tuning);
  weight decay 1e-4; ReduceLROnPlateau (factor 0.5, patience 2); best-model checkpoint by
  validation loss; batch size 8; up to 20 epochs with early stopping (patience 5).
- **Augmentation.** Horizontal flip (p=0.5), rotation ±10°, mild brightness/contrast/
  saturation jitter — chosen so none of it distorts the lesion-color signal that defines
  the classes.
- **Determinism.** Fixed seed 42 for data order and initialization; results captured in
  `reports/experiments/EXP-V1.1-{B,FT}/` (per-epoch `history.json`, `report.json`,
  training curves).

### 2.4 Evaluation

- **Held-out test set.** n = 404 images (≈100 per class), isolated at split time and never
  touched during training, early-stopping, or hyperparameter decisions for this comparison.
- **Metrics.** Overall accuracy and macro-averaged F1, plus per-class precision, recall, and
  F1 (`reports/evaluation/V1.1_EXP-V1.1-{B,FT}/metrics.json`), confusion matrices, per-error
  galleries, and a difficulty/confidence analysis. All test-size supports exceed 30 per
  class, so the statistics warning in the pipeline does not apply.
- **Integrity gate.** Evaluation runs only if the hash-level integrity re-check passes;
  `test_set_integrity` reported `ok=True`, 0 problems across all splits.
- **Distribution-shift (covariate) evaluation (Sept 1, 2026).** Every evaluation writes a
  `distribution_shift.json` artifact (reference domain `white_removed`, OOD domain
  `natural`) with per-domain accuracy, macro-F1, and per-class F1, computed
  per-`background_type` over the test predictions. When a domain has no test rows it sets
  `no_domain_test_data: true` and a plain-language note explaining that OOD accuracy
  cannot be measured yet — rather than emitting a placeholder number. The insights layer
  mirrors this at runtime: served predictions are grouped by `backgroundType` × feedback
  verdict, and the API exposes the growing in-situ OOD pool plus the count of
  verified-corrected labels (expert disagrees with the model on a natural-background
  photo), which are the labeled OOD candidates for future retraining.

### 2.5 Results (corrected, V1.1, test n = 404)

| Candidate | Val acc (best epoch 19) | Val loss | **Test acc** | **Macro F1** | Rust F1 | Spot F1 | Blight F1 |
|---|---|---|---|---|---|---|---|
| `EXP-V1.1-B` (frozen, 5,124 params) | 0.693 | 0.715 | **0.611** | **0.617** | 0.430 | 0.443 | 0.642 |
| `EXP-V1.1-FT` (last-5 blocks, 1,686,468 params) | 0.772 | 0.504 | **0.671** | **0.677** | 0.534 | 0.428 | 0.753 |

### 2.6 The earlier sweep, and why it is reported as diagnostic only

The sweep (`ml/scripts/run_unfreeze_sweep.py`, results in
`ml/reports/sweeps/unfreeze_blocks_sweep.json`) varied unfreeze ∈ {0, 3, 5, 18} blocks and
epoch budget ∈ {20, 40}. Post hoc analysis of the logged runs proved that `3`, `5`, and
`18` produced **identical validation curves and identical test metrics** (0.6875 vs 0.6809
on the then-test set) because the backbone-frozen flag was not applied to `fine_tune`
strategy jobs — they were all full fine-tunes. The sweep results are therefore not
interpretable as block-count evidence; their value is diagnostic:

1. They exposed the wiring bug (identical curves = the knob was a no-op).
2. They established the 20-epoch budget is sufficient (a 40-epoch run early-stopped at
   epoch 13; the best full-FT checkpoint was at epoch 5).
3. They gave a calibration of full-fine-tune ceiling (~0.81 val / 0.69 test on V1.0
   including the then-leak), which motivated the corrected split and the lower, honest
   V1.1 numbers above.

### 2.7 Threats to validity

- **Class confusion is the main remaining error source**: rust-vs-spot confusions dominate
  the confusion matrices of both candidates; these two classes present with overlapping
  visual symptoms.
- V1.1 is a single cut with a single seed; test estimates carry sampling variance around
  ~100 images per class.
- Both candidates were early-stopped on validation; the test set was only used once, at
  evaluation time.
- **Covariate shift is structurally measured, but not yet statistically.**
  Background tagging, distribution-aware splits, and per-domain metrics (Sept 1, 2026)
  quantify a `white_removed`-vs-`natural` accuracy gap whenever the test set contains
  natural photos. For the corrected V1.1 comparison no `natural`-background test images
  existed (`no_domain_test_data`), so field generalization remains an unmeasured quantity
  there; it becomes measurable as expert-verified in-situ photos accumulate in the pool.
  Ingest tags are best-effort: if the ML service is unreachable, images still ingest with
  a missing background tag, and the missing-domain condition is reported honestly rather
  than guessed.

### 2.8 Artifacts

- Split audit + manifests: written to `ml/data/prepared/<run>_seed42{,_audit}.jsonl` at
  split time, `background_dist` (per-`background_type` counts per split) included since
  Sept 1, 2026. The original V1.1 manifests were cleared by the Sept 1 clean slate.
- Experiment logs: `ml/reports/experiments/EXP-V1.1-{B,FT}/`
- Evaluation bundles: `ml/reports/evaluation/V1.1_EXP-V1.1-{B,FT}/` — `metrics.json`
  (+ `distribution_shift.json` since Sept 1, 2026), confusion matrices, per-error galleries
- Model cards: `ml/models/V1.1_EXP-V1.1-{B,FT}/MODEL_CARD.md` (reproduced on retrain;
  model artifacts are gitignored and were reset by the Sept 1 clean slate)
- Sweep scripts + evidence: `ml/scripts/run_unfreeze_sweep.py`, `ml/scripts/eval_sweep_models.py`,
  `ml/reports/sweeps/unfreeze_blocks_sweep.json`, `ml/reports/evaluation/SWEEP_SWP_unfreeze{3,18}/`
- Registry: both V1.1 candidates were registered `experimental` (draft). The Sept 1, 2026
  clean slate (`scripts/clean_slate.sh`) reset the database registry and the
  active-model pointer, so a model must be retrained and re-registered before live
  predictions resume.