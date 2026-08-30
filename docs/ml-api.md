# LEAFNET ML API — Inference Service (Phase 7)

Independent FastAPI service exposing the active MobileNetV2 candidate.

> **Status context:** Phase 6 verdict was NOT READY — no production-approved
> model exists. The currently configured active model is a PILOT
> (`v0.2_EXP-0.2-B`, 11 images). Every response carries a disclaimer and pilot
> flag. Do not treat any output as research-grade until Phase 6 is re-run on a
> complete dataset.

## Running

```bash
cd ml && .venv/bin/python -m uvicorn src.api.main:app --port 8000
# interactive docs: http://localhost:8000/docs
```

The service loads the model named in `ml/models/active.json`
(`{"model_version": "..."}`) **once at startup**. It never loads models from
user input. If the file is missing or invalid, the service starts *unhealthy*
(`/health` → `"unhealthy"`) rather than crashing or pretending.

## Endpoints

### `GET /health`
```json
{ "status": "healthy", "model_loaded": true,
  "model_version": "v0.2_EXP-0.2-B", "device": "cpu" }
```

### `GET /model`
Model traceability bundle:
```json
{
  "model_version": "v0.2_EXP-0.2-B",
  "architecture": "mobilenet_v2_transfer_learning",
  "pretrained_weights": "...",
  "dataset_version": "v0.2",
  "classes": {"healthy": 0, "leaf_rust": 1, "leaf_spot": 2, "leaf_blight": 3},
  "preprocessing": {"config": {...}, "augmentation_at_inference": false},
  "evaluation_summary": {...},   // from Phase-6 metrics.json if present
  "checkpoint_sha256_prefix": "…16 hex…"
}
```

### `POST /predict` — multipart image upload

```bash
curl -X POST localhost:8000/predict -F "file=@leaf.jpg"
```

```json
{
  "model_version": "v0.2_EXP-0.2-B",
  "predicted_class": "leaf_rust",
  "display_name": "Mulberry Leaf Rust",
  "confidence": 0.3079,
  "probabilities": { "healthy": 0.2047, "leaf_rust": 0.3079,
                     "leaf_spot": 0.2361, "leaf_blight": 0.2514 },
  "top_k": [ {"rank":1,"class":"leaf_rust","probability":0.3079}, … ],
  "review_recommended": true,
  "inference_ms": 25.7,
  "preprocessing_version": "training-config-eval-v1",
  "dataset_version": "v0.2",
  "disclaimer": "Visual classification suggestion only. …"
}
```
*(Example values from a PILOT model — not real research predictions.)*

**Confidence terminology:** `confidence` = predicted class probability
(softmax). It is NOT calibrated probability of correctness (Phase 6 found no
calibration evidence). `review_recommended=true` means confidence fell below
the configurable threshold (`LOW_CONFIDENCE_THRESHOLD = 0.50` in
`src/api/main.py`) — a configuration flag, not a validated boundary.

Errors: `422` invalid/corrupt/oversized image (with reason) · `503` model unavailable · `413` batch too large.

### `POST /predict/batch` — internal use only
Up to 100 images; per-file results. For regression testing/research verification, not the app UI.

## Guarantees & rules implemented

- Preprocessing reuses `build_transforms(train=False)` from the training code — one definition, deterministic, no augmentation
- Class mapping loaded from `ml/src/config/classes.json` via checkpoint — no duplication
- Active model comes only from `models/active.json`; path traversal refused; unnamed artifacts refused
- Checkpoint must contain dataset version + class mapping or loading fails
- Warm-up at startup uses a synthetic zero tensor (a dev fixture), never presented as a prediction
- No stack traces leaked to clients; request-ID logging without image data

## Node.js integration contract (for Phase 8)

| Item | Value |
|---|---|
| Base URL | `ML_SERVICE_URL` env (e.g. `http://localhost:8000`) |
| Health check | `GET /health` — treat `status != "healthy"` as unavailable |
| Model info | `GET /model` |
| Predict | `POST /predict`, multipart field `file`, JPEG/PNG ≤20 MB |
| Timeout | recommend 10s per request |
| Errors | `422` client error (show message to user) · `503`/network error → honest "no model" state |
| Response | always contains `model_version`, `disclaimer`; store both with the prediction |
| Persistence | Node owns PostgreSQL writes; this service persists nothing |

Existing consumer: `apps/api/src/routes/predictions.ts` already implements this contract.
