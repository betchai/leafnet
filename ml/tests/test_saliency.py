"""Phase 7 explainability tests (input-gradient saliency + PNG rendering).

DEV fixtures only; rendering verified via bytes, never against the deployed
service's convenience endpoints.
"""

from __future__ import annotations

import numpy as np
import pytest
import torch
from PIL import Image

from src.inference import saliency


class _FakeLeafModel(torch.nn.Module):
    """Tiny differentiable proxy: spatial-pool + linear to 4 logits."""

    def __init__(self):
        super().__init__()
        self.head = torch.nn.Linear(3, 4)

    def forward(self, x):
        pooled = x.mean(dim=(2, 3))  # (B, 3)
        return self.head(pooled)


def test_input_gradient_saliency_shape_and_finite():
    model = _FakeLeafModel()
    x = torch.randn(1, 3, 224, 224)
    sal = saliency.input_gradient_saliency(model, torch.device("cpu"), x, 1)
    assert sal.shape == (224, 224)
    assert np.isfinite(sal).all()
    assert (sal >= 0).all()  # mean-|grad| is non-negative


def test_render_explanation_returns_png_bytes():
    img = Image.new("RGB", (224, 224), (60, 120, 40))
    rng = np.random.default_rng(7)
    top = rng.random((224, 224))
    second = np.flip(top, axis=0)
    png = saliency.render_explanation(
        img, top, second, (224, 224), top_title="a", second_title="b"
    )
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    assert len(png) > 1000