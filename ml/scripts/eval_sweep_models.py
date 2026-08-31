"""Evaluate the sweep fine-tune candidates (u3, u18) on the isolated grouped test split.
Identical procedure to the official r3 evaluations (evaluate_candidate)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ML_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_ROOT))

from src.evaluation.evaluate import evaluate_candidate  # noqa: E402

MANIFEST = ML_ROOT / "data" / "prepared" / "cmtfa8pl20gz5yc87u3ahpdmk_seed42.jsonl"
OUT_ROOT = ML_ROOT / "reports" / "evaluation"

for name in ("SWP_unfreeze3", "SWP_unfreeze18"):
    print(f"\n=== evaluating {name} (test split, grouped) ===", flush=True)
    res = evaluate_candidate(name, ML_ROOT / "models" / f"SWEEP_{name}",
                             MANIFEST, "SWEEP", OUT_ROOT)
    if res.get("status") == "REFUSED":
        print("REFUSED:", res.get("integrity"))
        continue
    m = res["metrics"]
    print(f"{name}: test accuracy {m['accuracy']} · macro F1 {m['macro']['f1']} · n={res['test_size']}")
    dm = OUT_ROOT / f"SWEEP_{name}" / "metrics.json"
    print("wrote:", dm)