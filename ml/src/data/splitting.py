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


def _identifiers(row: dict) -> list[str]:
    """Every identity an image belongs to: provenance keys AND its content hash.

    Images sharing any identifier are treated as ONE leakage group, so exact
    duplicates (same sha256) can never straddle train/validation/test even when
    they were uploaded under different collection sessions.
    """
    idents = [
        f"{key}={row[key]}"
        for key in GROUP_KEYS
        if row.get(key)
    ]
    if row.get("sha256"):
        idents.append(f"sha256={row['sha256']}")
    return idents


def _union_find_groups(rows: list[dict]) -> dict[str, list[dict]]:
    """Group images by connected components over shared identifiers."""
    parent: dict[str, str] = {}

    def root(x: str) -> str:
        parent.setdefault(x, x)
        if parent[x] != x:
            parent[x] = root(parent[x])
        return parent[x]

    def union(a: str, b: str) -> None:
        ra, rb = root(a), root(b)
        if ra != rb:
            parent[rb] = ra

    # union each image node with the nodes of every identifier it has.
    # Images with NO identifiers stay out of `groups` — they are ungrouped and
    # handled by the stratified fill, matching the pre-union-find behavior.
    joined: set[str] = set()
    for row in rows:
        idents = _identifiers(row)
        if not idents:
            continue
        iid = f"img:{row['image_id']}"
        root(iid)
        joined.add(iid)
        for ident in idents:
            union(iid, ident)

    groups: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        iid = f"img:{row['image_id']}"
        if iid in joined:
            groups[root(iid)].append(row)
    return groups


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


def _nearest_subset(items: list[tuple[int, str]], target: int) -> list[str]:
    """Return the component ids whose total size best matches `target`.

    Deterministic: components arrive pre-sorted by (size, id); among equally
    close subsets the one with the larger total wins (favors a fuller split).
    Component counts are small (< dozen per class), so exhaustive search is fine.
    """
    n = len(items)
    if n == 0:
        return []
    best_diff: int | None = None
    best_sum = -1
    best_mask = 0
    for mask in range(1 << n):
        s = sum(items[i][0] for i in range(n) if (mask >> i) & 1)
        diff = abs(target - s)
        if best_diff is None or diff < best_diff or (diff == best_diff and s > best_sum):
            best_diff, best_sum, best_mask = diff, s, mask
    return [items[i][1] for i in range(n) if (best_mask >> i) & 1]


