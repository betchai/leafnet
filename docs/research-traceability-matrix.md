# Research Traceability Matrix

Audit artifact mapping the approved methodology to the actual implementation.
Status legend: ✅ implemented · ⚠️ partial/conditional · ⬜ not yet (data-gated)

| Research Element | Methodology Statement | Implementation | Status |
|---|---|---|---|
| Classification task | 4-class single-label visual classification | `ml/src/config/classes.json`, enforced in API + UI | ✅ |
| Classes | healthy, leaf_rust, leaf_spot, leaf_blight | classes.json (single source of truth) | ✅ |
| Dataset target | 2,000 images (500/class) | `pipeline.json` datasetTargets; tracked live | ⚠️ 11/2,000 acquired |
| Partition | 80/10/10 | group-aware splitter + PILOT fallback documented | ✅ mechanism |
| Model | MobileNetV2 transfer learning | torchvision MobileNetV2, IMAGENET1K_V2 | ✅ |
| Transfer learning | pretrained + new head; frozen then fine-tune | `ml/src/training/model.py` (EXP-B frozen / EXP-FT unfrozen) | ✅ |
| Preprocessing | 224×224, ImageNet normalization | `build_transforms(train=False)` shared by training+inference | ✅ |
| Augmentation | train-only, realistic | hflip/rotation±10°/mild jitter, rationales recorded | ✅ |
| Evaluation: Accuracy | yes | `ml/src/evaluation/evaluate.py` | ✅ pipeline |
| Evaluation: Precision | per-class + macro/weighted | same | ✅ pipeline |
| Evaluation: Recall/Sensitivity | per-class + macro/weighted | same | ✅ pipeline |
| Evaluation: F1 | per-class + macro/weighted | same | ✅ pipeline |
| Confusion Matrix | 4×4 | CSV + PNG generated | ✅ pipeline |
| Test-set isolation | held out until formal evaluation | enforced (never loaded in training) | ✅ |
| Leakage prevention | grouped splitting | session/farm/plant/leaf keys + splitter | ✅ |
| Reproducibility | seeds + versions recorded | seeds, env, config in checkpoints/metadata | ✅ |
| Application | user-facing classification app | React → Node → FastAPI → PyTorch | ✅ |
| Feedback | collected without altering ground truth | Feedback rows + review workflow | ✅ |
| Formal research results | from full-dataset evaluation | **awaiting dataset completion** | ⬜ |

## Manuscript discrepancies requiring revision

See `docs/manuscript-implementation-check.md`.
