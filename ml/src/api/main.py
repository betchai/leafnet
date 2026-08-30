"""LEAFNET ML inference service (Phase 7).

Independent FastAPI service. Loads ONE explicitly-identified model from
ml/models/active.json at startup; serves /health, /model, /predict.

Run:
    cd ml && .venv/bin/python -m uvicorn src.api.main:app --port 8000

IMPORTANT STATUS CONTEXT: Phase 6 concluded NOT READY — no production-approved
model exists. The currently active model (if configured) is a PILOT trained on
11 images; responses carry pilot disclaimers until a real candidate is promoted.
"""

from __future__ import annotations

import base64
import json
import logging
import sys
import time
import uuid
from pathlib import Path

import torch
from fastapi import FastAPI, File, HTTPException, UploadFile

ML_ROOT = Path(__file__).resolve().parents[2]
if str(ML_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_ROOT))

from src.inference import model_loader, preprocessing as pre  # noqa: E402
from src.inference.predictor import apply_review_flag, predict_tensor  # noqa: E402
from src.inference import saliency  # noqa: E402
from src.api.schemas import (  # noqa: E402
    HealthResponse,
    ModelInfoResponse,
    PredictionResponse,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("leafnet-ml")

# ---- configuration (controlled; never from user input) ----
CONFIG_PATH = ML_ROOT / "src" / "config" / "training.json"
CLASSES_PATH = ML_ROOT / "src" / "config" / "classes.json"
LOW_CONFIDENCE_THRESHOLD = 0.50  # configurable flag, NOT a validated boundary
DISCLAIMER = (
    "Visual classification suggestion only. Not a biological diagnosis. "
    "Confidence is the predicted class probability, not calibrated correctness."
)

_config = pre.load_config(CONFIG_PATH)
_bundle: dict | None = None
_load_error: str | None = None


def get_bundle() -> dict:
    global _bundle, _load_error
    if _bundle is None:
        try:
            _bundle = model_loader.load_active_model()
            _load_error = None
            log.info("model loaded: %s on %s in %ss", _bundle["version_id"],
                     _bundle["device"], _bundle["load_seconds"])
        except Exception as exc:  # noqa: BLE001
            _load_error = str(exc)
            log.error("model load failed: %s", exc)
    if _bundle is None:
        raise HTTPException(status_code=503, detail=f"model unavailable: {_load_error}")
    return _bundle


def warm_up(bundle: dict) -> None:
    """Verify weights+preprocessing+device with a synthetic DEV fixture tensor.
    Never presented as a real prediction."""
    x = torch.zeros(1, 3, *_config["preprocessing"]["resize"])
    with torch.no_grad():
        logits = bundle["model"](x.to(bundle["device"]))
    expected = len(bundle["ckpt"]["class_mapping"])
    assert logits.shape[-1] == expected, f"warm-up shape mismatch: {logits.shape} != {expected}"
    log.info("warm-up inference OK (synthetic fixture, logits shape %s)", list(logits.shape))


def display_names() -> dict[str, str]:
    raw = json.loads(CLASSES_PATH.read_text())
    return {c["key"]: c.get("display_name", c["key"]) for c in raw["classes"]}


def is_pilot(bundle: dict) -> bool:
    notes = bundle["metadata"].get("notes", "").upper()
    return "PILOT" in notes or "PIPELINE VALIDATION" in notes


app = FastAPI(
    title="LEAFNET ML Inference Service",
    version="1.0.0-phase7",
    description=(
        "Four-class mulberry leaf visual classification. Confidence values are "
        "predicted-class probabilities (softmax), NOT calibrated probabilities of "
        "correctness and NOT diagnoses."
    ),
)

# PIPELINE: automated Step-9/10/11 runner
from src.inference.pipeline import router as pipeline_router  # noqa: E402
app.include_router(pipeline_router)

# INSIGHTS: research analytics endpoints (Phase 9)
from src.api.insights_router import router as insights_router  # noqa: E402
app.include_router(insights_router)


@app.on_event("startup")
def startup() -> None:
    log.info("starting LEAFNET ML service")
    try:
        warm_up(get_bundle())
    except HTTPException:
        pass  # no active model configured — service starts degraded/unhealthy
    except Exception as exc:  # noqa: BLE001
        log.error("startup degraded: %s", exc)


@app.get("/health", response_model=HealthResponse)
def health():
    loaded = _bundle is not None
    return HealthResponse(
        status="healthy" if loaded else "unhealthy",
        model_loaded=loaded,
        model_version=_bundle["version_id"] if loaded else None,
        device=str(_bundle["device"]) if loaded else None,
    )


@app.get("/model", response_model=ModelInfoResponse)
def model_info():
    b = get_bundle()
    ev_summary = {}
    ev_path = ML_ROOT / "reports" / "evaluation" / b["version_id"] / "metrics.json"
    if ev_path.exists():
        m = json.loads(ev_path.read_text())
        ev_summary = {"accuracy": m["metrics"]["accuracy"], "test_size": m["test_size"]}
    return ModelInfoResponse(
        model_version=b["version_id"],
        architecture="mobilenet_v2_transfer_learning",
        pretrained_weights=b["metadata"].get(
            "pretrained_weights", f"torchvision.{b['ckpt'].get('pretrained_weights', '')}"
        ),
        dataset_version=b["ckpt"]["dataset_version"],
        classes=b["ckpt"]["class_mapping"],
        preprocessing={"config": _config["preprocessing"], "augmentation_at_inference": False},
        evaluation_summary=ev_summary or None,
        checkpoint_sha256_prefix=b["sha256_prefix"],
        file_size_bytes=b["file_size_bytes"],
        load_seconds=b["load_seconds"],
    )


@app.post("/predict", response_model=PredictionResponse)
async def predict(file: UploadFile = File(...)):
    request_id = uuid.uuid4().hex[:12]
    t0 = time.perf_counter()
    b = get_bundle()

    data = await file.read()
    try:
        img = pre.validate_image_bytes(data)
    except ValueError as exc:
        log.info("%s validation_rejected reason=%s", request_id, exc)
        raise HTTPException(status_code=422, detail=str(exc)) from None

    tensor = pre.preprocess(img, _config)
    result = predict_tensor(b["model"], b["device"], b["ckpt"]["class_mapping"], tensor)
    result = apply_review_flag(result, LOW_CONFIDENCE_THRESHOLD)

    total_ms = round((time.perf_counter() - t0) * 1000, 2)
    log.info("%s predicted=%s confidence=%s review=%s inference_ms=%s total_ms=%s",
             request_id, result["predicted_class"], result["confidence"],
             result["review_recommended"], result["inference_ms"], total_ms)

    pilot_suffix = " [pilot-grade model]" if is_pilot(b) else ""
    return PredictionResponse(
        model_version=b["version_id"],
        predicted_class=result["predicted_class"],
        display_name=display_names().get(result["predicted_class"], result["predicted_class"]),
        confidence=result["confidence"],
        probabilities=result["probabilities"],
        top_k=result["top_k"],
        review_recommended=result["review_recommended"],
        inference_ms=result["inference_ms"],
        preprocessing_version="training-config-eval-v1",
        dataset_version=b["ckpt"]["dataset_version"],
        disclaimer=DISCLAIMER + pilot_suffix,
    )


@app.post("/explain")
async def explain(file: UploadFile = File(...)):
    """Predict + render input-gradient saliency for the uploaded leaf.

    Returns base64 PNG (3-panel figure) + the probability story so the UI can
    show *why* the model scored the image the way it did. Influence map only —
    not a diagnosis and not a segmentation.
    """
    request_id = uuid.uuid4().hex[:12]
    t0 = time.perf_counter()
    b = get_bundle()

    data = await file.read()
    try:
        img = pre.validate_image_bytes(data)
    except ValueError as exc:
        log.info("%s explain validation_rejected reason=%s", request_id, exc)
        raise HTTPException(status_code=422, detail=str(exc)) from None

    tensor = pre.preprocess(img, _config)
    mapping = b["ckpt"]["class_mapping"]
    result = predict_tensor(b["model"], b["device"], mapping, tensor)

    top = result["predicted_class"]
    second = result.get("second_class")
    if not second:
        raise HTTPException(status_code=500, detail="explain requires >= 2 classes")

    try:
        sal_top = saliency.input_gradient_saliency(
            b["model"], b["device"], tensor, mapping[top])
        sal_second = saliency.input_gradient_saliency(
            b["model"], b["device"], tensor, mapping[second])
        names = display_names()
        png = saliency.render_explanation(
            img,
            sal_top,
            sal_second,
            tuple(_config["preprocessing"]["resize"]),
            top_title=f"{names.get(top, top)} — {result['confidence']:.2f}",
            second_title=f"{names.get(second, second)} — {result['probabilities'].get(second, 0):.2f}",
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — rendering must never take down the service
        log.error("%s explain render failed: %s", request_id, exc)
        raise HTTPException(status_code=500, detail="saliency rendering failed") from exc

    total_ms = round((time.perf_counter() - t0) * 1000, 2)
    log.info("%s explain predicted=%s second=%s total_ms=%s",
             request_id, top, second, total_ms)

    return {
        "predicted_class": top,
        "second_class": second,
        "confidence": result["confidence"],
        "probabilities": result["probabilities"],
        "saliency_png_base64": base64.b64encode(png).decode(),
        "model_version": b["version_id"],
    }


@app.post("/predict/batch")
async def predict_batch(files: list[UploadFile] = File(...)):
    """Internal batch endpoint for research verification/regression testing."""
    if len(files) > 100:
        raise HTTPException(status_code=413, detail="batch limited to 100 images")
    b = get_bundle()
    results = []
    for f in files:
        try:
            img = pre.validate_image_bytes(await f.read())
            tensor = pre.preprocess(img, _config)
            r = predict_tensor(b["model"], b["device"], b["ckpt"]["class_mapping"], tensor)
            results.append({"filename": f.filename,
                            **{k: r[k] for k in ("predicted_class", "confidence")}})
        except ValueError as exc:
            results.append({"filename": f.filename, "error": str(exc)})
    return {"model_version": b["version_id"], "results": results}
