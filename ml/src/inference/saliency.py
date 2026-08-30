"""Input-gradient saliency for LEAFNET (Phase 7 / explainability).

Produces pixel-influence heatmaps: for a chosen target class, compute the
gradient of that class's RAW score w.r.t. every input pixel. High |gradient|
pixels are the ones that most strongly pushed the score. This is an influence
map, NOT a semantic segmentation, and NOT evidence of disease.

Rendering is optional (matplotlib); if unavailable the caller degrades
gracefully.
"""

from __future__ import annotations

import io

import numpy as np
import torch
from PIL import Image


def input_gradient_saliency(
    model: torch.nn.Module,
    device: torch.device,
    tensor: torch.Tensor,
    target_idx: int,
) -> np.ndarray:
    """Saliency of `target_idx`'s raw score over the (1,3,H,W) input tensor.

    Returns a (H, W) float map of mean-|grad| across channels.
    """
    x = tensor.clone().detach().requires_grad_(True)
    model.eval()
    model.zero_grad()
    logits = model(x.to(device))
    logits[0, target_idx].backward()
    grad = x.grad.abs().mean(dim=(0, 1)).detach().cpu().numpy()
    return grad


def render_explanation(
    img: Image.Image,
    saliency_top: np.ndarray,
    saliency_second: np.ndarray,
    size: tuple[int, int],
    top_title: str,
    second_title: str,
    diff_title: str = "Areas that pushed for each (red = top, blue = runner-up)",
    dpi: int = 100,
) -> bytes:
    """Render a 3-panel explanation figure (original + 2 heatmaps) as PNG bytes."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    display = np.asarray(img.resize(size, Image.Resampling.BILINEAR))
    sal_top = _normalize(saliency_top)
    sal_second = _normalize(saliency_second)
    diff = sal_top - sal_second

    fig, axes = plt.subplots(1, 3, figsize=(14.5, 4.9))

    for ax, sal, title, cmap in (
        (axes[0], sal_top, top_title, "inferno"),
        (axes[1], sal_second, second_title, "inferno"),
    ):
        ax.imshow(display)
        im = ax.imshow(sal, cmap=cmap, alpha=0.55, vmin=0, vmax=1)
        ax.set_title(title, fontsize=9)
        ax.axis("off")
        fig.colorbar(im, ax=ax, fraction=0.046, pad=0.02)

    axes[2].imshow(display)
    im = axes[2].imshow(diff, cmap="coolwarm", alpha=0.62, vmin=-0.6, vmax=0.6)
    axes[2].set_title(diff_title, fontsize=9)
    axes[2].axis("off")
    fig.colorbar(im, ax=axes[2], fraction=0.046, pad=0.02)

    fig.suptitle(
        "LEAFNET — why did the model score this way? (pixel influence)",
        fontsize=11,
    )
    fig.tight_layout()

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=dpi)
    plt.close(fig)
    return buf.getvalue()


def _normalize(sal: np.ndarray) -> np.ndarray:
    """Robust 1st–99th percentile clip then min-max to [0,1]."""
    lo, hi = np.percentile(sal, (1, 99))
    clipped = np.clip(sal, lo, hi)
    span = clipped.max() - clipped.min()
    if span < 1e-9:
        return np.zeros_like(clipped)
    return (clipped - clipped.min()) / span