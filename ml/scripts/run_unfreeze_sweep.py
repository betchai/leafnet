"""UNFREEZE-BLOCKS / EPOCH-BUDGET SWEEP (research only — never registers models).

Grounds the r3 hyperparameter choices: fine_tune last N blocks (N=5) and epochs budget (20).

Design
------
One variable changes per row; everything else identical to the r3 runs (same grouped
manifest, same training.json defaults, same seed 42, same device):

  u0  : baseline head-only (frozen backbone)             -> already exists as r3_EXP-V1.0-B
  u3  : fine-tune last 3 blocks                          -> NEW (this script)
  u5  : fine-tune last 5 blocks                          -> already exists as r3_EXP-V1.0-FT
  u18 : fine-tune ENTIRE backbone (all 18 bottleneck blocks + BN) -> NEW (this script)
  u5e40: fine-tune last 5 blocks but epochs budget 40 / patience 8 -> NEW (stability check)

Epochs-20 / patience-5 evidence: r3 u5 stopped at epoch 10 (best = 5). If the budget were
binding, u5e40's best_val_accuracy should exceed u5's.

No test set is touched: train.py never loads the test split (Phase 6 evaluation is separate).
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ML_ROOT = Path(__file__).resolve().parents[1]
if str(ML_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_ROOT))

from src.training import train as trainer  # noqa: E402

MANIFEST = ML_ROOT / "data" / "prepared" / "cmtfa8pl20gz5yc87u3ahpdmk_seed42.jsonl"
OUT = ML_ROOT / "reports" / "sweeps" / "unfreeze_blocks_sweep.json"

RUNS = [
    {"exp_id": "SWP_unfreeze3", "fine_tune_layers": 3, "epochs": 20, "notes": "SWEEP: unfreeze last 3 blocks (patience 5)"},
    {"exp_id": "SWP_unfreeze18", "fine_tune_layers": 18, "epochs": 20, "notes": "SWEEP: unfreeze ALL backbone blocks (patience 5)"},
    {"exp_id": "SWP_u5_e40", "fine_tune_layers": 5, "epochs": 40, "notes": "SWEEP: 5 blocks but epochs budget 40 / patience 8"},
]


def main() -> None:
    if not MANIFEST.exists():
        raise SystemExit(f"manifest not found: {MANIFEST}")

    config = json.loads((ML_ROOT / "src/config/training.json").read_text())

    rows = []
    t_all = time.time()
    for run in RUNS:
        # patience override for the budget-stability run (u5e40)
        if run["exp_id"] == "SWP_u5_e40":
            config["experimentDefaults"]["patience"] = 8
        else:
            config["experimentDefaults"]["patience"] = 5
        print(f"\n=== {run['exp_id']}: unfreeze_last_{run['fine_tune_layers']} epochs_budget={run['epochs']} ===", flush=True)
        meta = trainer.run_experiment(
            exp_id=run["exp_id"],
            manifest_path=MANIFEST,
            config=config,
            dataset_version="SWEEP",
            notes=run["notes"],
            freeze_backbone=False,
            fine_tune_layers=run["fine_tune_layers"],
            epochs=run["epochs"],
        )
        rows.append({
            "experiment": run["exp_id"],
            "unfreeze_last_n_blocks": run["fine_tune_layers"],
            "epochs_budget": run["epochs"],
            "patience": config["experimentDefaults"]["patience"],
            "best_epoch": meta["best_epoch"],
            "best_val_accuracy": meta["best_val_accuracy"],
            "early_stopped_at": meta["early_stopped_at"],
        })

    # graft the two existing r3 points (u0 baseline, u5) — identical config/manifest, no re-training
    for base, key, blocks in [("r3_EXP-V1.0-B", "u0_hist", 0), ("r3_EXP-V1.0-FT", "u5_hist", 5)]:
        md_path = ML_ROOT / "models" / f"V1.0_{base}" / "metadata.json"
        hist_path = ML_ROOT / "models" / f"V1.0_{base}" / "training_history.json"
        if md_path.exists() and hist_path.exists():
            md = json.loads(md_path.read_text())
            hist = json.loads(hist_path.read_text())
            rows.append({
                "experiment": key,
                "unfreeze_last_n_blocks": blocks,
                "epochs_budget": md["configuration"]["epochs"],
                "patience": md["configuration"]["patience"],
                "best_epoch": md["best_epoch"],
                "best_val_accuracy": md["best_val_accuracy"],
                "early_stopped_at": md["early_stopped_at"],
                "duration_seconds": hist[-1]["seconds"] if hist else None,
            })

    table = {r["experiment"]: r for r in rows}
    table["meta"] = {
        "manifest": str(MANIFEST),
        "src": "design: sweep unfreeze-last-N-blocks; document epochs budget grounding",
        "device": "cpu (same as r3 official runs)",
        "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_seconds": round(time.time() - t_all, 1),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(table, indent=2))

    print("\n\n===== SWEEP SUMMARY (best VALIDATION accuracy; test set untouched) =====")
    print(f"{'exp':<12}{'blocks':>7}{'budget':>8}{'pat':>5}{'best_ep':>8}{'best_val_acc':>13}{'stopped':>9}")
    for r in sorted(rows, key=lambda r: (r.get("unfreeze_last_n_blocks") or 0, r["experiment"])):
        print(f"{r['experiment']:<12}{r['unfreeze_last_n_blocks']:>7}{r['epochs_budget']:>8}{r['patience']:>5}"
              f"{r['best_epoch']:>8}{str(r['best_val_accuracy']):>13}{str(r['early_stopped_at']):>9}")
    print(f"\nSummary written to {OUT}")


if __name__ == "__main__":
    main()