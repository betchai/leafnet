#!/usr/bin/env python3
"""LEAFNET Phase 4 — dataset exploration & quality analysis.

Reads the CURRENT dataset state through the Node API (the single source of
truth for workflow state), analyzes image files in place, and writes
machine-readable reports to ml/reports/.

Honesty guarantees:
- Works correctly with zero images.
- Analyzes RESEARCH data; dev fixtures are reported separately and never
  merged into research findings.
- Quality flags are review suggestions, never automatic rejections.

Usage (ml/ venv active, API running):
    python scripts/explore_dataset.py [--api http://localhost:4000]
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ML_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_ROOT))

from src.analysis import eda  # noqa: E402

REPORTS = ML_ROOT / "reports"


def api_get(base: str, path: str) -> dict | list:
    with urllib.request.urlopen(f"{base}/api{path}", timeout=15) as r:
        return json.load(r)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost:4000")
    args = ap.parse_args()

    REPORTS.mkdir(exist_ok=True)

    # ---- 1. Dataset state via API (workflow source of truth) ----
    status = api_get(args.api, "/datasets/status")
    raw = api_get(args.api, "/images?fixtures=include&includeClass=1")
    all_rows = raw["items"] if isinstance(raw, dict) else raw

    def to_row(i: dict) -> dict:
        c = i.get("classifications") or []
        return {
            "id": i["id"],
            "class": c[0]["classKey"] if c else None,
            "annotation_status": i.get("annotationStatus"),
            "is_dev_fixture": i.get("isDevFixture"),
            "sha256": i.get("sha256"),
            "path": i.get("storagePath"),
            **{k: i.get(k) for k in eda.OPTIONAL_METADATA},
            "source": i.get("source"),
            "source_type": i.get("sourceType"),
            "license": i.get("license"),
        }

    rows_all = [to_row(i) for i in all_rows]
    research = [r for r in rows_all if not r["is_dev_fixture"]]
    fixtures = [r for r in rows_all if r["is_dev_fixture"]]

    print("=" * 62)
    print("LEAFNET PHASE 4 — DATASET EXPLORATION")
    print("=" * 62)
    print(f"Research images: {len(research)}  |  Dev fixtures (excluded): {len(fixtures)}")

    # ---- 2. Class distribution (research only) ----
    dist = eda.class_distribution(research)
    with open(REPORTS / "class_distribution.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["class", "count", "pct_of_labeled", "target_pct"])
        for cls, v in dist["per_class"].items():
            w.writerow([cls, v["count"], v["pct_of_labeled"], 25.0])
        for cls, v in dist["per_class"].items():  # status breakdown rows
            for st, n in v["by_status"].items():
                w.writerow([f"{cls}:{st}", n, "", ""])

    # ---- 3. Metadata completeness ----
    comp = eda.metadata_completeness(research)
    with open(REPORTS / "metadata_completeness.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["field", "kind", "populated", "missing", "pct_complete"])
        w.writeheader()
        w.writerows(comp)

    # ---- 4. Technical characteristics + quality metrics per image ----
    chars: dict[str, dict] = {}
    for r in research:
        p = Path(r["path"]) if r["path"] else None
        if p and p.exists():
            t = eda.technical_characteristics(p)
            q = eda.quality_metrics(p)
            if t:
                chars[r["id"]] = {**t, "flags": q["flags"] if q else []}
                if q:
                    chars[r["id"]].update({k: q[k] for k in ("brightness_mean", "contrast_std", "sharpness_gradient")})

    quality_rows = [
        {"image_id": rid, **{k: v for k, v in c.items()}}
        for rid, c in chars.items()
    ]
    with open(REPORTS / "image_quality.csv", "w", newline="") as f:
        if quality_rows:
            w = csv.DictWriter(f, fieldnames=list(quality_rows[0].keys()))
            w.writeheader()
            w.writerows(quality_rows)

    # ---- 5. Duplicates & leakage ----
    dups = eda.duplicate_groups(research)
    leak = eda.leakage_candidates(research)
    with open(REPORTS / "duplicate_candidates.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["sha256", "image_ids"])
        for g in dups:
            w.writerow([g["sha256"], ";".join(g["image_ids"])])
    with open(REPORTS / "leakage_candidates.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["group_key", "num_groups", "max_images_in_one_group", "multi_image_groups"])
        for key, v in leak.items():
            w.writerow([key, v["num_groups"], v["max_images_in_one_group"], v["multi_image_groups"]])

    # ---- 6. Outliers ----
    outl = eda.outliers(research, chars)
    with open(REPORTS / "outliers.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["image_id", "metric_outliers", "quality_flags"])
        w.writeheader()
        for o in outl:
            w.writerow({"image_id": o["image_id"],
                        "metric_outliers": ";".join(o["metric_outliers"]),
                        "quality_flags": ";".join(o["quality_flags"])})

    # ---- 7. Summary report ----
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "dataset_version": None,
        "research_images": len(research),
        "approved_images": status["research"]["approved"],
        "dev_fixtures_excluded": len(fixtures),
        "target": {"total": 2000, "per_class": 500,
                   "shortfall_total": max(0, 2000 - status["research"]["approved"])},
        "composition_from_api": status["research"],
        "per_class": status["perClass"],
        "class_distribution": dist,
        "metadata_completeness": comp,
        "technical_characteristics_count": len(chars),
        "duplicate_groups_research": len(dups),
        "open_duplicate_relations_in_db": status.get("openDuplicateFlags"),
        "leakage_group_summary": leak,
        "outliers_flagged": len(outl),
        "note": (
            "Research dataset is effectively empty; findings reflect reality."
            if len(research) < 10 else None
        ),
    }
    with open(REPORTS / "dataset_summary.json", "w") as f:
        json.dump(summary, f, indent=2)

    # ---- Console summary ----
    print("\n-- Workflow counts (API) --")
    for k, v in status["research"].items():
        print(f"  {k:>16}: {v}")
    print("\n-- Per class vs target 500 --")
    for cls, v in status["perClass"].items():
        print(f"  {cls:>18}: acquired={v['acquired']:<4} approved={v['approved']:<4} shortfall={500 - v['approved']}")
    print(f"\nTechnical analysis run on {len(chars)} research image file(s)")
    print(f"Duplicate groups: {len(dups)} | Outliers flagged: {len(outl)}")
    print(f"\nReports written to {REPORTS}/")


if __name__ == "__main__":
    main()
