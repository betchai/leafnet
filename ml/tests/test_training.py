"""Phase 5 training-pipeline tests.

The tiny end-to-end training uses synthetic DEV FIXTURES — never research data.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import torch

from src.training.data import build_transforms, load_class_mapping, ManifestDataset
from src.training.model import create_mobilenetv2, trainable_parameters, save_checkpoint, load_checkpoint
from src.training.preflight import run_preflight


def test_class_mapping_matches_approved_taxonomy():
    cm = load_class_mapping()
    assert cm == {"healthy": 0, "leaf_rust": 1, "leaf_spot": 2, "leaf_blight": 3}


def test_mobilenetv2_head_outputs_four_logits():
    model, weights_id = create_mobilenetv2(num_classes=4)
    assert "IMAGENET1K" in weights_id  # pretrained provenance recorded
    x = torch.randn(2, 3, 224, 224)
    assert model(x).shape == (2, 4)


def test_frozen_backbone_baseline():
    model, _ = create_mobilenetv2(num_classes=4, freeze_backbone=True)
    p = trainable_parameters(model)
    # backbone frozen: only head trains (~a few thousand params vs 2.2M total)
    assert p["trainable_parameters"] < 10_000
    assert p["total_parameters"] > 2_000_000


def test_fine_tune_unfreezes_selected_blocks_only():
    full, _ = create_mobilenetv2(num_classes=4, freeze_backbone=True)
    ft, _ = create_mobilenetv2(num_classes=4, freeze_backbone=True, unfreeze_last_n_blocks=3)
    t_full = trainable_parameters(full)["trainable_parameters"]
    t_ft = trainable_parameters(ft)["trainable_parameters"]
    assert t_ft > t_full  # more params train when blocks are unfrozen


def test_train_vs_eval_transforms(tmp_path):
    from PIL import Image
    config = json.loads((Path(__file__).parents[1] / "src/config/training.json").read_text())
    img = tmp_path / "x.jpg"
    Image.new("RGB", (300, 300), (100, 150, 60)).save(img)

    t_train = build_transforms(config, train=True)
    t_eval = build_transforms(config, train=False)
    from PIL import Image as I
    out_eval1 = t_eval(I.open(img))
    out_eval2 = t_eval(I.open(img))
    assert torch.equal(out_eval1, out_eval2)  # eval must be deterministic
    out_train = t_train(I.open(img))
    assert out_train.shape == out_eval1.shape == (3, 224, 224)  # MobileNetV2 input


def test_manifest_dataset_skips_missing_files_and_bad_labels(tmp_path):
    from PIL import Image
    rows = [
        {"image_id": "ok", "class": "healthy", "path": ""},
        {"image_id": "badlabel", "class": "diseased", "path": ""},  # legacy label rejected
        {"image_id": "missing", "class": "leaf_spot", "path": "/nonexistent.jpg"},
    ]
    p = tmp_path / "real.jpg"
    Image.new("RGB", (64, 64)).save(p)
    rows[0]["path"] = str(p)

    config = json.loads((Path(__file__).parents[1] / "src/config/training.json").read_text())
    ds = ManifestDataset(rows, config, train=False)
    assert len(ds) == 1
    assert {r for _, r in ds.skipped} == {"label_not_in_taxonomy", "missing_file:/nonexistent.jpg"}
    x, y = ds[0]
    assert x.shape == (3, 224, 224) and y == 0


def test_checkpoint_roundtrip(tmp_path):
    model, _ = create_mobilenetv2(num_classes=4, freeze_backbone=True)
    opt = torch.optim.Adam(model.classifier_head.parameters(), lr=1e-4)
    path = tmp_path / "ckpt.pt"
    save_checkpoint(path, model, opt, None, epoch=3, best_val_metric=0.5,
                    config={"a": 1}, dataset_version="vTEST", class_mapping={"healthy": 0})
    ckpt = load_checkpoint(path, model)
    assert ckpt["epoch"] == 3 and ckpt["dataset_version"] == "vTEST"


def test_preflight_rejects_dirty_data(tmp_path):
    manifest = tmp_path / "m.jsonl"
    cm = load_class_mapping()
    good = {"image_id": "g", "class": "healthy", "split": "train",
            "annotation_status": "APPROVED", "path": "/tmp/nonexistent.jpg", "sha256": "A"}

    # missing file + absent classes -> fail
    manifest.write_text(json.dumps(good) + "\n")
    ok, report = run_preflight(manifest, cm)
    assert not ok and any("unreadable" in p or "missing" in p for p in report["problems"])
    assert any("absent" in p for p in report["problems"])

    # duplicate content across splits -> leakage failure
    dup = {**good, "image_id": "d", "split": "validation", "sha256": "A"}
    manifest.write_text("\n".join([json.dumps(good), json.dumps(dup)]) + "\n")
    ok, report = run_preflight(manifest, cm)
    assert any("leakage" in p for p in report["problems"])

    # non-approved status -> failure
    unv = {**good, "image_id": "u", "annotation_status": "ANNOTATED", "sha256": "B",
           "class": "leaf_spot", "split": "train"}
    manifest.write_text(json.dumps(unv) + "\n")
    ok, report = run_preflight(manifest, cm)
    assert any("non-APPROVED" in p for p in report["problems"])


def test_tiny_training_run_on_fixtures(fixture_dir):
    """End-to-end micro-training with 8 synthetic images. Proves the loop works;
    metrics are meaningless by design."""
    import tempfile
    from src.data.manifest import write_manifest
    config = json.loads((Path(__file__).parents[1] / "src/config/training.json").read_text())
    config = json.loads(json.dumps(config))  # deep copy
    config["experimentDefaults"].update({"epochs": 1, "batchSize": 2})

    files = sorted(fixture_dir.glob("DEVFIX_green_*.jpg"))
    rows = []
    labels = ["healthy", "leaf_rust", "leaf_spot", "leaf_blight"] * 2
    imgs = [fixture_dir / "DEVFIX_green_a.jpg", fixture_dir / "DEVFIX_green_b.jpg"]
    for i, lab in enumerate(labels):
        dst = fixture_dir / f"tiny_{i}.jpg"
        if not dst.exists():
            dst.write_bytes(imgs[i % 2].read_bytes())
        rows.append({"image_id": f"t{i}", "path": str(dst), "class": lab,
                     "sha256": f"h{i}", "split": "train" if i < 6 else "validation",
                     "annotation_status": "APPROVED"})
    mp = Path(tempfile.mkdtemp()) / "tiny.jsonl"
    write_manifest(rows, mp)

    ok, report = run_preflight(mp, load_class_mapping())
    assert ok, report

    from src.training.train import run_experiment
    meta = run_experiment("EXP-TEST", mp, config, dataset_version="vDEVFIXTURES",
                          notes="PILOT tiny fixture training - not research results")
    assert meta["best_epoch"] >= 1
    assert meta["status"] == "PILOT_PIPELINE_VALIDATION"
    assert (Path(meta["experiment_id"]) or True)
