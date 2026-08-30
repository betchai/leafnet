# Phase 7 Status — Python ML API & Inference Layer

**Date:** 2026-08-24
**Mode note:** Phase 6 concluded **NOT READY** (no production-approved model). Per the
phase rule "do not invent a production model," this phase delivers the complete,
production-grade inference *service* and validates it against the clearly-labeled
PILOT checkpoint (`v0.2_EXP-0.2-B`, 11 images). No production claims are made.

---

## 1. Objective
Turn the trained MobileNetV2 candidate into a reliable, versioned, independently
runnable Python inference service consumed by Node.js over HTTP.

## 2. Model
`v0.2_EXP-0.2-B` — MobileNetV2, IMAGENET1K_V2 pretrained, frozen-backbone pilot.
Dataset v0.2 · class mapping from `ml/src/config/classes.json` (single source of truth).
Selected via `ml/models/active.json` pointer; unnamed artifacts refused; path traversal refused.

## 3. Service architecture

```
ml/src/api/main.py          FastAPI app (/health /model /predict /predict/batch)
ml/src/api/schemas.py       Pydantic response models
ml/src/inference/model_loader.py    explicit-version loader + traceability
ml/src/inference/preprocessing.py   validation + eval transforms (reuses training pipeline)
ml/src/inference/predictor.py       forward pass, softmax, top-k, review flag
```
Model loaded once at startup into eval mode; device auto-detected (CPU here, CUDA supported);
warm-up inference with a synthetic zero-tensor fixture at startup.

## 4. Endpoints (all live-verified)
- `GET /health` → healthy/degraded/unhealthy + device + model version
- `GET /model` → full traceability: architecture, dataset version, classes, preprocessing config, checkpoint sha256 prefix, file size, evaluation summary from Phase-6 metrics
- `POST /predict` → validation → preprocessing → inference → softmax → class mapping → structured JSON incl. 4-class probabilities, ranked top-k, second class, margin, `review_recommended`, timings, disclaimer
- `POST /predict/batch` → internal, ≤100 images

## 5. Inference pipeline
Upload → validate (format/size/dimensions/mode) → deterministic eval transforms
(identical to training-eval; zero augmentation) → MobileNetV2 → softmax →
class mapping → response. Preprocessing literally reuses the training module's
transforms — one definition in the codebase.

## 6. Confidence handling
`confidence` = predicted-class probability (softmax). Documented as NOT calibrated
correctness probability. `review_recommended=true` when confidence < configurable
threshold (default 0.50) — explicitly labeled as configuration, not validated science.

## 7. Performance (measured, macOS CPU, PyTorch 2.13)
| Metric | Value |
|---|---|
| Cold model load | ~1–2 s |
| Model size | ~14 MB checkpoint |
| Warm inference | ~17–26 ms |
| Total request latency | ~22–37 ms |

Single measurements on dev fixtures — not production benchmarking.

## 8. Testing
47/47 pytest pass total, including 13 new Phase-7 tests: input validation
(corrupt/small/oversized), preprocessing determinism + no-augmentation guarantee,
softmax distribution sums to 1, top-k correctness, configurable threshold both ways,
path-traversal refusal on active-model pointer, missing-pointer error,
live integration tests against the running service (/health, /model, /predict
reproducibility across identical requests, invalid image → 422).

## 9. Security/input validation
20 MB upload cap · JPEG/PNG only · dimension bounds (32–8000px) · color-mode check ·
no filesystem access from user input · no arbitrary model loading · no stack traces to clients ·
no raw image data or credentials logged (request-ID + outcome only).

## 10. Artifacts
`ml/src/api/{main.py,schemas.py}` · `ml/src/inference/{model_loader.py,preprocessing.py,predictor.py}` ·
`ml/models/active.json` (pilot pointer) · `ml/tests/test_inference_api.py` · `docs/ml-api.md`

## 11. Node.js integration contract
Documented in `docs/ml-api.md` §"Node.js integration contract" — already implemented
by `apps/api/src/routes/predictions.ts` (multipart forward, 503 fallback, prediction
persistence with model version + disclaimer). Ready for Phase 8 consumption unchanged.

## 12. Known limitations
1. Active model is a PILOT — outputs are demo-grade until Phase 6 re-runs on a complete dataset.
2. Single-process, in-memory model — no multi-worker/GPU serving config yet (fine for research scale).
3. Calibration not performed → confidence interpretation stays cautious.
4. Old `src/inference/service.py` beta entrypoint superseded by `src/api/main.py`; kept for reference, scheduled for deletion.

## 13. Phase 8 readiness: **READY WITH CONDITIONS**

The service layer is complete, tested, documented, and contract-compatible with
the existing Node integration. Conditions:
1. The served model remains PILOT-grade until dataset completion + Phase 6 re-run.
2. Before any public/user-facing deployment: purge pilot models from the registry
   and promote a real candidate (human decision).
3. Multi-worker deployment config deferred to real hosting needs.

**Stopping here per phase boundary.** No retraining, no taxonomy changes, no test-set access, no fabricated predictions.
