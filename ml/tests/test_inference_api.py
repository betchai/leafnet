"""Phase 7 inference-service tests (unit + integration, DEV fixtures only)."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
import torch
from PIL import Image
from fastapi.testclient import TestClient

from src.inference import model_loader, preprocessing as pre
from src.inference.predictor import apply_review_flag, predict_tensor


# ---------- unit: input validation ----------

def test_validate_rejects_corrupt():
    with pytest.raises(ValueError, match="unreadable"):
        pre.validate_image_bytes(b"not-an-image")


def test_validate_rejects_oversize_dimensions(tmp_path):
    p = tmp_path / "big.png"
    Image.new("RGB", (9001, 9001)).save(p)
    with pytest.raises(ValueError, match="too large"):
        pre.validate_image_bytes(p.read_bytes())


def test_validate_rejects_too_small(tmp_path):
    p = tmp_path / "tiny.png"
    Image.new("RGB", (10, 10)).save(p)
    with pytest.raises(ValueError, match="too small"):
        pre.validate_image_bytes(p.read_bytes())


def test_validate_accepts_rgb_jpeg(fixture_dir):
    img = pre.validate_image_bytes((fixture_dir / "DEVFIX_green_a.jpg").read_bytes())
    assert img.mode == "RGB" and img.format == "JPEG"


# ---------- unit: preprocessing determinism & consistency ----------

def test_preprocessing_is_deterministic_and_matches_training_config(fixture_dir):
    config = json.loads((Path(__file__).parents[1] / "src/config/training.json").read_text())
    img = Image.open(fixture_dir / "DEVFIX_green_a.jpg")
    t1 = pre.preprocess(img, config)
    t2 = pre.preprocess(img, config)
    assert torch.equal(t1, t2), "eval preprocessing must be deterministic"
    assert t1.shape == (1, 3, 224, 224)  # MobileNetV2 input size from training config


def test_no_augmentation_at_inference(fixture_dir):
    """Eval transform must not flip/rotate: two calls identical (already covered),
    and the transform pipeline contains no random ops."""
    config = json.loads((Path(__file__).parents[1] / "src/config/training.json").read_text())
    t = pre.build_transforms(config, train=False)
    repr_str = repr(t)
    assert "RandomHorizontalFlip" not in repr_str
    assert "RandomRotation" not in repr_str


# ---------- unit: predictor formatting + threshold ----------

class FakeModel:
    def __call__(self, x):
        return torch.tensor([[0.1, 0.6, 0.2, 0.1]])  # logits -> leaf_rust wins


def test_predict_tensor_returns_full_distribution():
    r = predict_tensor(FakeModel(), torch.device("cpu"),
                       {"healthy": 0, "leaf_rust": 1, "leaf_spot": 2, "leaf_blight": 3},
                       torch.zeros(1, 3, 8, 8))
    assert abs(sum(r["probabilities"].values()) - 1.0) < 0.01  # softmax sums to 1
    assert r["predicted_class"] == "leaf_rust"
    assert [t["class"] for t in r["top_k"]][0] == "leaf_rust"
    assert len(r["top_k"]) == 4


def test_review_threshold_is_configurable_not_absolute():
    base = {"confidence": 0.45}
    low = apply_review_flag(base, threshold=0.50)
    assert low["review_recommended"] is True
    ok = apply_review_flag(base, threshold=0.40)
    assert ok["review_recommended"] is False


# ---------- unit: model loader refuses unsafe config ----------

def test_active_pointer_rejects_path_traversal(tmp_path):
    bad = tmp_path / "active.json"
    bad.write_text(json.dumps({"model_version": "../../etc"}))
    orig = model_loader.MODELS_DIR
    model_loader.MODELS_DIR = tmp_path
    try:
        with pytest.raises(model_loader.ModelLoadError):
            model_loader.read_active_pointer()
    finally:
        model_loader.MODELS_DIR = orig


def test_active_pointer_missing_file(tmp_path):
    orig = model_loader.MODELS_DIR
    model_loader.MODELS_DIR = tmp_path
    try:
        with pytest.raises(model_loader.ModelLoadError, match="No active model"):
            model_loader.read_active_pointer()
    finally:
        model_loader.MODELS_DIR = orig


# ---------- integration: live service over HTTP ----------

BASE = "http://localhost:8000"


@pytest.fixture(scope="module")
def client():
    import urllib.request

    try:
        urllib.request.urlopen(f"{BASE}/health", timeout=3)
    except Exception:
        pytest.skip("inference service not running on :8000")
    return None


def _post(client, path, files=None):
    import subprocess
    cmd = ["curl", "-s", f"{BASE}{path}"]
    if files:
        for kv in files:
            cmd += ["-F", kv]
    return json.loads(subprocess.run(cmd, capture_output=True, text=True).stdout)


def test_integration_health_and_model(client):
    h = _post(client, "/health")
    assert h["status"] == "healthy" and h["model_loaded"] is True
    m = _post(client, "/model")
    assert m["architecture"] == "mobilenet_v2_transfer_learning"
    assert set(m["classes"]) == {"healthy", "leaf_rust", "leaf_spot", "leaf_blight"}
    assert m["preprocessing"]["augmentation_at_inference"] is False


def test_integration_predict_shape_and_reproducibility(client, fixture_dir):
    data = (fixture_dir / "DEVFIX_spotted.jpg").read_bytes()
    open("/tmp/repro.jpg", "wb").write(data)

    r1 = _post(client, "/predict", ["file=@/tmp/repro.jpg"])
    r2 = _post(client, "/predict", ["file=@/tmp/repro.jpg"])
    # reproducibility: same image + same model => identical probabilities
    assert r1["probabilities"] == r2["probabilities"]
    assert set(r1["probabilities"]) == {"healthy", "leaf_rust", "leaf_spot", "leaf_blight"}
    assert len(r1["top_k"]) == 4
    assert isinstance(r1["review_recommended"], bool)


def test_integration_invalid_image_handled(client):
    open("/tmp/bad.jpg", "wb").write(b"garbage")
    import subprocess
    out = subprocess.run(["curl", "-s", "-w", "\\n%{http_code}",
                          "-X", "POST", f"{BASE}/predict", "-F", "file=@/tmp/bad.jpg"],
                         capture_output=True, text=True).stdout
    body, code = out.rsplit("\n", 1)
    assert code == "422"
    assert "unreadable" in body or "corrupt" in body
