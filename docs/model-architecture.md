# MobileNetV2 Architecture & LEAFNET Implementation

A reference document for the research defense: what the model is, how it was
adapted for LEAFNET, and where every piece lives in the codebase.

---

## 1. What is MobileNetV2?

MobileNetV2 (Sandler et al., 2018 — *"MobileNetV2: Inverted Residuals and
Linear Bottlenecks"*, Google) is a convolutional neural network designed for
efficient image classification on resource-constrained devices.

### Two key innovations

**a) Depthwise separable convolutions**

A standard convolution does two jobs at once: *filtering* (spatial patterns)
and *combining* (across channels). MobileNetV2 splits these:

```
Standard convolution:            Depthwise separable:
┌─────────────────────┐          ┌──────────────┐   ┌──────────────┐
│ filter + combine    │          │ depthwise    │ + │ pointwise    │
│ (one heavy op)      │          │ (per-channel)│   │ 1×1 combine  │
└─────────────────────┘          └──────────────┘   └──────────────┘
```

Result: roughly **8–9× fewer computations** for similar accuracy.

**b) Inverted residuals with linear bottlenecks**

Each block expands to a *thin → wide → thin* pattern with a residual
(skip) connection between the narrow ends. Preserves information across layers
while keeping the network slim.

### Specifications

| Property | Value |
|---|---|
| Parameters | ~3.5 M |
| Input | 224 × 224 × 3 (RGB) |
| Output feature vector | 1280-dim |
| Original classes | 1000 (ImageNet) |
| Pretrained knowledge | 1.2M ImageNet images |

---

## 2. Transfer learning strategy

Training a CNN from scratch requires millions of images. LEAFNET's dataset is
2,000 images, so we use **transfer learning**: reuse the visual knowledge the
network learned from ImageNet, and retrain only what needs to change.

```
                 ┌──────────────────────────────────────┐
Leaf photo       │  MobileNetV2 backbone (19 blocks)     │
224×224×3  ────► │  Conv → Bottlenecks → Conv (1280)     │
                 │  Weights from ImageNet pretraining    │
                 └──────────────┬───────────────────────┘
                                │ 1280-dim feature vector
                                ▼
                 ┌──────────────────────────────────────┐
                 │  NEW task head (replaces ImageNet's)  │
                 │  Dropout(0.5)                         │
                 │  Linear(1280 → 4)                     │
                 └──────────────┬───────────────────────┘
                                ▼
        Softmax probabilities over EXACTLY four classes:
        healthy · leaf_rust · leaf_spot · leaf_blight
```

The original ImageNet classifier head is **removed entirely**
(`backbone.classifier = nn.Identity()`), not reused.

---

## 3. The two controlled experiments

| | EXP-B (baseline) | EXP-FT (fine-tune) |
|---|---|---|
| Backbone blocks 1–14 | frozen ❄️ | frozen ❄️ |
| Last N blocks (N=3–5) | frozen ❄️ | **unfrozen 🔥** |
| New 4-class head | trained 🎯 | trained 🎯 |
| Trainable params | ~5,124 | up to ~2.23M |
| Learning rate | 1e-4 | 1e-4 (head); lower for backbone recommended |

Exactly one variable changes between them (freeze strategy), so any performance
difference is attributable to fine-tuning.

---

## 4. Preprocessing (inference = training-eval, identical code)

```
JPEG/PNG upload
  → force RGB (3 channels)
  → resize 224 × 224 (bilinear)
  → tensor conversion [0..1]
  → normalize with ImageNet statistics
      mean = (0.485, 0.456, 0.406), std = (0.229, 0.224, 0.225)
      ← REQUIRED: matches what the pretrained weights expect
```

No augmentation at inference; fully deterministic.

## 5. Augmentation (training split ONLY)

| Transform | Setting | Rationale |
|---|---|---|
| Horizontal flip | p=0.5 | leaf symptoms are left–right symmetric |
| Rotation | ±10° | handheld photos arrive tilted |
| Brightness/contrast jitter | 0.15 | mimics lighting variation without distorting lesion colors that define the classes |

Vertical flip disabled (leaves have an orientation relative to stem/light).
Never applied to validation or test data.

---

## 6. Training configuration

| Hyperparameter | Value | Notes |
|---|---|---|
| Optimizer | Adam | methodology reference value |
| Learning rate (head) | 0.0001 | methodology reference value |
| Weight decay | 0.0001 | L2 regularization |
| Batch size | 8 | small-dataset appropriate |
| Epochs | ≤20 | early stopping decides actual stop |
| Early stopping | patience 5 on val loss | prevents overfitting continuation |
| Scheduler | ReduceLROnPlateau (×0.5) | adaptive lr reduction |
| Dropout | 0.5 | regularization in the new head |
| Random seed | 42 | reproducibility |
| Loss | CrossEntropyLoss ("categorical cross-entropy") | single-label 4-class |

All values are centralized in `ml/src/config/training.json` and copied into
each experiment's `config.json` at run time — recorded, never implicit.

---

## 7. Where it lives in the code

| Concern | File |
|---|---|
| Model factory (`create_mobilenetv2`) + `LeafNet` abstraction + checkpoint I/O | `ml/src/training/model.py` |
| Class definitions (single source of truth) | `ml/src/config/classes.json` |
| Training hyperparameters / augmentation / preprocessing config | `ml/src/config/training.json` |
| Dataset loading, splits, transforms, DataLoaders | `ml/src/training/data.py` |
| Preflight integrity checks | `ml/src/training/preflight.py` |
| Training loop, early stopping, checkpointing | `ml/src/training/train.py` |
| Experiment runner CLI | `ml/scripts/run_experiment.py` |
| Test-set evaluation (Phase 6) | `ml/src/evaluation/evaluate.py`, `ml/scripts/evaluate.py` |
| Inference service (serving the model over HTTP) | `ml/src/api/main.py`, `ml/src/inference/*` |
| Trained artifacts per experiment | `ml/models/<version>/model_best.pt` (+ metadata, history, class mapping) |

---

## 8. End-to-end data flow (defense summary diagram)

```
FIELD PHOTO (JPEG/PNG)
   ↓  upload (multipart)
NODE.JS API :4000  ── validate size/type, hash, persist metadata → PostgreSQL
   ↓  HTTP forward (10 s timeout)
PYTHON FASTAPI :8000 ── validate + decode image (Pillow)
   ↓  resize 224×224 → tensor → ImageNet normalize
MOBILENETV2 (frozen features + trained head)
   ↓  logits (4 values)
SOFTMAX → probabilities (sum = 1)
   ↓  argmax + class mapping from classes.json
JSON RESPONSE {predicted_class, confidence, top_k, review_recommended}
   ↓
NODE API persists Prediction (+ full distribution) linked to Image + ModelVersion
   ↓
REACT UI shows prediction, confidence bar, ranked alternatives, feedback form
```

Every prediction response carries its `model_version` and `dataset_version`,
so any result can be traced back to the exact training data and evaluation record.
