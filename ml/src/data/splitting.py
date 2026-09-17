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


def _nearest_subset(items: list[tuple[int, str]], target: int,
                    natural_of=None, prefer_natural: bool = False) -> list[str]:
    """Return the component ids whose total size best matches `target`.

    Deterministic: components arrive pre-sorted by (size, id). The EMPTY subset
    is never returned while components exist — otherwise a class whose smallest
    whole session is coarser than the target silently loses ALL of its test /
    validation groups to train (the "healthy gets no test/val" bug). Among
    equally close subsets the larger total wins; when `prefer_natural` is set,
    ties additionally favor natural-background groups so out-of-distribution
    (in-situ) plants reach the held-out sets. Component counts are small
    (< dozzen per class), so exhaustive search is fine.
    """
    n = len(items)
    if n == 0:
        return []
    best_diff: int | None = None
    best_sum = -1
    best_natural = -1
    best_mask = 0
    for mask in range(1, 1 << n):  # exclude the empty subset
        s = sum(items[i][0] for i in range(n) if (mask >> i) & 1)
        diff = abs(target - s)
        natural = 0
        if prefer_natural and natural_of:
            natural = sum(
                1 for i in range(n)
                if (mask >> i) & 1 and natural_of(items[i][1]) == "natural"
            )
        if (
            best_diff is None
            or diff < best_diff
            or (diff == best_diff and natural > best_natural)
            or (diff == best_diff and natural == best_natural and s > best_sum)
        ):
            best_diff, best_sum, best_natural, best_mask = diff, s, natural, mask
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
        # Singleton groups (size 1) have no leakage risk — promote them to
        # ungrouped so the expensive exhaustive subset search is never called
        # on hundreds of single-image groups (e.g. raw photos with unique
        # sha256 but no provenance keys).
        for gid in list(groups):
            if len(groups[gid]) == 1:
                ungrouped.extend(groups.pop(gid))

    # Group-level split assignment, stratified by the group's dominant class.
    # Per class, whole groups are assigned to test/validation/train toward
    # SPLIT_RATIOS (80/10/10): held-out groups are picked closest to 10% of the
    # class (never the empty pick), the validation target is computed on the
    # REMAINING pool (no double counting), and natural-background (OOD) groups
    # are preferred on ties so covariate-shift evaluation has support. Every
    # class with >=3 sessions is guaranteed at least one whole session in test
    # AND one in validation — a class must never be unmeasurable just because
    # its sessions are coarser than 10% (the "healthy 0/0" bug).
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

    split_of_group: dict[str, str] = {}
    for cls, gids in by_class_groups.items():
        items = sorted((len(groups[gid]), gid) for gid in gids)
        n_groups = len(items)
        if n_groups == 0:
            continue
        if n_groups >= 3:
            total_cls = sum(s for s, _ in items)
            t_test = round(total_cls * SPLIT_RATIOS["test"])
            test_ids = set(_nearest_subset(
                items, t_test, natural_of=_dominant_bg, prefer_natural=True))
            if not test_ids:  # safety: never return a class without a test pick
                test_ids = {min(items, key=lambda it: it[0])[1]}
            # If the picked test groups carry no natural (OOD) background but
            # the class has natural groups, swap the smallest test group for a
            # similarly-sized natural group so distribution-shift eval has data.
            if not any(_dominant_bg(gid) == "natural" for gid in test_ids):
                naturals = [
                    it for it in items
                    if it[1] not in test_ids and _dominant_bg(it[1]) == "natural"
                ]
                if naturals:
                    drop = min(test_ids, key=lambda gid: len(groups[gid]))
                    repl = min(naturals, key=lambda it: abs(it[0] - len(groups[drop])))
                    test_ids.discard(drop)
                    test_ids.add(repl[1])
            rest = [it for it in items if it[1] not in test_ids]
            t_val = round(sum(s for s, _ in rest) * SPLIT_RATIOS["validation"])
            val_ids = set(_nearest_subset(
                rest, t_val, natural_of=_dominant_bg, prefer_natural=True))
            if not val_ids and rest:  # safety: keep validation measurable
                val_ids = {min(rest, key=lambda it: it[0])[1]}
            for gid in test_ids:
                split_of_group[gid] = "test"
            for gid in val_ids:
                split_of_group[gid] = "validation"
            for _, gid in items:
                split_of_group.setdefault(gid, "train")
        elif n_groups == 2:
            # two sessions: keep a validation split, no isolated test
            val_gid = min(items, key=lambda it: it[0])[1]
            split_of_group[val_gid] = "validation"
            for _, gid in items:
                split_of_group.setdefault(gid, "train")
        else:
            for _, gid in items:
                split_of_group[gid] = "train"

    # Global rebalance: if any class ended up with MORE than one held-out group
    # on a side, return the extra group(s) to train. This nudges totals back
    # toward 80/10/10 (e.g. datasets with many small sessions) without ever
    # emptying a class's test/validation side. No-op for the common
    # one-per-side case.
    for cls, gids in by_class_groups.items():
        if len(gids) < 3:
            continue
        for side in ("test", "validation"):
            side_gids = [g for g in gids if split_of_group.get(g) == side]
            while len(side_gids) > 1:
                extra = min(side_gids, key=lambda g: len(groups[g]))
                split_of_group[extra] = "train"
                side_gids.remove(extra)

    for gid in singleton_class_groups:
        split_of_group[gid] = "train"  # unlabeled groups stay in training pool

    for gid, members in groups.items():
        s = split_of_group[gid]
        for row in members:
            row["split"] = s

    # Ungrouped images: CLASS-STRATIFIED 80/10/10 fill. (The old global shuffle
    # assigned test/validation first-come-first-served — with natural-background
    # rows consuming every held-out slot, a class whose rows are all lab-scan
    # backgrounds (healthy) landed 495/5/0 and became unmeasurable in test.)
    # Every class is apportioned its OWN 80/10/10 with the same guarantees as
    # the grouped path (_split_group_counts: >=1 test and >=1 validation when
    # the class has >=3 rows), so one class can never starve held-out splits.
    # Within a class, natural-background (OOD) rows are prioritized into test so
    # distribution-shift evaluation still has support. Unlabeled rows train-only.
    labeled_ungrouped = [
        r for r in ungrouped if r.get("class")
    ]
    unlabeled_rows = [
        r for r in ungrouped if not r.get("class")
    ]
    by_class_ungrouped: dict[str, list[dict]] = defaultdict(list)
    for row in labeled_ungrouped:
        by_class_ungrouped[row["class"]].append(row)

    for cls, cls_rows in by_class_ungrouped.items():
        n = len(cls_rows)
        n_train, n_val, n_test = _split_group_counts(n)
        rng.shuffle(cls_rows)
        cls_rows = sorted(
            cls_rows,
            key=lambda r: 0 if (r.get("background_type") == "natural") else 1,
        )
        for row in cls_rows[:n_test]:
            row["split"] = "test"
        for row in cls_rows[n_test:n_test + n_val]:
            row["split"] = "validation"
        for row in cls_rows[n_test + n_val:]:
            row["split"] = "train"
    for row in unlabeled_rows:
        row["split"] = "train"

    # Global rebalance toward the declared 80/10/10 partition: cross-class
    # rounding residue can leave a split a row short even when every class hit
    # its target. Correct it without EVER draining a class's last held-out row,
    # so the per-class measurability guarantees survive the rebalance. Unlabeled
    # rows never move out of train.
    total = len(out)
    target = {split: round(total * ratio) for split, ratio in SPLIT_RATIOS.items()}
    current = Counter(r.get("split") for r in out if r.get("split"))
    class_side = Counter(
        (r.get("class") or "unlabeled", r["split"])
        for r in out if r.get("split")
    )

    def _move(row: dict, to: str) -> None:
        frm = row["split"]
        cls = row.get("class") or "unlabeled"
        class_side[(cls, frm)] -= 1
        class_side[(cls, to)] += 1
        current[frm] -= 1
        current[to] += 1
        row["split"] = to

    for side in ("test", "validation"):
        while current[side] > target[side]:
            surplus = next(
                (r for r in out
                 if r.get("split") == side
                 and r.get("class")
                 and class_side[(r.get("class"), side)] > 1),
                None,
            )
            if surplus is None:
                break
            _move(surplus, "train")
        while current[side] < target[side]:
            pool = [
                r for r in out
                if r.get("split") == "train" and r.get("class")
            ]
            if not pool:
                break
            rng.shuffle(pool)
            uncovered = next(
                (r for r in pool
                 if class_side[(r.get("class"), side)] == 0),
                None,
            )
            _move(uncovered if uncovered is not None else pool[0], side)

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

    # Audit: per-class counts + drift vs the declared 80/10/10 target, so every
    # run reports exactly how far the grouping granularity forced the split off
    # target and flags classes that ended up unmeasurable in a held-out split.
    final_counts = dict(Counter(r["split"] for r in out))
    per_class_counts: dict[str, dict[str, int]] = defaultdict(Counter)
    for row in out:
        if row.get("class") and row.get("split"):
            per_class_counts[row["class"]][row["split"]] += 1
    per_class_counts = {k: dict(v) for k, v in sorted(per_class_counts.items())}
    classes_missing_test = sorted(
        c for c, s in per_class_counts.items() if s.get("test", 0) == 0
    )
    classes_missing_val = sorted(
        c for c, s in per_class_counts.items() if s.get("validation", 0) == 0
    )
    test_bg = {k: int(v) for k, v in bg_dist.get("test", {}).items()}
    test_natural_count = int(test_bg.get("natural", 0))
    test_all_white_removed = bool(
        test_bg and test_natural_count == 0
        and test_bg.get("white_removed", 0) == sum(test_bg.values())
    )
    drift = {}
    for split, ratio in SPLIT_RATIOS.items():
        target = round(len(out) * ratio)
        actual = final_counts.get(split, 0)
        drift[split] = {"target": target, "actual": actual, "delta": actual - target}

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
            "final_counts": final_counts,
            "background_dist": {s: dict(c) for s, c in bg_dist.items()},
            "per_class_counts": per_class_counts,
            "classes_missing_test": classes_missing_test,
            "classes_missing_val": classes_missing_val,
            "test_natural_count": test_natural_count,
            "test_all_white_removed": test_all_white_removed,
            "drift": drift,
        },
    }


if __name__ == "__main__":
    demo = create_grouped_splits([])  # empty dataset smoke run
    import json
    print(json.dumps(demo["audit"], indent=2))
