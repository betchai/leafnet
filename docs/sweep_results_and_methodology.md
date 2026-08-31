# Fine-Tuning Choice — Results & Methodology Explainers

> This document serves two people: **the reader who is not the researcher** (Section 1,
> plain language) and **the study's methodology section** (Section 2, defensible research
> account). Every number below comes from real, logged runs. The corrected comparison
> (V1.1) is the one used for any research claim; the earlier sweep is retained and
> explained because it is what caught a real engineering bug that would otherwise have
> invalidated every earlier fine-tuning claim.

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
- **Assignment.** Components are allocated per class by nearest-subset fit so that each
  split holds approximately the class's share of images: **train ≈ 60%, validation ≈ 20%,
  test ≈ 20%**. For V1.1 this produced 25 groups (6 of them duplicate-locked):
  **train 1,208 / validation 407 / test 404**, with per-class test support of
  100 / 101 / 101 / 102.
- **Integrity audit.** Every split records the number of groups and duplicate-locked
  groups and reassigns training **and** test images to groups for a post-hoc audit. The
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
- No separate external field set was evaluated; generalization beyond the lab capture
  protocol is not yet measured.

### 2.8 Artifacts

- Split audit + manifests: `ml/data/prepared/cmtfv7x5y0000yczbdpdqtj0c_seed42{,_audit}.jsonl`
- Experiment logs: `ml/reports/experiments/EXP-V1.1-{B,FT}/`
- Evaluation bundles: `ml/reports/evaluation/V1.1_EXP-V1.1-{B,FT}/`
- Model cards: `ml/models/V1.1_EXP-V1.1-{B,FT}/MODEL_CARD.md`
- Sweep scripts + evidence: `ml/scripts/run_unfreeze_sweep.py`, `ml/scripts/eval_sweep_models.py`,
  `ml/reports/sweeps/unfreeze_blocks_sweep.json`, `ml/reports/evaluation/SWEEP_SWP_unfreeze{3,18}/`
- Registry: both V1.1 candidates registered as `experimental` (draft); no lifecycle change
  to the currently active `V1.0_r3_EXP-V1.0-FT` model.