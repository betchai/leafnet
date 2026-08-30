"""Manifest-driven dataset preparation for training.

Consumes a dataset-version manifest (from the Node API) as the single source
of truth — never "whatever images are in a directory".

Responsibilities:
- fetch/save the manifest for a locked dataset version
- assign splits with the group-aware splitter (leakage prevention) and PERSIST
  the assignment so train/val/test membership is stable across experiments
- build PyTorch Datasets with taxonomy-driven labels and augmentation only on train

The test split is written to its own file; training code loads it only when
explicitly asked (Phase 6).
"""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path

import torch
from PIL import Image
from torch.utils.data import Dataset
from torchvision import transforms

from src.data.splitting import create_grouped_splits

ML_ROOT = Path(__file__).resolve().parents[2]
PREPARED_DIR = ML_ROOT / "data" / "prepared"
CONFIG_DIR = ML_ROOT / "src" / "config"


def load_class_mapping() -> dict[str, int]:
    """Class key -> index, from the centralized taxonomy config. Single source of truth."""
    raw = json.loads((CONFIG_DIR / "classes.json").read_text())
    return {c["key"]: c["id"] for c in raw["classes"] if c.get("enabled", True)}


def fetch_manifest(api_base: str, dataset_id: str) -> list[dict]:
    with urllib.request.urlopen(f"{api_base}/api/datasets/{dataset_id}/manifest", timeout=30) as r:
        return [json.loads(line) for line in r.read().decode().splitlines() if line.strip()]


def prepare_dataset(api_base: str, dataset_id: str, seed: int = 42,
                    force: bool = False, pilot: bool = False) -> tuple[Path, dict]:
    """Fetch manifest + assign splits. Cached per (dataset, seed) unless force.

    pilot=True: image-level split ignoring grouping keys (keys are RETAINED in
    the manifest — only ignored for assignment). ONLY for pipeline validation
    or when the dataset genuinely cannot satisfy a grouped split; research runs
    must use grouped splitting.
    """
    PREPARED_DIR.mkdir(parents=True, exist_ok=True)
    suffix = f"_seed{seed}" + ("_PILOT" if pilot else "")
    out = PREPARED_DIR / f"{dataset_id}{suffix}.jsonl"
    audit_path = PREPARED_DIR / f"{dataset_id}{suffix}.audit.json"

    rows = fetch_manifest(api_base, dataset_id)
    approved = [
        {**r, "class": r["class"]}
        for r in rows
        if r.get("annotation_status") == "APPROVED" and r.get("class")
    ]
    excluded = len(rows) - len(approved)
    if not approved:
        raise RuntimeError(
            "Preflight failure: no APPROVED labeled images in this dataset version. "
            "Complete annotation/expert review before training."
        )

    if out.exists() and not force:
        existing = [json.loads(l) for l in out.read_text().splitlines() if l.strip()]
        return out, {"reused_existing": True, "counts": _counts(existing), "excluded_rows": excluded}

    # PILOT = image-level split for genuinely tiny/ungroupable datasets. The
    # grouping keys are KEPT in the manifest (never destroy provenance — audits
    # and later grouped runs must still see them); the splitter is only told to
    # IGNORE them for this particular run.
    split_result = create_grouped_splits(approved, seed=seed, ignore_groups=pilot)
    assigned = split_result["rows"]
    if pilot:
        split_result["audit"]["strategy"] = "pilot_image_level_split_group_keys_ignored"
    with out.open("w") as f:
        for r in assigned:
            f.write(json.dumps(r) + "\n")
    audit = {**split_result["audit"], "excluded_rows": excluded, "dataset_id": dataset_id}
    audit_path.write_text(json.dumps(audit, indent=2))
    return out, audit


def load_split(manifest_path: Path, split: str) -> list[dict]:
    rows = [json.loads(l) for l in manifest_path.read_text().splitlines() if l.strip()]
    return [r for r in rows if r.get("split") == split]


def _counts(rows: list[dict]) -> dict:
    from collections import Counter
    return {
        "splits": dict(Counter(r["split"] for r in rows)),
        "classes": dict(Counter(r["class"] for r in rows)),
    }


def build_transforms(config: dict, train: bool) -> transforms.Compose:
    """Augmentation ONLY on train (each transform has a documented rationale);
    deterministic resize+normalize for validation/test."""
    p = config["preprocessing"]
    size = p["resize"]
    norm = p["normalization"]
    if train:
        a = config["augmentation"]
        ops: list = []
        if a.get("horizontalFlip", 0):
            ops.append(transforms.RandomHorizontalFlip(p=a["horizontalFlip"]))
        deg = a.get("rotationDegrees", 0)
        if deg:
            ops.append(transforms.RandomRotation(degrees=deg))
        jitter = {}
        for k in ("brightness", "contrast", "saturation"):
            if a.get(k):
                jitter[k] = a[k]
        if jitter:
            ops.append(transforms.ColorJitter(**jitter))
        ops += [
            transforms.Resize(size),
            transforms.ToTensor(),
            transforms.Normalize(norm["mean"], norm["std"]),
        ]
        return transforms.Compose(ops)
    return transforms.Compose([
        transforms.Resize(size),
        transforms.ToTensor(),
        transforms.Normalize(norm["mean"], norm["std"]),
    ])


class ManifestDataset(Dataset):
    """PyTorch dataset over prepared-manifest rows of one split."""

    def __init__(self, rows: list[dict], config: dict, train: bool):
        self.class_map = load_class_mapping()
        self.transform = build_transforms(config, train)
        self.items: list[tuple[Path, int]] = []
        self.skipped: list[tuple[str, str]] = []
        for r in rows:
            label = self.class_map.get(r.get("class"))
            path = Path(r["path"])
            if label is None:
                self.skipped.append((r.get("image_id", "?"), "label_not_in_taxonomy"))
                continue
            if not path.exists():
                self.skipped.append((r.get("image_id", "?"), f"missing_file:{path}"))
                continue
            self.items.append((path, label))

    def __len__(self):
        return len(self.items)

    def __getitem__(self, idx):
        path, label = self.items[idx]
        img = Image.open(path).convert("RGB")  # channel handling: force 3-channel
        return self.transform(img), label


def make_loaders(manifest_path: Path, config: dict):
    """Train/val loaders (test loader intentionally NOT returned — Phase 6 only)."""
    d = config["experimentDefaults"]
    g = torch.Generator()
    g.manual_seed(d["randomSeed"])
    train_ds = ManifestDataset(load_split(manifest_path, "train"), config, train=True)
    val_ds = ManifestDataset(load_split(manifest_path, "validation"), config, train=False)
    common = dict(num_workers=d["numWorkers"], pin_memory=torch.cuda.is_available())
    train_loader = torch.utils.data.DataLoader(
        train_ds, batch_size=d["batchSize"], shuffle=True, generator=g, **common)
    val_loader = torch.utils.data.DataLoader(
        val_ds, batch_size=d["batchSize"], shuffle=False, **common)
    return train_loader, val_loader, train_ds.skipped, val_ds.skipped
