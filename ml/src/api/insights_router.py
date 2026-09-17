"""Insights API — serves the Phase-9 analytics bundle over HTTP."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Query

ML_ROOT = Path(__file__).resolve().parents[2]
REPORTS = ML_ROOT / "reports"
MODELS_DIR = ML_ROOT / "models"

router = APIRouter()


@router.get("/insights")
def insights(
    dataset_version: str = Query(default="v0.2"),
    dataset_id: str | None = Query(default=None),
):
    """Full research insights bundle: dataset + per-candidate model insights.

    Reads Phase-6 evaluation artifacts from ml/reports/evaluation/. If a
    prepared manifest exists for the dataset it is used for dataset insights;
    otherwise only model-side insights are returned.

    Only candidates with a live checkpoint in ml/models/ AND an acceptance
    record are listed — orphaned/stale evaluation artifacts are excluded.
    """
    from src.analytics.insights import build_all, dataset_insights

    rows: list[dict] = []
    prep_dir = ML_ROOT / "data" / "prepared"
    if prep_dir.exists():
        candidates = sorted(prep_dir.glob(f"{dataset_id or '*'}_*.jsonl"))
        # Prefer the grouped (non-PILOT) manifest: it reflects the split the
        # registered models were actually trained/evaluated on.
        candidates = [c for c in candidates if "_PILOT" not in c.name] or candidates
        if candidates:
            with candidates[-1].open() as f:
                rows = [json.loads(l) for l in f if l.strip()]
            # exclude dev fixtures from research dataset insights
            rows = [r for r in rows if not r.get("is_dev_fixture", False)]

    out: dict = {"dataset_version": dataset_version}
    out["dataset"] = dataset_insights(rows) if rows else {
        "total_images": 0,
        "per_class": {}, "pct_per_class": {}, "splits": {},
        "observations": ["No prepared research manifest available."],
    }

    eval_root = REPORTS / "evaluation"
    eval_dirs: list[tuple[str, Path]] = []
    if eval_root.exists():
        for d in sorted(eval_root.iterdir()):
            if not (d.is_dir() and d.name.startswith(dataset_version)):
                continue
            if not (d / "metrics.json").exists():
                continue
            # Only candidates with live checkpoints and an acceptance verdict
            # are research artifacts worth listing. Orphaned or stale dirs from
            # earlier sessions (no model dir, no acceptance.json) are excluded.
            if not (MODELS_DIR / d.name).is_dir():
                continue
            if not (d / "acceptance.json").exists():
                continue
            eval_dirs.append((d.name, d / "metrics.json"))
    out["models"] = build_all(rows, eval_dirs)["models"] if (rows or eval_dirs) else {}
    out["generated_note"] = (
        "All values are computed from recorded evaluation artifacts. "
        "Pilot-scale results are not research findings."
    )
    return out
