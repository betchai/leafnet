"""Predictor — model forward pass + postprocessing into the response schema.

Confidence terminology: the returned value is the "predicted class probability"
(softmax). It is NOT calibrated probability of correctness — Phase 6 found no
calibration evidence, and the low-confidence threshold is a configurable flag,
not a validated decision boundary.
"""

from __future__ import annotations

import time

import torch

from src.training.data import build_transforms  # noqa: F401  (consistency re-export)


def predict_tensor(model, device, class_mapping: dict, tensor: torch.Tensor) -> dict:
    """Run inference on one preprocessed batch-of-1 tensor. Deterministic."""
    t0 = time.perf_counter()
    with torch.no_grad():
        logits = model(tensor.to(device))
        probs = torch.softmax(logits[0], dim=0)
    inference_ms = round((time.perf_counter() - t0) * 1000, 2)

    id_to_key = {v: k for k, v in class_mapping.items()}
    probabilities = {id_to_key[i]: float(p) for i, p in enumerate(probs)}
    ranked = sorted(probabilities.items(), key=lambda kv: -kv[1])
    top_key, confidence = ranked[0]

    return {
        "predicted_class": top_key,
        "confidence": round(confidence, 4),
        "probabilities": {k: round(v, 4) for k, v in probabilities.items()},
        "top_k": [
            {"rank": i + 1, "class": k, "probability": round(p, 4)}
            for i, (k, p) in enumerate(ranked)
        ],
        "second_class": ranked[1][0] if len(ranked) > 1 else None,
        "margin": round(ranked[0][1] - (ranked[1][1] if len(ranked) > 1 else 0), 4),
        "inference_ms": inference_ms,
    }


def apply_review_flag(result: dict, threshold: float) -> dict:
    """Flag low-confidence predictions for human review.

    The threshold is configuration, NOT a scientifically validated boundary.
    """
    result = dict(result)
    result["review_recommended"] = bool(result["confidence"] < threshold)
    if result["review_recommended"]:
        result["review_reason"] = (
            f"confidence {result['confidence']} below configured review threshold {threshold}"
        )
    return result
