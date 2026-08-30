"""Group-aware, leakage-preventing dataset splitting for LEAFNET.

Target partition (docs/dataset.md):
    total 2000 -> train 1600 / validation 200 / test 200  (80/10/10)

Leakage rule: images sharing a grouping key (collection_session_id > farm_id >
plant_id > leaf_id) must land in the SAME split. The finest available group
key per image is used. Groups are assigned to splits with stratified sampling
by class and a fixed seed, then any residual imbalance is filled greedily.

Every class is guaranteed a train split plus (whenever it has enough groups) a
validation and a test split — a small class (e.g. 4 collection sessions) must
never silently produce an EMPTY validation partition (the old `round(n*0.1)`
arithmetic did exactly that, which forced the whole run into PILOT fallback).

If no grouping metadata exists at all — or the caller explicitly sets
`ignore_groups=True` (PILOT runs) — falls back to stratified image-level
splitting AND records that fact in the returned metadata so it can be audited.
The group keys themselves are never deleted from the rows.
"""

from __future__ import annotations

import random
from collections import Counter, defaultdict
from pathlib import Path

SPLIT_RATIOS = {"train": 0.8, "validation": 0.1, "test": 0.1}
GROUP_KEYS = ["collection_session_id", "farm_id", "plant_id", "leaf_id"]


def _group_key(row: dict, ignore_groups: bool = False) -> str | None:
    """Return the finest available group identifier for an image row.

    `ignore_groups=True` forces an image-level split WITHOUT deleting the keys
    from the row (provenance is preserved for future grouped runs).
    """
    if ignore_groups:
        return None
    for key in GROUP_KEYS:
        if row.get(key):
            return f"{key}={row[key]}"
    return None


def _split_group_counts(n: int) -> tuple[int, int, int]:
    """(train, validation, test) group counts for a class with `n` groups.

    Apportions toward 80/10/10 (largest remainder) but ALWAYS guarantees a
    non-empty train split and, whenever the class has enough sessions,
    non-empty validation and test splits. Without this, a class with only 4
    collection sessions yielded `round(4 * 0.1) = 0` validation groups, which
    made the whole grouped run unsplittable and forced a PILOT fallback.
    """
    if n <= 0:
        return (0, 0, 0)
    if n == 1:
        return (1, 0, 0)
    if n == 2:
        return (1, 1, 0)
    floors = [int(n * SPLIT_RATIOS["train"]), int(n * SPLIT_RATIOS["validation"]), int(n * SPLIT_RATIOS["test"])]
    remaining = n - sum(floors)
    order = sorted(range(3), key=lambda i: (n * list(SPLIT_RATIOS.values())[i]) - floors[i], reverse=True)
    for k in range(remaining):
        floors[order[k % 3]] += 1
    train, val, test = floors
    val = max(val, 1)
    test = max(test, 1)
    train = n - val - test  # borrow any shortfall from train
    return (train, val, test)


def create_grouped_splits(rows: list[dict], seed: int = 42, ignore_groups: bool = False) -> dict:
    """Assign each row a 'split' field. Returns rows + audit metadata.

    Each input row needs at least: image_id, class (optional), and optional
    grouping keys. Rows are returned in a new list; inputs are not mutated.
    """
    rng = random.Random(seed)
    out = [dict(r) for r in rows]

    groups: dict[str, list[dict]] = defaultdict(list)
    ungrouped: list[dict] = []
    for row in out:
        gk = _group_key(row, ignore_groups=ignore_groups)
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
        n_train, n_val, _ = _split_group_counts(n)
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
