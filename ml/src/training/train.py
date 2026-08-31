"""Training loop with checkpointing, early stopping, and experiment reports.

Metrics produced here are TRAINING/VALIDATION metrics only.
The test split is never loaded by this module — formal evaluation is Phase 6.
"""

from __future__ import annotations

import json
import platform
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

from src.training.data import load_class_mapping, make_loaders
from src.training.model import (LeafNet, create_mobilenetv2, save_checkpoint,
                                trainable_parameters)

from typing import Callable

ML_ROOT = Path(__file__).resolve().parents[2]


def set_seeds(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def pick_device() -> torch.device:
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def run_experiment(exp_id: str, manifest_path: Path, config: dict,
                   dataset_version: str, notes: str = "",
                   freeze_backbone: bool | None = None,
                   fine_tune_layers: int | None = None,
                   epochs: int | None = None,
                   on_epoch: Callable[[dict], None] | None = None) -> dict:
    d = dict(config["experimentDefaults"])
    # Experiment-level overrides (controlled variables)
    if freeze_backbone is not None:
        d["freezeBackbone"] = freeze_backbone
    if fine_tune_layers is not None:
        d["fineTuneLayers"] = fine_tune_layers
    if epochs is not None:
        d["epochs"] = epochs

    exp_dir = ML_ROOT / "reports" / "experiments" / exp_id
    model_dir = ML_ROOT / "models" / f"{dataset_version}_{exp_id}"
    exp_dir.mkdir(parents=True, exist_ok=True)
    model_dir.mkdir(parents=True, exist_ok=True)

    set_seeds(d["randomSeed"])
    device = pick_device()
    class_map = load_class_mapping()
    print(f"[{exp_id}] device={device} classes={class_map}")

    train_loader, val_loader, skipped_train, skipped_val = make_loaders(manifest_path, config)
    for rid, reason in skipped_train + skipped_val:
        print(f"  SKIPPED {rid}: {reason}")  # never silently skip research images

    model, pretrained_id = create_mobilenetv2(
        num_classes=len(class_map),
        dropout=d["dropout"],
        freeze_backbone=d["freezeBackbone"],
        unfreeze_last_n_blocks=d["fineTuneLayers"],
    )
    model.to(device)
    params = trainable_parameters(model)

    # Discriminative fine-tuning: the freshly-initialized classification head
    # learns faster (1e-4) than the pretrained feature blocks that are unfrozen
    # for fine-tuning (1e-5). A frozen-backbone baseline has no backbone group.
    lr_head = d["learningRateHead"]
    lr_backbone = d["learningRateBackbone"]
    head_params = [p for n, p in model.named_parameters()
                   if p.requires_grad and "classifier_head" in n]
    backbone_params = [p for n, p in model.named_parameters()
                       if p.requires_grad and "classifier_head" not in n]
    param_groups = [{"params": head_params, "lr": lr_head}]
    if backbone_params:
        param_groups.append({"params": backbone_params, "lr": lr_backbone})
    optimizer = torch.optim.Adam(param_groups, weight_decay=d["weightDecay"])
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, factor=d["schedulerFactor"], patience=d["schedulerPatience"])
    criterion = nn.CrossEntropyLoss()

    history: list[dict] = []
    best_val_loss = float("inf")
    best_epoch = -1
    epochs_no_improve = 0
    stopped_epoch = None
    t0 = time.time()

    for epoch in range(d["epochs"]):
        # -- train --
        model.train()
        tr_loss = tr_correct = tr_n = 0
        for xb, yb in train_loader:
            xb, yb = xb.to(device), yb.to(device)
            optimizer.zero_grad()
            logits = model(xb)
            loss = criterion(logits, yb)
            loss.backward()
            optimizer.step()
            tr_loss += loss.item() * len(yb)
            tr_correct += (logits.argmax(1) == yb).sum().item()
            tr_n += len(yb)
        # -- validate --
        model.eval()
        va_loss = va_correct = va_n = 0
        with torch.no_grad():
            for xb, yb in val_loader:
                xb, yb = xb.to(device), yb.to(device)
                logits = model(xb)
                loss = criterion(logits, yb)
                va_loss += loss.item() * len(yb)
                va_correct += (logits.argmax(1) == yb).sum().item()
                va_n += len(yb)

        epoch_rec = {
            "epoch": epoch + 1,
            "train_loss": round(tr_loss / max(tr_n, 1), 4),
            "train_accuracy": round(tr_correct / max(tr_n, 1), 4),
            "val_loss": round(va_loss / max(va_n, 1), 4) if va_n else None,
            "val_accuracy": round(va_correct / max(va_n, 1), 4) if va_n else None,
            "lr": optimizer.param_groups[0]["lr"],
            "seconds": round(time.time() - t0, 1),
        }
        history.append(epoch_rec)
        print(f"  {epoch_rec}")

        if on_epoch is not None:
            on_epoch(epoch_rec)

        if epoch_rec["val_loss"] is not None and epoch_rec["val_loss"] < best_val_loss:
            best_val_loss = epoch_rec["val_loss"]
            best_epoch = epoch + 1
            epochs_no_improve = 0
            save_checkpoint(model_dir / "model_best.pt", model, optimizer, scheduler,
                            epoch + 1, best_val_loss, d, dataset_version, class_map)
        else:
            epochs_no_improve += 1

        if d.get("earlyStopping") and epochs_no_improve >= d["patience"]:
            stopped_epoch = epoch + 1
            break
        if epoch_rec["val_loss"] is not None:
            scheduler.step(epoch_rec["val_loss"])

    duration = round(time.time() - t0, 1)
    save_checkpoint(model_dir / "model_latest.pt", model, optimizer, scheduler,
                    len(history), best_val_loss, d, dataset_version, class_map)

    env_info = {
        "python": sys.version.split()[0],
        "pytorch": torch.__version__,
        "torchvision": __import__("torchvision").__version__,
        "cuda_available": torch.cuda.is_available(),
        "device": str(device),
        "platform": platform.platform(),
    }
    metadata = {
        "experiment_id": exp_id,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "dataset_version": dataset_version,
        "architecture": "mobilenet_v2",
        "pretrained_weights": pretrained_id,
        "transfer_learning_strategy": (
            "frozen_backbone_head_only" if d["freezeBackbone"] and not d["fineTuneLayers"]
            else f"partial_fine_tune_last_{d['fineTuneLayers']}_blocks"
        ),
        "parameters": params,
        "configuration": d,
        "environment": env_info,
        "best_epoch": best_epoch,
        "best_val_loss": best_val_loss,
        "best_val_accuracy": next((h["val_accuracy"] for h in history if h["epoch"] == best_epoch), None),
        "early_stopped_at": stopped_epoch,
        "skipped_images": [{"id": i, "reason": r} for i, r in skipped_train + skipped_val],
        "notes": notes,
        "status": "PILOT_PIPELINE_VALIDATION" if notes.startswith("PILOT") else "candidate",
        "_warning": "Training/validation metrics ONLY. Test evaluation reserved for Phase 6.",
    }
    (model_dir / "metadata.json").write_text(json.dumps(metadata, indent=2))
    (model_dir / "training_history.json").write_text(json.dumps(history, indent=2))
    (model_dir / "class_mapping.json").write_text(json.dumps(class_map, indent=2))
    (exp_dir / "config.json").write_text(json.dumps({"experimentDefaults": d, "augmentation": config["augmentation"], "preprocessing": config["preprocessing"]}, indent=2))
    (exp_dir / "history.json").write_text(json.dumps(history, indent=2))
    (exp_dir / "report.json").write_text(json.dumps(metadata, indent=2))

    _write_curves(exp_dir / "training_curves.png", history, exp_id)
    return metadata


def _write_curves(png: Path, history: list[dict], title: str) -> None:
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        epochs = [h["epoch"] for h in history]
        fig, axes = plt.subplots(1, 2, figsize=(10, 4))
        axes[0].plot(epochs, [h["train_loss"] for h in history], label="train")
        if any(h["val_loss"] for h in history):
            axes[0].plot(epochs, [h["val_loss"] or 0 for h in history], label="validation")
        axes[0].set_title("Loss"); axes[0].legend(); axes[0].set_xlabel("epoch")
        axes[1].plot(epochs, [h["train_accuracy"] for h in history], label="train")
        if any(h["val_accuracy"] for h in history):
            axes[1].plot(epochs, [h["val_accuracy"] or 0 for h in history], label="validation")
        axes[1].set_title("Accuracy"); axes[1].legend(); axes[1].set_xlabel("epoch")
        fig.suptitle(f"{title} (train/val metrics — NOT final test performance)")
        fig.tight_layout()
        fig.savefig(png, dpi=110)
        plt.close(fig)
    except Exception as e:  # noqa: BLE001 — curves are nice-to-have, training isn't
        png.write_text(f"plot generation failed: {e}")
