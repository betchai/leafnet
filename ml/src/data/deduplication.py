"""Duplicate detection for the LEAFNET dataset.

- Exact duplicates: identical SHA-256 content hashes.
- Near duplicates: perceptual hashing (average hash) with Hamming distance
  threshold. Requires the `imagehash` package for near-dup detection; exact
  detection works with stdlib only.

Duplicates are NEVER deleted automatically — they are flagged for review.
"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from pathlib import Path

NEAR_DUPLICATE_THRESHOLD = 5  # bits; tune during real data review


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def find_duplicates(image_dir: Path) -> dict:
    """Flag (not delete) exact and near duplicates in a directory."""
    files = sorted(
        p for p in image_dir.iterdir()
        if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png"}
    ) if image_dir.exists() else []

    by_hash: dict[str, list[str]] = defaultdict(list)
    for p in files:
        by_hash[sha256_of(p)].append(p.name)

    exact_groups = [
        {"hash": h, "files": names}
        for h, names in sorted(by_hash.items())
        if len(names) > 1
    ]

    near_groups: list[dict] = []
    try:
        import imagehash  # optional dependency
        from PIL import Image

        hashes = {}
        for p in files:
            name = sha256_of(p)  # noqa: F841 - keep hash map aligned per file
            try:
                with Image.open(p) as img:
                    hashes[p.name] = imagehash.average_hash(img)
            except Exception:
                continue

        names = sorted(hashes)
        claimed: set[str] = set()
        for i, a in enumerate(names):
            if a in claimed:
                continue
            group = [a]
            for b in names[i + 1:]:
                if b not in claimed and (hashes[a] - hashes[b]) <= NEAR_DUPLICATE_THRESHOLD:
                    group.append(b)
                    claimed.add(b)
            if len(group) > 1:
                claimed.update(group)
                near_groups.append({"files": group})
    except ImportError:
        near_groups = [{"note": "install 'imagehash' to enable near-duplicate detection"}]

    return {
        "directory": str(image_dir),
        "files_scanned": len(files),
        "exact_duplicate_groups": exact_groups,
        "near_duplicate_groups": near_groups,
        "action": "flagged_for_review_only",
    }


if __name__ == "__main__":
    import sys

    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("ml/data/incoming")
    print(json.dumps(find_duplicates(target), indent=2))
