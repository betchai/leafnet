"""Inference preprocessing — MUST match training preprocessing.

Reuses build_transforms(train=False) from the training pipeline so there is
exactly ONE definition of eval-time preprocessing in the codebase. Never
create a second pipeline here.
"""

from __future__ import annotations

import io
import json
from pathlib import Path

import torch
from PIL import Image

from src.training.data import build_transforms

ML_ROOT = None  # set by caller if needed
SUPPORTED_FORMATS = {"JPEG", "PNG"}
MAX_DIMENSION = 8000
MIN_DIMENSION = 32


def load_config(config_path: Path) -> dict:
    return json.loads(Path(config_path).read_text())


def validate_image_bytes(data: bytes) -> Image.Image:
    """Decode + validate an uploaded image. Raises ValueError on bad input."""
    if not data:
        raise ValueError("empty upload")
    if len(data) > 20 * 1024 * 1024:
        raise ValueError("image exceeds maximum size of 20 MB")

    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"unreadable or corrupt image: {type(exc).__name__}") from exc

    if (img.format or "").upper() not in SUPPORTED_FORMATS:
        raise ValueError(f"unsupported format '{img.format}'; supported: JPEG, PNG")
    w, h = img.size
    if w < MIN_DIMENSION or h < MIN_DIMENSION:
        raise ValueError(f"image too small ({w}x{h}); minimum {MIN_DIMENSION}px")
    if w > MAX_DIMENSION or h > MAX_DIMENSION:
        raise ValueError(f"image too large ({w}x{h}); maximum {MAX_DIMENSION}px")
    if img.mode not in {"RGB", "RGBA", "L"}:
        raise ValueError(f"unsupported color mode '{img.mode}'")
    return img


def preprocess(img: Image.Image, config: dict) -> torch.Tensor:
    """Deterministic eval-mode preprocessing identical to validation/training-eval."""
    tensor = build_transforms(config, train=False)(
        img.convert("RGB")  # channel handling: force 3 channels
    )
    return tensor.unsqueeze(0)  # batch dimension
