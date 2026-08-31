"""Insights API — serves the Phase-9 analytics bundle over HTTP."""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path

from fastapi import APIRouter, Query

ML_ROOT = Path(__file__).resolve().parents[2]
REPORTS = ML_ROOT / "reports"

router = APIRouter()


def _fetch_manifest_rows(api_base: str, dataset_id: str) -> list[dict]:
    url = f"{api_base}/api/datasets/{dataset_id}/manifest"
    with urllib.request.urlopen(url, timeout=20) as r:
        return [json.loads(l) for l in r.read().decode().splitlines() if l.strip()]


@router.get("/insights")
def insights(
    dataset_version: str = Query(default="v0.2"),
    dataset_id: str | None = Query(default=None),
    api_base: str = Query(default="http://localhost:4000"),
):
    """Full research insights bundle: dataset + per-candidate model insights.

    Reads Phase-6 evaluation artifacts from ml/reports/evaluation/. If a
    prepared manifest exists for the dataset it is used for dataset insights;
    otherwise only model-side insights are returned.
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
            if d.is_dir() and d.name.startswith(dataset_version) and (d / "metrics.json").exists():
                eval_dirs.append((d.name, d / "metrics.json"))
    out["models"] = build_all(rows, eval_dirs)["models"] if (rows or eval_dirs) else {}
    out["generated_note"] = (
        "All values are computed from recorded evaluation artifacts. "
        "Pilot-scale results are not research findings."
    )
    return out
