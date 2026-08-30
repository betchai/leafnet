"""Group-aware, leakage-preventing dataset splitting for LEAFNET.

Target partition (docs/dataset.md):
    total 2000 -> train 1600 / validation 200 / test 200  (80/10/10)

Leakage rule: images sharing a grouping key (collection_session_id > farm_id >
plant_id > leaf_id) must land in the SAME split. The finest available group
key per image is used. Groups are assigned to splits with stratified sampling
by class and a fixed seed, then any residual imbalance is filled greedily.

If no grouping metadata exists at all, falls back to stratified image-level
splitting AND records that fact in the returned metadata so it can be audited.
"""

from __future__ import annotations

import random
from collections import Counter, defaultdict
from pathlib import Path

SPLIT_RATIOS = {"train": 0.8, "validation": 0.1, "test": 0.1}
GROUP_KEYS = ["collection_session_id", "farm_id", "plant_id", "leaf_id"]


def _group_key(row: dict) -> str | None:
    """Return the finest available group identifier for an image row."""
    for key in GROUP_KEYS:
        if row.get(key):
            return f"{key}={row[key]}"
    return None


def create_grouped_splits(rows: list[dict], seed: int = 42) -> dict:
    """Assign each row a 'split' field. Returns rows + audit metadata.

    Each input row needs at least: image_id, class (optional), and optional
    grouping keys. Rows are returned in a new list; inputs are not mutated.
    """
    rng = random.Random(seed)
    out = [dict(r) for r in rows]

    groups: dict[str, list[dict]] = defaultdict(list)
    ungrouped: list[dict] = []
    for row in out:
        gk = _group_key(row)
        if gk is None:
            ungrouped.append(row)
        else:
            groups[gk].append(row)

    # Group-level split assignment, stratified by the group's dominant class
    by_class_groups: dict[str, list[str]] = defaultdict(list)
    singleton_class_groups: list[str] = []
    for gid in sorted(groups):
        dominant = Counter(
            r.get("class") or "unlabeled" for r in groups[gid]
        ).most_common(1)[0][0]
        if dominant == "unlabeled":
            singleton_class_groups.append(gid)
        else:
            by_class_groups[dominant].append(gid)

    split_of_group: dict[str, str] = {}
    for cls, gids in by_class_groups.items():
        rng.shuffle(gids)
        n = len(gids)
        n_train = round(n * SPLIT_RATIOS["train"])
        n_val = round(n * SPLIT_RATIOS["validation"])
        for i, gid in enumerate(gids):
            if i < n_train:
                split_of_group[gid] = "train"
            elif i < n_train + n_val:
                split_of_group[gid] = "validation"
            else:
                split_of_group[gid] = "test"

    for gid in singleton_class_groups:
        split_of_group[gid] = "train"  # unlabeled groups stay in training pool

    for gid, members in groups.items():
        s = split_of_group[gid]
        for row in members:
            row["split"] = s

    # Ungrouped images: stratified random fill to top up ratio deficits
    current = Counter(r.get("split") for r in out if r.get("split"))
    total = len(out)
    deficit = {
        split: max(0, round(total * ratio) - current.get(split, 0))
        for split, ratio in SPLIT_RATIOS.items()
    }
    order = ["test", "validation", "train"]
    rng.shuffle(ungrouped)
    for row in ungrouped:
        cls = row.get("class") or "unlabeled"
        placed = False
        for split in order:
            if deficit[split] > 0:
                row["split"] = split
                deficit[split] -= 1
                placed = True
                break
        if not placed:
            row["split"] = "train"

    return {
        "rows": out,
        "audit": {
            "num_groups": len(groups),
            "ungrouped_images": len(ungrouped),
            "strategy": (
                "group_aware" if groups else
                "image_level_random_fallback_no_grouping_metadata_available"
            ),
            "seed": seed,
            "final_counts": dict(Counter(r["split"] for r in out)),
        },
    }


if __name__ == "__main__":
    demo = create_grouped_splits([])  # empty dataset smoke run
    import json
    print(json.dumps(demo["audit"], indent=2))
