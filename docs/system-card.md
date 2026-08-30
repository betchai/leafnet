# LEAFNET System Card

## Purpose
Visual classification of mulberry leaf health from photographs to support
sericulture research and farmer decision support — as a *suggestion tool*, not a diagnostic device.

## Input / Output
- **Input:** a mulberry leaf photograph (JPEG/PNG ≤20 MB)
- **Output:** one of four classes with probability distribution:
  Healthy · Leaf Rust · Leaf Spot · Leaf Blight

## Model
MobileNetV2 (ImageNet-pretrained) + custom 4-class head, transfer learning.
See `docs/final-model-card.md`.

## Architecture
React + TypeScript + Tailwind → Node.js REST API → Python FastAPI ML service → PyTorch/MobileNetV2.
PostgreSQL stores images metadata, predictions (with full distributions), feedback,
model/dataset versions, and audit trails. Original files live on disk.

## Data distinction (critical)
- **Research dataset:** frozen versioned snapshots used for training/evaluation
- **Application data:** user uploads and predictions — analyzed separately, never mixed into research metrics
- User feedback never automatically becomes ground truth or training data

## Human oversight
All ground truth requires named-expert confirmation. Application feedback enters
a review queue; only expert-verified labels become candidate training data, and
promotion into a dataset version is an explicit researcher action.

## Limitations & Risks
See `docs/limitations.md`. Headlines: pilot-scale data; geographic narrowness;
spot/blight visual ambiguity; uncalibrated confidence; no authentication yet.

## Intended users
Researchers and students (current). Farmers/advisers only after dataset
completion, formal evaluation, expert sign-off, and deployment hardening.
