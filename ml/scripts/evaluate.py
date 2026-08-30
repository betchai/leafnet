#!/usr/bin/env python3
"""LEAFNET Phase 6 — formal evaluation of candidate models on the held-out test set.

Identical procedure for every candidate. Test set is never modified.

Usage:
    python scripts/evaluate.py --dataset-id <id> [--models v0.2_EXP-001 v0.2_EXP-002]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ML_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_ROOT))

from src.evaluation.evaluate import evaluate_candidate  # noqa: E402
from src.training.data import prepare_dataset, load_class_mapping  # noqa: E402
from src.training.preflight import run_preflight  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost:4000")
    ap.add_argument("--dataset-id", required=True)
    ap.add_argument("--version-label", default=None)
    ap.add_argument("--models", nargs="*", default=["v0.2_EXP-001", "v0.2_EXP-002"])
    ap.add_argument("--manifest", default=None,
                    help="Prepared manifest path. Defaults to the PILOT manifest matching Phase-5 training.")
    args = ap.parse_args()

    if args.manifest:
        manifest_path = Path(args.manifest)
    else:
        candidates = sorted((ML_ROOT / "data" / "prepared").glob(f"{args.dataset_id}_*_PILOT.jsonl"))
        if not candidates:
            print("No prepared PILOT manifest found for this dataset — run training first "
                  "or pass --manifest explicitly.")
            sys.exit(2)
        manifest_path = candidates[-1]
    print(f"manifest: {manifest_path}")

    # The same preflight used for training guards the evaluation manifest too.
    ok, report = run_preflight(manifest_path, load_class_mapping())
    print("preflight:", "OK" if ok else json.dumps(report["problems"], indent=2))
    if not ok:
        sys.exit(2)

    results = {}
    for m in args.models:
        model_dir = ML_ROOT / "models" / m
        if not (model_dir / "model_best.pt").exists():
            print(f"SKIP {m}: no checkpoint")
            continue
        print(f"\n=== evaluating {m} ===")
        r = evaluate_candidate(
            exp_id=m.split("_")[-1],
            model_dir=model_dir,
            manifest_path=manifest_path,
            dataset_version=args.version_label or args.dataset_id,
            out_root=ML_ROOT / "reports" / "evaluation",
        )
        results[m] = r
        if r.get("status") == "REFUSED":
            print("REFUSED:", json.dumps(r["integrity"]["problems"], indent=2))
            continue
        print(json.dumps(r["metrics"], indent=2))

    (ML_ROOT / "reports" / "evaluation" / f"{args.version_label or args.dataset_id}_results.json") \
        .write_text(json.dumps(results, indent=2))
    print(f"\nAll artifacts: {ML_ROOT/'reports'/'evaluation'}/")


if __name__ == "__main__":
    main()
