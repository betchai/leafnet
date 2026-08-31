"""
PIPELINE: automated Step-9/10/11 runner (exploration → train → evaluate).

Runs as part of the Python ML service so the Node API never spawns Python
directly — it calls these endpoints over HTTP like everything else.

Endpoints (all prefixed under the same app as the beta service):
    POST /pipeline/start   {datasetId, versionLabel, experiments:[{id,strategy,fineTuneLayers,epochs}]}
                           → starts background job; returns {jobId}
    GET  /pipeline/status/{jobId} → full step-by-step job state
    GET  /pipeline/jobs           → all known jobs

Steps per experiment:
    9. exploration report refresh
    10. prepare manifest + preflight + train candidate(s)
    11. evaluate candidates on the isolated test set

Usage note: long-running (CPU). Poll status from the UI.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path

import torch

from fastapi import APIRouter

ML_ROOT = Path(__file__).resolve().parents[2]
if str(ML_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_ROOT))

from src.training.data import load_class_mapping, prepare_dataset  # noqa: E402
from src.training.preflight import run_preflight  # noqa: E402
from src.training import train as trainer  # noqa: E402
from src.evaluation.evaluate import evaluate_candidate  # noqa: E402

router = APIRouter()
_jobs: dict[str, dict] = {}
_lock = threading.Lock()


def _now():
    return datetime.now(timezone.utc).isoformat()


def _log(job: dict, msg: str):
    job["log"].append(f"[{_now()}] {msg}")
    print(f"[pipeline:{job['job_id']}] {msg}")


def _manifest_split_counts(manifest_path: Path) -> dict:
    """Best-effort split census of a prepared manifest (for audit logs)."""
    from collections import Counter
    try:
        rows = [json.loads(l) for l in manifest_path.read_text().splitlines() if l.strip()]
        return {**Counter(r["split"] for r in rows),
                "grouped_images": sum(1 for r in rows if r.get("collection_session_id")
                                      or r.get("farm_id") or r.get("plant_id") or r.get("leaf_id"))}
    except Exception:
        return {}


def _run_job(job: dict, params: dict):
    try:
        api_base = params["apiBase"]
        seed = json.loads((ML_ROOT / "src/config/training.json").read_text())["experimentDefaults"]["randomSeed"]

        # ---- Step 9: exploration report ----
        job["steps"]["exploration"] = {"status": "running"}
        _log(job, "Step 9: refreshing exploration reports")
        import subprocess
        r = subprocess.run(
            [str(ML_ROOT / ".venv/bin/python"), str(ML_ROOT / "scripts/explore_dataset.py"), "--api", api_base],
            capture_output=True, text=True, cwd=ML_ROOT)
        job["steps"]["exploration"] = {
            "status": "done" if r.returncode == 0 else "failed",
            "output_tail": r.stdout.strip().splitlines()[-8:] if r.stdout else [],
            "error_tail": r.stderr.strip().splitlines()[-5:] if r.stderr else [],
        }
        if r.returncode != 0:
            raise RuntimeError("exploration script failed")

        # ---- Step 10: prepare + preflight + train each experiment ----
        manifest_path, audit = prepare_dataset(api_base, params["datasetId"], seed=seed)
        ok, preflight = run_preflight(manifest_path, load_class_mapping())
        if not ok:
            # Explain exactly WHY grouped splitting was rejected (usually: too
            # few collection sessions per class to guarantee val/test groups),
            # then fall back to a documented PILOT split. Group keys are still
            # persisted in the manifest — they are never lost.
            reasons = " ".join(preflight.get("problems", [])) or "preflight failed"
            counts = _manifest_split_counts(manifest_path)
            _log(job, "grouped split rejected -> falling back to PILOT split")
            _log(job, f"grouped split reason: {reasons}")
            _log(job, f"grouped split counts: {counts}")
            manifest_path, audit = prepare_dataset(api_base, params["datasetId"],
                                                   seed=seed, force=True, pilot=True)
            ok, preflight = run_preflight(manifest_path, load_class_mapping())
            if not ok:
                raise RuntimeError("preflight failed even in pilot mode: "
                                   + "; ".join(preflight["problems"]))
            job["pilot_fallback"] = True
            job["grouped_split_reason"] = reasons
            note = ("[PILOT FALLBACK: image-level split used; grouped split rejected: "
                    + (reasons[:200] + "…" if len(reasons) > 200 else reasons) + "]")
            for exp in params["experiments"]:
                exp["notes"] = (exp.get("notes", "") + " " + note).strip()
        _log(job, f"preflight OK: {preflight['counts']}")

        config = json.loads((ML_ROOT / "src/config/training.json").read_text())

        # Re-run safety: if this version was already trained, make IDs unique
        # so historical artifacts are never overwritten.
        existing = {p.name for p in (ML_ROOT / "models").glob(f"{params['versionLabel']}_*")}
        if any(f"{params['versionLabel']}_{e['id']}" in existing for e in params["experiments"]):
            n = 2
            while any(f"{params['versionLabel']}_r{n}" in e2 or
                      f"{params['versionLabel']}_r{n}" in existing
                      for e2 in [f"{e['id']}" for e in params["experiments"]]
                      for f2 in [f"{params['versionLabel']}_r{n}"]):
                n += 1
            # simpler: find next free run suffix
            run_n = 2
            def uniq(eid):
                nonlocal run_n
                base = f"{params['versionLabel']}_{eid}"
                if base not in existing:
                    return eid
                while f"{params['versionLabel']}_r{run_n}_{eid}" in existing:
                    run_n += 1
                return f"r{run_n}_{eid}"
            for e in params["experiments"]:
                e["id"] = uniq(e["id"])
            _log(job, "re-run detected: experiment ids uniquified -> "
                 + ", ".join(e["id"] for e in params["experiments"]))

        trained = []
        results_all: dict = {}
        for exp in params["experiments"]:
            job["steps"][f"train_{exp['id']}"] = {"status": "running"}
            _log(job, f"Step 10: training {exp['id']} ({exp['strategy']})")

            def on_epoch(rec: dict, step_key: str = f"train_{exp['id']}") -> None:
                job["steps"][step_key].update({
                    "status": "running",
                    "epoch": rec.get("epoch"),
                    "train_accuracy": rec.get("train_accuracy"),
                    "val_accuracy": rec.get("val_accuracy"),
                    "seconds": rec.get("seconds"),
                })

            meta = trainer.run_experiment(
                exp_id=exp["id"], manifest_path=manifest_path, config=config,
                dataset_version=params["versionLabel"],
                notes=exp.get("notes", ""),
                # Partial fine-tuning: the pretrained backbone is FROZEN and only
                # the final `fineTuneLayers` blocks are unfrozen (controlled
                # variable). A baseline (strategy="baseline") has fineTuneLayers=0,
                # so the backbone stays fully frozen and only the head learns.
                freeze_backbone=True,
                fine_tune_layers=exp.get("fineTuneLayers", 0),
                epochs=exp.get("epochs"),
                on_epoch=on_epoch,
            )
            job["steps"][f"train_{exp['id']}"] = {"status": "done", "best_epoch": meta["best_epoch"]}
            trained.append((exp["id"], ML_ROOT / "models" / f"{params['versionLabel']}_{exp['id']}"))

        # ---- Step 11: evaluation (one pass per candidate) ----
        for exp_id, model_dir in trained:
            meta = json.loads((model_dir / "metadata.json").read_text())
            job["steps"][f"evaluate_{model_dir.name}"] = {"status": "running"}
            _log(job, f"Step 11: evaluating {model_dir.name}")
            result = evaluate_candidate(exp_id, model_dir, manifest_path,
                                        params["versionLabel"],
                                        ML_ROOT / "reports" / "evaluation")
            results_all[model_dir.name] = result
            if result.get("status") == "REFUSED":
                raise RuntimeError("evaluation refused: integrity failure")
            job["steps"][f"evaluate_{model_dir.name}"] = {
                "status": "done",
                "accuracy": result["metrics"]["accuracy"],
                "test_size": result["test_size"],
            }
            _write_model_card(model_dir, params["versionLabel"], exp_id, meta, result)
            job["steps"].setdefault(f"model_card_{model_dir.name}", {"status": "done"})
            # Auto-register candidate in the database (never sets isActive)
            import urllib.request
            reg = urllib.request.Request(
                f"{params['apiBase']}/api/tools/models/register",
                data=json.dumps({
                    "versionLabel": params["versionLabel"],
                    "experimentId": exp_id,
                    "architecture": "mobilenet_v2",
                    "framework": f"pytorch-{torch.__version__}",
                    "trainedAt": meta.get("trained_at"),
                    "notes": f"{meta.get('transfer_learning_strategy','')} — {meta.get('notes','')}"[:500],
                    "accuracy": result["metrics"]["accuracy"],
                    "f1Score": result["metrics"]["macro"]["f1"],
                    "confusionMatrix": result["confusion_matrix"],
                }).encode(),
                headers={"Content-Type": "application/json"}, method="POST")
            try:
                with urllib.request.urlopen(reg, timeout=15) as resp:
                    job["steps"][f"register_{model_dir.name}"] = {
                        "status": "done", "registered": json.loads(resp.read()).get("registered")}
            except Exception as re_err:  # noqa: BLE001 — registration failure is reported, not fatal
                job["steps"][f"register_{model_dir.name}"] = {"status": "failed", "error": str(re_err)}

        # Append a dated handoff section to the Phase 6 status doc
        if results_all:
            lines = [f"\n### Pipeline run {job['job_id']} — {_now()}\n",
                     f"Dataset version: {params['versionLabel']} · "
                     f"Pilot fallback: {job.get('pilot_fallback', False)}\n"]
            for name, r in results_all.items():
                m = r["metrics"]
                lines.append(f"- `{name}`: accuracy **{m['accuracy']}**, macro F1 "
                             f"**{m['macro']['f1']}**, test n={r['test_size']}")
            with open(ML_ROOT.parent / "docs" / "PHASE_6_STATUS.md", "a") as f:
                f.write("\n".join(lines) + "\n")
            _log(job, "PHASE_6_STATUS.md updated")
        job["status"] = "completed"
        _log(job, "ALL STEPS COMPLETE")

    except Exception as e:  # noqa: BLE001 — failures must be reported, never silent
        job["status"] = "failed"
        job["error"] = str(e)
        job["traceback"] = traceback.format_exc()[-2000:]
        _log(job, f"FAILED: {e}")


@router.post("/pipeline/start")
def start_pipeline(params: dict):
    required = ["datasetId", "versionLabel", "experiments"]
    missing = [k for k in required if k not in params]
    if missing:
        return {"error": f"missing fields: {missing}"}
    job_id = uuid.uuid4().hex[:12]
    job = {
        "job_id": job_id,
        "status": "running",
        "started_at": _now(),
        "params": {k: params[k] for k in ("datasetId", "versionLabel")},
        "steps": {},
        "log": [],
    }
    with _lock:
        _jobs[job_id] = job
    run_params = {
        **params,
        "apiBase": (
            params.get("apiBase")
            or os.environ.get("LEAFNET_API_BASE")
            or "http://localhost:4000"
        ).rstrip("/"),
    }
    threading.Thread(target=_run_job, args=(job, run_params), daemon=True).start()
    return {"jobId": job_id}


@router.get("/pipeline/status/{job_id}")
def status(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        return {"error": "unknown jobId"}
    return job


@router.get("/pipeline/jobs")
def jobs():
    return [{k: j[k] for k in ("job_id", "status", "started_at")} for j in _jobs.values()]


def _write_model_card(model_dir: Path, version: str, exp_id: str, meta: dict, ev: dict) -> None:
    """Auto-generate a model card from REAL run data. Never invents values."""
    pc = ev["metrics"]["per_class"]
    rows = "\n".join(
        f"| {k} | {pc[k]['support']} | {pc[k]['precision']} | {pc[k]['recall']} | {pc[k]['f1']} |"
        for k in pc
    )
    tiny = "⚠️ STATISTICALLY MEANINGLESS at this sample size." if ev["test_size"] < 30 else ""
    pilot = ""
    if "PILOT FALLBACK" in meta.get("notes", ""):
        pilot = "- PILOT fallback split used (dataset too small for grouped split)"
    cm = json.dumps(ev["confusion_matrix"], indent=2)
    card = (
        f"# Model Card — {model_dir.name}\n\n"
        f"> Generated automatically from real training + evaluation runs on {_now()}.\n"
        f"> Metrics are test-set results at n={ev['test_size']} (target research test size: 200).\n"
        f"> {tiny}\n\n"
        f"- **Model version:** {model_dir.name}\n"
        f"- **Architecture:** MobileNetV2 ({meta.get('pretrained_weights', '')})\n"
        f"- **Transfer learning:** {meta.get('transfer_learning_strategy', '')}\n"
        f"- **Dataset version:** {version}\n"
        f"- **Trained:** {meta.get('trained_at', '')} · best epoch {meta.get('best_epoch')}"
        f" · best val loss {meta.get('best_val_loss')}\n"
        f"- **Parameters:** {meta['parameters']['trainable_parameters']:,} trainable /"
        f" {meta['parameters']['total_parameters']:,} total\n\n"
        f"## Test metrics\n\n"
        f"| Class | Support | Precision | Recall | F1 |\n|---|---|---|---|---|\n{rows}\n\n"
        f"| Aggregate | Value |\n|---|---|\n"
        f"| Accuracy | {ev['metrics']['accuracy']} |\n"
        f"| Macro F1 | {ev['metrics']['macro']['f1']} |\n\n"
        f"## Confusion matrix\nColumns = predicted, rows = actual:\n\n```\n{cm}\n```\n\n"
        f"## Known limitations\n"
        f"- Dataset scope limited to collected farms/sessions/conditions\n"
        f"- Confidence NOT calibrated — do not read as probability of correctness\n"
        f"- Spot/blight visual ambiguity documented in Phase 2\n{pilot}\n\n"
        f"## Intended use / non-intended use\n"
        f"Intended: research evaluation and (after promotion) application suggestions "
        f"with cautious language.\n"
        f"NOT intended: biological diagnosis or any claim beyond the evaluated dataset scope.\n"
    )
    (model_dir / "MODEL_CARD.md").write_text(card)