def create_grouped_splits(rows: list[dict], seed: int = 42, ignore_groups: bool = False) -> dict:
    """Assign each row a 'split' field. Returns rows + audit metadata.

    Each input row needs at least: image_id, class (optional), and optional
    grouping keys. Rows are returned in a new list; inputs are not mutated.
    """
    rng = random.Random(seed)
    out = [dict(r) for r in rows]

    if ignore_groups:
        # PILOT: image-level split; grouping keys and hashes are retained in the
        # rows but not used for assignment (documented fallback).
        groups: dict[str, list[dict]] = defaultdict(list)
        ungrouped: list[dict] = []
        for row in out:
            gk = _group_key(row, ignore_groups=True)
            if gk is None:
                ungrouped.append(row)
            else:
                groups[gk].append(row)
    else:
        groups = _union_find_groups(out)
        ungrouped = [
            r for r in out if not _identifiers(r)
        ]

    # Group-level split assignment, stratified by the group's dominant class.
    # Within each class, test/validation selection is additionally stratified by
    # the group's DOMINANT background_type so the test set keeps the same
    # background (distribution) mix as the class as a whole — this is what makes
    # OOD / covariate-shift evaluation meaningful: if a class contains natural-
    # background (in-situ) groups, a proportional slice lands in test rather than
    # being drowned out by the white-removed (curated) majority.
    by_class_groups: dict[str, list[str]] = defaultdict(list)
    singleton_class_groups: list[str] = []
    for gid in sorted(groups):
        dominant_class = Counter(
            r.get("class") or "unlabeled" for r in groups[gid]
        ).most_common(1)[0][0]
        if dominant_class == "unlabeled":
            singleton_class_groups.append(gid)
        else:
            by_class_groups[dominant_class].append(gid)

    def _dominant_bg(gid: str) -> str:
        return Counter(
            (r.get("background_type") or "unknown") for r in groups[gid]
        ).most_common(1)[0][0]

    # Per class, components are assigned to test/validation/train by SIZE toward
    # SPLIT_RATIOS (80/10/10, declared in pipeline.json splitRatios) — test and
    # validation each target 10% of that class's images, as near to the target
    # as component granularity allows (nearest-subset fit). This keeps per-class
    # test support balanced even when many training photos share a handful of
    # large collection sessions, and gives the research target of ~200 test
    # images at a 2000-image dataset (10% of 2000).
    split_of_group: dict[str, str] = {}
    for cls, gids in by_class_groups.items():
        by_bg: dict[str, list[tuple[int, str]]] = defaultdict(list)
        for gid in gids:
            by_bg[_dominant_bg(gid)].append((len(groups[gid]), gid))
        for _bg, bg_items in by_bg.items():
            items = sorted(bg_items)
            total = sum(s for s, _ in items)
            if total == 0:
                continue
            t_test = round(total * SPLIT_RATIOS["test"])
            t_val = round(total * SPLIT_RATIOS["validation"])
            test_ids = set(_nearest_subset(items, t_test))
            rest = [it for it in items if it[1] not in test_ids]
            val_ids = set(_nearest_subset(rest, t_val))
            for gid in test_ids:
                split_of_group[gid] = "test"
            for gid in val_ids:
                split_of_group[gid] = "validation"
            for gid in [g for _, g in items]:
                if gid not in split_of_group:
                    split_of_group[gid] = "train"

    for gid in singleton_class_groups:
        split_of_group[gid] = "train"  # unlabeled groups stay in training pool

    for gid, members in groups.items():
        s = split_of_group[gid]
        for row in members:
            row["split"] = s

    # Ungrouped images: stratified random fill to top up ratio deficits.
    # Natural-background (OOD) rows are prioritized into the test split so the
    # distribution-shift evaluation isn't starved of in-situ examples when they
    # carry no provenance grouping keys.
    current = Counter(r.get("split") for r in out if r.get("split"))
    total = len(out)
    deficit = {
        split: max(0, round(total * ratio) - current.get(split, 0))
        for split, ratio in SPLIT_RATIOS.items()
    }
    order = ["test", "validation", "train"]
    rng.shuffle(ungrouped)
    for row in sorted(ungrouped,
                      key=lambda r: 0 if (r.get("background_type") == "natural") else 1):
        placed = False
        for split in order:
            if deficit[split] > 0:
                row["split"] = split
                deficit[split] -= 1
                placed = True
                break
        if not placed:
            row["split"] = "train"

    # Audit: how many groups were forged purely because identical-content images
    # (same sha256) were uploaded under different provenance keys.
    hash_locked = 0
    if not ignore_groups:
        by_hash: dict[str, set[str]] = defaultdict(set)
        for row in out:
            if row.get("sha256"):
                by_hash[row["sha256"]].add(row["image_id"])
        locked = {
            frozenset(ids) for ids in by_hash.values() if len(ids) > 1
        }
        hash_locked = len(locked)

    # Audit: background (distribution) mix per split — lets downstream eval / UI
    # see whether the test set actually exercises OOD (natural) background or not.
    bg_dist: dict[str, dict[str, int]] = defaultdict(Counter)
    for row in out:
        bg = row.get("background_type") or "unknown"
        bg_dist[row["split"]][bg] += 1

    return {
        "rows": out,
        "audit": {
            "num_groups": len(groups),
            "duplicate_locked_groups": hash_locked,
            "ungrouped_images": len(ungrouped),
            "strategy": (
                "group_aware_union_find" if groups else
                "image_level_random_fallback_no_grouping_metadata_available"
            ),
            "seed": seed,
            "final_counts": dict(Counter(r["split"] for r in out)),
            "background_dist": {s: dict(c) for s, c in bg_dist.items()},
        },
    }


if __name__ == "__main__":
    demo = create_grouped_splits([])  # empty dataset smoke run
    import json
    print(json.dumps(demo["audit"], indent=2))
