"""Schemas for the LEAFNET ML inference API (Pydantic)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class TopKEntry(BaseModel):
    rank: int
    class_: str = Field(alias="class")
    probability: float

    model_config = {"populate_by_name": True}


class PredictionResponse(BaseModel):
    model_version: str
    predicted_class: str
    display_name: str
    confidence: float = Field(description="Predicted class probability (softmax). NOT calibrated probability of correctness.")
    probabilities: dict[str, float]
    top_k: list[TopKEntry]
    review_recommended: bool
    inference_ms: float
    preprocessing_version: str
    dataset_version: str
    disclaimer: str


class HealthResponse(BaseModel):
    status: str  # healthy | degraded | unhealthy
    model_loaded: bool
    model_version: str | None = None
    device: str | None = None


class ModelInfoResponse(BaseModel):
    model_version: str
    architecture: str
    pretrained_weights: str
    dataset_version: str
    classes: dict[str, int]
    preprocessing: dict
    evaluation_summary: dict | None = None
    checkpoint_sha256_prefix: str
    file_size_bytes: int
    load_seconds: float
