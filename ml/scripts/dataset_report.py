#!/usr/bin/env python3
"""LEAFNET dataset health report.

Human-readable summary of dataset health: validation status per data
directory, duplicate flags, manifest statistics vs the 2,000-image target,
and split counts. Works correctly with an empty dataset — it reports zeros,
never fabricates numbers.

Usage (from ml/ with venv active):
    python scripts/dataset_report.py [manifest_path]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ML_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_ROOT))

from src.data.validation import validate_directory  # noqa: E402
from src.data.deduplication import find_duplicates  # noqa: E402
from src.data.statistics import compute_statistics  # noqa: E402


def main() -> None:
    manifest = (
        Path(sys.argv[1])
        if len(sys.argv) > 1
        else ML_ROOT / "data" / "versions" / "v0.1" / "manifest.jsonl"
    )

    print("=" * 62)
    print("LEAFNET DATASET REPORT")
    print("=" * 62)
    print(f"\nManifest: {manifest}")
    print(f"Manifest exists: {manifest.exists()}")

    print("\n--- Directory validation ---")
    for name in ["incoming", "validated", "rejected", "raw"]:
        d = ML_ROOT / "data" / name
        if not d.exists():
            print(f"{name:>10}: directory does not exist yet")
            continue
        r = validate_directory(d)
        print(
            f"{name:>10}: {r['total_files']} files | "
            f"acceptable={r['acceptable']} questionable={r['questionable']} "
            f"rejected={r['rejected']}"
        )

    print("\n--- Duplicate scan (incoming + validated) ---")
    for name in ["incoming", "validated"]:
        dup = find_duplicates(ML_ROOT / "data" / name)
        n_exact = len([g for g in dup["exact_duplicate_groups"] if "files" in g])
        print(
            f"{name:>10}: scanned={dup['files_scanned']} "
            f"exact_dup_groups={n_exact} near_dup_groups="
            f"{len(dup['near_duplicate_groups'])} (flagged, not deleted)"
        )

    print("\n--- Manifest statistics vs targets ---")
    stats = compute_statistics(manifest)
    print(json.dumps(
        {
            k: stats[k]
            for k in [
                "total_images",
                "images_per_class",
                "unlabeled_or_uncertain",
                "splits",
                "imbalance_vs_target",
            ]
        },
        indent=2,
    ))

    print("\nTarget: 2000 total -> train 1600 / validation 200 / test 200")
    print("NOTE: report reflects only REAL recorded data. Empty output means")
    print("the dataset has not been populated yet — nothing is fabricated.")


if __name__ == "__main__":
    main()
