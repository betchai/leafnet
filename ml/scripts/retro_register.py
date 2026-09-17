"""Retro-register completed pipeline candidates that 401'd during run 1.

The register route is gated by requireServiceToken (X-Service-Token header), which
run-1's pipeline did not send. This one-off script re-issues registration for the
given candidates using their recorded evaluation artifacts.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request

ML_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def register(api_base: str, version_label: str, experiment_id: str) -> None:
    eval_dir = os.path.join(ML_ROOT, "reports", "evaluation", f"{version_label}_{experiment_id}")
    model_dir = os.path.join(ML_ROOT, "models", f"{version_label}_{experiment_id}")
    with open(os.path.join(eval_dir, "metrics.json")) as f:
        metrics = json.load(f)
    with open(os.path.join(eval_dir, "acceptance.json")) as f:
        acceptance = json.load(f)
    with open(os.path.join(model_dir, "metadata.json")) as f:
        meta = json.load(f)

    payload = {
        "versionLabel": version_label,
        "experimentId": experiment_id,
        "architecture": meta.get("architecture", "mobilenet_v2"),
        "framework": "pytorch",
        "trainedAt": meta.get("trained_at"),
        "notes": f"{meta.get('transfer_learning_strategy', '')} — {meta.get('notes', '')}"[:500],
        "accuracy": metrics["metrics"]["accuracy"],
        "f1Score": metrics["metrics"]["macro"]["f1"],
        "acceptanceVerdict": acceptance.get("verdict"),
        "confusionMatrix": metrics["confusion_matrix"],
    }
    svc_token = os.environ.get("SERVICE_TOKEN", "")
    req = urllib.request.Request(
        f"{api_base}/api/tools/models/register",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "X-Service-Token": svc_token},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            print(f"{version_label}_{experiment_id}: {resp.read().decode()}")
    except Exception as e:  # noqa: BLE001
        print(f"{version_label}_{experiment_id}: FAILED — {e}")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-base", default="http://localhost:4000")
    ap.add_argument("--version-label", default="V1.0")
    ap.add_argument("experiment_ids", nargs="+")
    args = ap.parse_args()
    for eid in args.experiment_ids:
        register(args.api_base, args.version_label, eid)