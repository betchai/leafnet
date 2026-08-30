# Phase 5 Status — MobileNetV2 Transfer-Learning Training

**Date:** 2026-08-24
**Agreed mode:** PILOT — pipeline construction + validation on the current v0.2 dataset (11 images), per the plan accepted before this phase. A defensible research training run remains gated on dataset completion.

---

## 1. Training objective

Implement and validate the full reproducible MobileNetV2 transfer-learning
pipeline (manifest → grouped split → preflight → augment → train → checkpoint →
experiment report), and run pilot experiments proving it end-to-end.

## 2. Dataset

- **Version:** v0.2 (locked; manifest fetched from the API, cached to `ml/data/prepared/`)
- **Counts:** 11 approved images → 9 train / 1 validation / 1 test (isolated)
- **Class mapping:** healthy=0 · leaf_rust=1 · leaf_spot=2 · leaf_blight=3 (from `ml/src/config/classes.json` — single source of truth)
- Split note: **PILOT deviation** — image-level split used because only 2 collection-session groups exist (grouped splitting kept everything in train). Recorded in the audit file; research runs will use grouped splitting.

## 3. Model

- torchvision **MobileNetV2**, pretrained `IMAGENET1K_V2` (weights id recorded in every checkpoint/metadata)
- Original ImageNet classifier removed (`nn.Identity`); new head: Dropout(0.5) → Linear(1280→4)
- EXP-001: frozen backbone (≈12.8k trainable params); EXP-002: last 3 blocks unfrozen
- Preprocessing: resize 224×224, ImageNet normalization (required by pretrained weights), RGB-forced
- Augmentation (train only): hflip p=0.5, rotation ±10°, mild color jitter — each with a documented rationale in `training.json`

## 4. Experiments

| ID | Strategy | Epochs | Best epoch | Best val loss | Best val acc* |
|---|---|---|---|---|---|
| EXP-001 | frozen backbone | 8 | 6 | 1.4783 | 0.0 |
| EXP-002 | fine-tune last 3 blocks | 8 | 7 | 1.3665 | 0.0 |

\* Validation set = 1 image. These numbers carry zero scientific meaning and are recorded solely as evidence the loop works.

## 5. Training configuration (actual values)

Adam, lr 1e-4 (head), weight_decay 1e-4, batch 8, seed 42, ReduceLROnPlateau (factor 0.5, patience 2), early stopping patience 5, num_workers 0, dropout 0.5. All values centralized in `ml/src/config/training.json`; per-experiment actuals in `reports/experiments/*/config.json`.

## 6. Training results — NOT final performance

See table above. Full histories: `reports/experiments/*/history.json`, curves in `training_curves.png` (explicitly labeled "NOT final test performance").

## 7. Training behavior

- EXP-002's training loss fell further than EXP-001 (1.19 vs 1.36 by epoch 8) — consistent with more capacity being trainable.
- No meaningful overfitting/convergence conclusions are possible at n=9/1.
- Preflight correctly REFUSED a first attempt (grouped split produced empty validation) — failure handling works as specified.

## 8. Candidate model for Phase 6

**None yet — by design.** Both models are marked `PILOT_PIPELINE_VALIDATION`.
When the dataset reaches readiness, re-run:
```
python scripts/run_experiment.py --dataset-id <vX-id> --exp EXP-00N --strategy baseline|fine_tune
```
and send the resulting candidates to Phase 6. If both strategies perform comparably on real data, send both.

## 9. Reproducibility

Seeds set (Python/NumPy/PyTorch/DataLoader generator). Environment recorded in every `metadata.json`: Python 3.14, PyTorch 2.13.0+cpu, torchvision 0.28.0, CUDA absent, macOS platform string, dataset version, class mapping, config, pretrained weight id.

## 10. Artifacts

- `ml/models/v0.2_EXP-00{1,2}/`: `model_best.pt`, `model_latest.pt`, `metadata.json`, `training_history.json`, `class_mapping.json`
- `ml/reports/experiments/EXP-00{1,2}/`: `config.json`, `history.json`, `report.json`, `training_curves.png`
- `ml/models/MODEL_CARDS_PILOT.md`
- Candidates registered in DB as ModelVersions `v0.2_EXP-001/002` (no fabricated metrics)

## 11. Issues

1. Pilot split deviates from grouped methodology (documented above).
2. Single LR group currently applies head-lr to unfrozen backbone too — real runs should use param groups (head 1e-4 / backbone 1e-5; both already in config).
3. torch hub download needed manual cert workaround once.
4. Dataset is far below target (11/2,000) — see Phase 4 status.

## 12. Phase 6 handoff

Phase 6 (evaluation) receives: candidate registration pattern, isolated test split mechanism (rows with `split=test` in prepared manifests — never loaded during Phase 5), evaluation module stub at `ml/src/evaluation/metrics.py`, model cards template, and the rule that test metrics may be computed exactly once per candidate.

## Tests performed

31/31 pytest pass (22 prior + 9 new: taxonomy mapping, head shape, freeze/fine-tune parameter counts, deterministic eval transforms, skip logging, checkpoint roundtrip, preflight rejections incl. leakage/non-approved labels, tiny end-to-end fixture training).

**STRICT BOUNDARY HELD:** no test-set predictions, no accuracy claims, no deployment, no inference API. Stopping here.
