"""Model abstraction + MobileNetV2 transfer-learning factory.

The rest of the ML code depends only on this interface, so the architecture
can change without rewriting training/inference.

Transfer-learning strategy (Phase 5):
- torchvision MobileNetV2 with ImageNet-pretrained weights (version recorded)
- classification head replaced by Dropout(0.5) + Linear(1280 -> num_classes)
- backbone frozen for the baseline experiment; selective unfreezing supported
  for fine-tuning experiments via `unfreeze_last_n_blocks`
"""

from __future__ import annotations

import json
from pathlib import Path

import torch
import torch.nn as nn
from torchvision import models


class LeafNet(nn.Module):
    """Wraps a pretrained backbone with a task-specific head."""

    def __init__(self, backbone: nn.Module, num_classes: int, dropout: float = 0.5,
                 pretrained_weights: str = ""):
        super().__init__()
        self.backbone = backbone
        self.pool = nn.AdaptiveAvgPool2d(1)
        feature_dim = backbone.last_channel  # MobileNetV2-specific; update if backbone changes
        self.classifier_head = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(feature_dim, num_classes),
        )
        self.pretrained_weights = pretrained_weights

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.backbone.features(x)
        x = self.pool(x).flatten(1)
        return self.classifier_head(x)  # logits; softmax applied at inference only


def create_mobilenetv2(num_classes: int, dropout: float = 0.5,
                       freeze_backbone: bool = True,
                       unfreeze_last_n_blocks: int = 0) -> tuple[LeafNet, str]:
    """Build MobileNetV2 with ImageNet weights and a fresh 4-class head.

    Returns (model, pretrained_weights_id).
    """
    weights = models.MobileNet_V2_Weights.IMAGENET1K_V2
    pretrained_id = f"torchvision.{weights.name}"
    backbone = models.mobilenet_v2(weights=weights)
    # Remove the ORIGINAL ImageNet classifier entirely — our task head replaces it
    backbone.classifier = nn.Identity()

    # Freeze entire feature extractor first
    for p in backbone.features.parameters():
        p.requires_grad = not freeze_backbone

    # Selectively unfreeze the last N inverted-residual blocks for fine-tuning.
    # Number of blocks is an experimental parameter, not a scientific constant.
    if unfreeze_last_n_blocks > 0:
        blocks = list(backbone.features.children())
        for block in blocks[-unfreeze_last_n_blocks:]:
            for p in block.parameters():
                p.requires_grad = True

    model = LeafNet(backbone, num_classes=num_classes, dropout=dropout,
                    pretrained_weights=pretrained_id)

    if freeze_backbone and unfreeze_last_n_blocks == 0:
        for p in model.backbone.features.parameters():
            p.requires_grad = False
    return model, pretrained_id


def trainable_parameters(model: LeafNet) -> dict:
    total = sum(p.numel() for p in model.parameters())
    train = sum(p.numel() for p in model.parameters() if p.requires_grad)
    return {"total_parameters": total, "trainable_parameters": train}


def save_checkpoint(path: Path, model: LeafNet, optimizer, scheduler, epoch: int,
                    best_val_metric: float, config: dict, dataset_version: str,
                    class_mapping: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        "epoch": epoch,
        "model_state": model.state_dict(),
        "optimizer_state": optimizer.state_dict() if optimizer else None,
        "scheduler_state": scheduler.state_dict() if scheduler else None,
        "best_val_metric": best_val_metric,
        "config": config,
        "dataset_version": dataset_version,
        "class_mapping": class_mapping,
        "pretrained_weights": model.pretrained_weights,
    }, path)


def load_checkpoint(path: Path, model: LeafNet):
    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    model.load_state_dict(ckpt["model_state"])
    return ckpt


# Interface methods required by the Phase-2 abstraction (kept thin):
def load_model_metadata(model_dir: Path) -> dict:
    return json.loads((model_dir / "metadata.json").read_text())
