"""Dataset statistics for LEAFNET.

Computes totals, per-class counts from the manifest, missing labels/metadata,
class imbalance vs targets, and image dimension/file-size distributions.
Works correctly on an empty dataset (no fabricated values).
"""

from __future__ import annotations

from collections import Counter
import json
from pathlib import Path

from PIL import Image

TARGETS = {
    "totalImages": 2000,
    "imagesPerClass": {
        "healthy": 500,
        "leaf_rust": 500,
        "leaf_spot": 500,
        "leaf_blight": 500,
    },
}

OPTIONAL_METADATA_FIELDS = [
    "capture_date", "location", "cultivar", "leaf_age", "growth_stage",
    "lighting_condition", "camera_type", "image_orientation",
]


def compute_statistics(manifest_path: Path) -> dict:
    """Compute statistics over a JSONL manifest. Empty manifest -> empty stats."""
    rows: list[dict] = []
    if manifest_path.exists():
        for line in manifest_path.read_text().splitlines():
            line = line.strip()
            if line:
                rows.append(json.loads(line))

    per_class = Counter(r.get("class") for r in rows if r.get("class"))
    unlabeled = sum(1 for r in rows if not r.get("class"))
    splits = Counter(r.get("split") or "unassigned" for r in rows)

    missing_metadata = Counter()
    for r in rows:
        for field in OPTIONAL_METADATA_FIELDS:
            if not r.get(field):
                missing_metadata[field] += 1

    widths: list[int] = []
    heights: list[int] = []
    sizes_kb: list[float] = []
    for r in rows:
        p = Path(r["path"]) if not Path(r["path"]).is_absolute() else Path(r["path"])
        if p.exists():
            try:
                with Image.open(p) as img:
                    widths.append(img.size[0])
                    heights.append(img.size[1])
                sizes_kb.append(round(p.stat().st_size / 1024, 1))
            except Exception:  # noqa: BLE001 - count but don't crash reports
                pass

    imbalance = {
        cls: {"target": target, "actual": per_class.get(cls, 0),
              "delta": per_class.get(cls, 0) - target}
        for cls, target in TARGETS["imagesPerClass"].items()
    }

    return {
        "manifest": str(manifest_path),
        "total_images": len(rows),
        "images_per_class": dict(per_class),
        "unlabeled_or_uncertain": unlabeled,
        "splits": dict(splits),
        "imbalance_vs_target": imbalance,
        "missing_optional_metadata": dict(missing_metadata),
        "dimensions": {
            "count_measured": len(widths),
            "min_w": min(widths) if widths else None,
            "max_w": max(widths) if widths else None,
            "min_h": min(heights) if heights else None,
            "max_h": max(heights) if heights else None,
        },
        "file_size_kb": {
            "min": min(sizes_kb) if sizes_kb else None,
            "max": max(sizes_kb) if sizes_kb else None,
            "mean": round(sum(sizes_kb) / len(sizes_kb), 1) if sizes_kb else None,
        },
    }


if __name__ == "__main__":
    import sys

    mp = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("ml/data/versions/v0.1/manifest.jsonl")
    print(json.dumps(compute_statistics(mp), indent=2))
