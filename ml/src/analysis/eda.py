"""Pure image-analysis functions for Phase 4 EDA.

No I/O beyond opening given paths; no DB access; no API calls.
All functions are zero-image-safe and never modify research files.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image

REQUIRED_METADATA = ["source", "source_type", "license"]
OPTIONAL_METADATA = [
    "capture_date", "location", "cultivar", "leaf_age", "growth_stage",
    "lighting_condition", "camera_type", "orientation",
    "plant_id", "leaf_id", "farm_id", "collection_session_id",
]


def technical_characteristics(path: Path) -> dict | None:
    """Width/height/aspect/format/size/mode for one image. None if unreadable."""
    try:
        with Image.open(path) as img:
            img.load()
            w, h = img.size
            return {
                "width": w,
                "height": h,
                "aspect_ratio": round(w / h, 3) if h else None,
                "format": (img.format or path.suffix.lstrip(".")).lower(),
                "mode": img.mode,
                "size_bytes": path.stat().st_size,
            }
    except Exception:
        return None


def quality_metrics(path: Path) -> dict | None:
    """Brightness, contrast, sharpness flags. Review flags only — never verdicts."""
    try:
        with Image.open(path) as img:
            g = np.asarray(img.convert("L"), dtype=np.float32)
        mean = float(g.mean())
        std = float(g.std())
        # Laplacian-like gradient energy as a cheap sharpness proxy
        gy, gx = np.gradient(g)
        sharpness = float(np.sqrt(gx**2 + gy**2).mean())

        flags: list[str] = []
        if mean < 50:
            flags.append("severely_dark")
        if mean > 215:
            flags.append("severely_overexposed")
        if std < 25:
            flags.append("low_contrast")
        if std > 85:
            flags.append("unusually_high_contrast")
        if sharpness < 4.0:
            flags.append("possibly_blurry")

        return {
            "brightness_mean": round(mean, 1),
            "contrast_std": round(std, 1),
            "sharpness_gradient": round(sharpness, 2),
            "flags": flags,
        }
    except Exception:
        return None


def metadata_completeness(rows: list[dict]) -> list[dict]:
    """Per-field populated/missing/pct for required + optional metadata."""
    out = []
    total = len(rows)
    for field in REQUIRED_METADATA + OPTIONAL_METADATA:
        populated = sum(1 for r in rows if r.get(field))
        pct = round(100 * populated / total, 1) if total else 0.0
        out.append({
            "field": field,
            "kind": "required" if field in REQUIRED_METADATA else "optional",
            "populated": populated,
            "missing": total - populated,
            "pct_complete": pct,
        })
    return out


def duplicate_groups(rows: list[dict]) -> list[dict]:
    """Group rows by sha256 content hash. Flags only."""
    by_hash: dict[str, list[str]] = {}
    for r in rows:
        h = r.get("sha256") or r.get("hash")
        if h:
            by_hash.setdefault(h, []).append(r.get("image_id") or r.get("id") or "?")
    return [
        {"sha256": h, "image_ids": ids}
        for h, ids in sorted(by_hash.items())
        if len(ids) > 1
    ]


def leakage_candidates(rows: list[dict]) -> list[dict]:
    """Grouping-key clusters that could leak across splits.

    Since the final split is not yet performed, this reports group sizes so a
    human can judge whether grouped splitting will be viable.
    """
    groups: dict[str, Counter] = {}
    for r in rows:
        for key in ("collection_session_id", "farm_id", "plant_id", "leaf_id"):
            v = r.get(key)
            if v:
                groups.setdefault(key, Counter())[v] += 1
    return {
        key: {
            "num_groups": len(c),
            "max_images_in_one_group": max(c.values()) if c else 0,
            "multi_image_groups": sum(1 for n in c.values() if n > 1),
        }
        for key, c in groups.items()
    }


def outliers(rows: list[dict], chars: dict[str, dict]) -> list[dict]:
    """Flag statistical outliers on dims/file size/brightness (z-score > 3)."""
    flagged: list[str] = []
    metrics: dict[str, list[float]] = {"width": [], "height": [], "aspect_ratio": [], "size_bytes": []}
    ids_by_index: list[str] = []

    for r in rows:
        rid = r.get("id") or r.get("image_id")
        c = chars.get(rid)
        if not c:
            continue
        ids_by_index.append(rid)
        for k in metrics:
            metrics[k].append(float(c[k]))

    scores: dict[str, dict[str, float]] = {rid: {} for rid in ids_by_index}
    for k, vals in metrics.items():
        arr = np.array(vals)
        if len(arr) < 8 or arr.std() == 0:
            continue  # too few samples for meaningful z-scores
        z = np.abs((arr - arr.mean()) / arr.std())
        for rid, zi in zip(ids_by_index, z):
            scores[rid][k] = round(float(zi), 2)

    for rid, s in scores.items():
        hit = [k for k, z in s.items() if z > 3]
        q = quality_flags_for(chars[rid])
        if hit or q:
            flagged.append({"image_id": rid, "metric_outliers": hit, "quality_flags": q})
    return flagged


def quality_flags_for(char: dict) -> list[str]:
    return char.get("flags", [])


def class_distribution(rows: list[dict], statuses: list[str] | None = None) -> dict:
    """Class x annotation-status cross-tabulation with percentages vs 25% target."""
    classes = ["healthy", "leaf_rust", "leaf_spot", "leaf_blight"]
    result: dict = {"total": len(rows), "per_class": {}, "target_pct_per_class": 25.0}
    labels = [(r.get("class") or r.get("classKey")) for r in rows]
    counts = Counter(l for l in labels if l)

    for cls in classes:
        subset = [r for r, l in zip(rows, labels) if l == cls]
        per_status = Counter(
            r.get("annotation_status") or r.get("annotationStatus") or "?" for r in subset
        )
        result["per_class"][cls] = {
            "count": counts.get(cls, 0),
            "pct_of_labeled": round(100 * counts.get(cls, 0) / max(1, len(labels)), 1),
            "by_status": dict(per_status),
        }
    unlabeled = sum(1 for l in labels if not l)
    result["unlabeled_or_unclassified"] = unlabeled
    return result
