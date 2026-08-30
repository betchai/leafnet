"""Preflight integrity checks — run BEFORE any training.

If anything fails, training is refused with an explicit report.
"""

from __future__ import annotations

import json
from pathlib import Path


def run_preflight(manifest_path: Path, class_mapping: dict[str, int]) -> tuple[bool, dict]:
    problems: list[str] = []
    rows = [json.loads(l) for l in manifest_path.read_text().splitlines() if l.strip()]

    # 1. only APPROVED labeled research rows
    bad_status = [r for r in rows if r.get("annotation_status") != "APPROVED"]
    if bad_status:
        problems.append(f"{len(bad_status)} non-APPROVED rows present (rejected/uncertain/unverified must never train)")

    # 2. labels valid against taxonomy
    invalid_labels = [r["image_id"] for r in rows if r.get("class") not in class_mapping]
    if invalid_labels:
        problems.append(f"{len(invalid_labels)} labels outside approved taxonomy: {invalid_labels[:5]}")

    # 3. every class present
    present = {r.get("class") for r in rows}
    missing_classes = set(class_mapping) - present
    if missing_classes:
        problems.append(f"classes absent from dataset: {sorted(missing_classes)}")

    # 4. splits valid & test isolated
    splits: dict[str, list] = {"train": [], "validation": [], "test": []}
    unassigned = []
    for r in rows:
        s = r.get("split")
        (splits[s].append(r) if s in splits else unassigned.append(r))
    if unassigned:
        problems.append(f"{len(unassigned)} rows without split assignment")
    if not splits["train"] or not splits["validation"]:
        problems.append("train and validation splits must both be non-empty")
    if len(splits["validation"]) < 1:
        problems.append("validation split too small to monitor training")

    # 5. duplicate leakage across splits (exact content)
    seen: dict[str, str] = {}
    dup_leaks = []
    for r in rows:
        h, s = r.get("sha256"), r.get("split")
        if h and h in seen and seen[h] != s:
            dup_leaks.append(h[:12])
        elif h:
            seen[h] = s
    if dup_leaks:
        problems.append(f"exact duplicates across splits (leakage): {dup_leaks}")

    # 6. files readable
    unreadable = []
    for r in rows:
        p = Path(r["path"])
        if not p.exists():
            unreadable.append(str(p))
    if unreadable:
        problems.append(f"{len(unreadable)} image files missing/unreadable")

    report = {
        "ok": not problems,
        "problems": problems,
        "counts": {
            "total_rows": len(rows),
            "train": len(splits["train"]),
            "validation": len(splits["validation"]),
            "test_isolated": len(splits["test"]),
            "per_class_train": _per_class(splits["train"]),
        },
        "class_mapping": class_mapping,
    }
    return report["ok"], report


def _per_class(rows: list[dict]) -> dict[str, int]:
    from collections import Counter
    return dict(Counter(r.get("class") for r in rows))
