"""Preflight integrity checks — run BEFORE any training.

If anything fails, training is refused with an explicit report.

The 80/10/10 partition integrity is enforced here too: a manifest is only
trainable when every taxonomy class is MEASURABLE — present in BOTH the
validation and isolated test splits (whenever it has enough rows to be) — and
no split has collapsed below 5% of the dataset. This hard-refuses the
"healthy absent from test" trap instead of quietly training an unevaluable
partition.
"""

from __future__ import annotations

import json
from collections import defaultdict
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

    # 6. per-class held-out coverage — a class with ZERO test or validation rows
    # is unmeasurable (the "healthy 495/5/0" trap), so refuse to train on it.
    # The >= 3-row threshold mirrors the splitter's own measurability guarantee
    # (_split_group_counts): a class that physically cannot support a held-out
    # split must never silently train into an unevaluable partition either.
    per_class_splits: dict[str, set] = defaultdict(set)
    for r in rows:
        if r.get("class"):
            per_class_splits[r["class"]].add(r.get("split"))
    for cls in sorted(class_mapping):
        if cls not in per_class_splits:
            continue  # entirely-absent classes already flagged in check 3
        cls_rows = [r for r in rows if r.get("class") == cls]
        if len(cls_rows) < 3:
            continue
        sides = per_class_splits[cls]
        if "test" not in sides:
            problems.append(
                f"class '{cls}' has NO isolated TEST rows — held-out performance is unmeasurable")
        if "validation" not in sides:
            problems.append(
                f"class '{cls}' has NO VALIDATION rows — training cannot be monitored for it")

    # 7. 80/10/10 partition integrity — no split may collapse below 5% of the
    # dataset, so a run can never proceed on a nominal-but-degenerate partition.
    total = len(rows)
    floor = round(total * 0.05)
    for split in ("train", "validation", "test"):
        if len(splits[split]) < floor:
            problems.append(
                f"split '{split}' has only {len(splits[split])} rows "
                f"(< {floor}, the 5% sanity floor) — not a credible 80/10/10 partition")

    # 8. files readable
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
            "per_class_validation": _per_class(splits["validation"]),
            "per_class_test": _per_class(splits["test"]),
        },
        "class_mapping": class_mapping,
    }
    return report["ok"], report


def _per_class(rows: list[dict]) -> dict[str, int]:
    from collections import Counter
    return dict(Counter(r.get("class") for r in rows))
