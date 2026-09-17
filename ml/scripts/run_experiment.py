#!/usr/bin/env python3
"""LEAFNET experiment runner (Phase 5).

Locks a dataset version, runs preflight, then trains the requested experiment.
The test split is never loaded here.

Usage:
    python scripts/run_experiment.py --dataset-id <id> --exp EXP-001 \
        --strategy baseline [--epochs 5] [--notes "..."]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ML_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_ROOT))

from src.training import train as trainer  # noqa: E402
from src.training.data import prepare_dataset, load_class_mapping  # noqa: E402
from src.training.preflight import run_preflight  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost:4000")
    ap.add_argument("--dataset-id", required=True, help="Dataset id from the API")
    ap.add_argument("--version-label", default=None, help="Human version label for records")
    ap.add_argument("--exp", required=True, help="Experiment ID, e.g. EXP-001")
    ap.add_argument("--strategy", choices=["baseline", "fine_tune"], default="baseline")
    ap.add_argument("--fine-tune-layers", type=int, default=5)
    ap.add_argument("--epochs", type=int, default=None)
    ap.add_argument("--notes", default="")
    ap.add_argument("--pilot", action="store_true",
                    help="Pipeline-validation mode: image-level split (grouping ignored). Research runs must NOT use this.")
    ap.add_argument("--auth-token", default="", help="Bearer token for API calls (manifest, evaluation)")
    args = ap.parse_args()

    config = json.loads((ML_ROOT / "src" / "config" / "training.json").read_text())
    seed = config["experimentDefaults"]["randomSeed"]

    manifest_path, audit = prepare_dataset(args.api, args.dataset_id, seed=seed,
                                           pilot=args.pilot, auth_token=args.auth_token)
    print(f"manifest prepared: {manifest_path}")
    print(json.dumps(audit.get("counts", {}), indent=2))

    ok, report = run_preflight(manifest_path, load_class_mapping())
    print(json.dumps(report, indent=2))
    if not ok:
        print("\nPREFLIGHT FAILED — training refused. Fix the problems above.")
        (ML_ROOT / "reports" / f"preflight_{args.exp}_FAILED.json").write_text(
            json.dumps(report, indent=2))
        sys.exit(2)

    freeze = args.strategy == "baseline"
    ftl = 0 if args.strategy == "baseline" else args.fine_tune_layers
    notes = args.notes or (
        f"{args.strategy} experiment on dataset {args.version_label or args.dataset_id}"
    )

    meta = trainer.run_experiment(
        exp_id=args.exp,
        manifest_path=manifest_path,
        config=config,
        dataset_version=args.version_label or args.dataset_id,
        notes=notes,
        freeze_backbone=freeze,
        fine_tune_layers=ftl,
        epochs=args.epochs,
    )
    print(json.dumps({k: meta[k] for k in
                      ["experiment_id", "best_epoch", "best_val_loss",
                       "best_val_accuracy", "status"]}, indent=2))
    print(f"\nArtifacts: {ML_ROOT / 'models'}/{meta['dataset_version']}_{args.exp}/"
          f" and {ML_ROOT / 'reports'}/experiments/{args.exp}/")


if __name__ == "__main__":
    main()
