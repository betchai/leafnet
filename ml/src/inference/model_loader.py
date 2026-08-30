"""Model loader — loads an EXPLICITLY IDENTIFIED checkpoint.

Rules:
- The active model comes from controlled configuration only
  (models/active.json), never from user input.
- Unnamed artifacts (e.g. bare "model.pt") are refused.
- Everything needed for traceability (version id, dataset version, class
  mapping, preprocessing config) is loaded together and exposed via /model.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import torch

ML_ROOT = Path(__file__).resolve().parents[2]
MODELS_DIR = ML_ROOT / "models"


class ModelLoadError(RuntimeError):
    """Raised when the configured model cannot be loaded safely."""


def read_active_pointer() -> dict:
    """Read models/active.json -> {"model_version": "v1.0_EXP-x"}."""
    pointer = MODELS_DIR / "active.json"
    if not pointer.exists():
        raise ModelLoadError(
            "No active model configured. Create ml/models/active.json with "
            '{"model_version": "<version-dir-name>"} after a candidate is promoted.'
        )
    data = json.loads(pointer.read_text())
    version = data.get("model_version", "").strip()
    if not version or "/" in version or ".." in version:
        raise ModelLoadError("active.json must contain a safe 'model_version' name")
    return {"model_version": version}


def load_active_model():
    """Load the active checkpoint + full traceability bundle.

    Returns dict with keys: version_id, model (LeafNet in eval mode),
    device, metadata, ckpt, load_seconds, file_size_bytes, sha256_prefix.
    """
    t0 = time.perf_counter()
    from src.training.model import LeafNet
    from torchvision import models

    version_id = read_active_model_version()
    model_dir = MODELS_DIR / version_id
    ckpt_path = model_dir / "model_best.pt"
    if not ckpt_path.exists():
        raise ModelLoadError(f"checkpoint not found for active model '{version_id}'")

    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    required = ["class_mapping", "dataset_version", "model_state"]
    missing = [k for k in required if k not in ckpt]
    if missing:
        raise ModelLoadError(f"checkpoint missing traceability fields: {missing}")

    backbone = models.mobilenet_v2(weights=None)
    backbone.classifier = torch.nn.Identity()
    model = LeafNet(backbone, num_classes=len(ckpt["class_mapping"]))
    model.load_state_dict(ckpt["model_state"])
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device).eval()  # evaluation mode: deterministic, no dropout

    metadata = {}
    meta_path = model_dir / "metadata.json"
    if meta_path.exists():
        metadata = json.loads(meta_path.read_text())

    import hashlib
    h = hashlib.sha256()
    with ckpt_path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)

    return {
        "version_id": version_id,
        "model": model,
        "device": device,
        "ckpt": ckpt,
        "metadata": metadata,
        "load_seconds": round(time.perf_counter() - t0, 3),
        "file_size_bytes": ckpt_path.stat().st_size,
        "sha256_prefix": h.hexdigest()[:16],
    }


def read_active_model_version() -> str:
    return read_active_pointer()["model_version"]
