# Final Model Card — v0.2_EXP-0.2-B (frozen artifact)

> **PILOT model frozen for Phase-10 verification.** Phase 6 verdict at freeze:
> NOT READY for performance claims (11-image dataset, 1-image test set).
> This card documents the deployed artifact truthfully; it will be superseded
> by the card of the first real candidate trained on a complete dataset.

| Field | Value |
|---|---|
| Model version | v0.2_EXP-0.2-B |
| Architecture | MobileNetV2 (torchvision), transfer learning |
| Pretrained weights | IMAGENET1K_V2 (ImageNet, 1.2M images) |
| Transfer approach | Frozen backbone; new head Dropout(0.5)+Linear(1280→4) |
| Classes | healthy(0) · leaf_rust(1) · leaf_spot(2) · leaf_blight(3) |
| Dataset version | v0.2 (11 approved images: 2/3/3/3 per class) |
| Partition | 9 train / 1 validation / 1 test (PILOT fallback split) |
| Preprocessing | 224×224 bilinear resize, RGB, ImageNet normalization |
| Augmentation (train only) | hflip 0.5 · rotation ±10° · brightness/contrast jitter 0.15 |
| Training config | Adam 1e-4 · wd 1e-4 · batch 8 · seed 42 · early stop patience 5 |
| Best epoch / val loss | 6 / 1.4783 |
| **Test metrics** | accuracy 0.0 · macro F1 0.0 (**n=1 — statistically meaningless**) |
| Artifact | `ml/models/v0.2_EXP-0.2-B/model_best.pt` (~14 MB) |
| Artifact SHA-256 (prefix) | `a6e8c1ad51ce1cc2` — full hash in MANIFEST.json |
| Evaluation date | 2026-08-24 (Phase 6 pipeline) |

## Intended use
Pipeline demonstration and system verification only.

## NOT intended use
Any diagnosis, performance claim, thesis result figure, or production decision.

## Known limitations
See `docs/limitations.md` — dataset scale is the dominant one.
