"""Formal model evaluation on the held-out test set (Phase 6).

Rules enforced here:
- test-set integrity preflight must pass before any prediction
- identical procedure for every candidate model
- full probability distribution recorded per image, never just the argmax
- the test data and model weights are never modified

Metrics produced are TEST metrics; at small n they are reported but must be
interpreted as meaningless (stated explicitly in reports).

Objective acceptance verdict: every evaluated candidate is compared against the
PRE-REGISTERED thresholds in src/config/acceptance.json (fixed before any run,
never tuned after results). The verdict is PASS / FAIL / INCONCLUSIVE and is
ADVISORY — it states objectively what was met, but a human expert still decides
whether to promote/activate/use the model.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_recall_fscore_support,
)

from src.training.data import ManifestDataset, load_split, load_class_mapping, build_transforms
from src.training.model import LeafNet, load_checkpoint  # noqa: F401
from torchvision import models


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
        return h.hexdigest()


def load_acceptance() -> dict:
    """Read the pre-registered acceptance thresholds."""
    return json.loads((Path(__file__).parents[2] / "src/config/acceptance.json").read_text())


def evaluate_acceptance(metrics: dict, test_size: int) -> dict:
    """Objective, pre-registered PASS/FAIL/INCONCLUSIVE verdict (advisory).

    Thresholds live in src/config/acceptance.json and are fixed BEFORE a run;
    they are never tuned after seeing results. The verdict does NOT decide
    whether a model is used — promotion/activation stays an expert decision. It
    only states objectively, per criterion, what was met on the held-out test.
    """
    cfg = load_acceptance()
    criteria = cfg["criteria"]
    per_class_f1 = [m["f1"] for m in metrics["per_class"].values()]
    per_class_precision = [m["precision"] for m in metrics["per_class"].values()]
    per_class_recall = [m["recall"] for m in metrics["per_class"].values()]

    results = [
        {"criterion": "test_size", "threshold": criteria["test_size_min"],
         "value": test_size, "met": test_size >= criteria["test_size_min"]},
        {"criterion": "accuracy", "threshold": criteria["accuracy_min"],
         "value": metrics["accuracy"], "met": metrics["accuracy"] >= criteria["accuracy_min"]},
        {"criterion": "macro_f1", "threshold": criteria["macro_f1_min"],
         "value": metrics["macro"]["f1"], "met": metrics["macro"]["f1"] >= criteria["macro_f1_min"]},
        {"criterion": "macro_precision", "threshold": criteria["macro_precision_min"],
         "value": metrics["macro"]["precision"],
         "met": metrics["macro"]["precision"] >= criteria["macro_precision_min"]},
        {"criterion": "macro_recall", "threshold": criteria["macro_recall_min"],
         "value": metrics["macro"]["recall"],
         "met": metrics["macro"]["recall"] >= criteria["macro_recall_min"]},
        {"criterion": "worst_class_f1", "threshold": criteria["per_class_f1_min"],
         "value": min(per_class_f1), "met": min(per_class_f1) >= criteria["per_class_f1_min"]},
        {"criterion": "worst_class_precision", "threshold": criteria["per_class_precision_min"],
         "value": min(per_class_precision),
         "met": min(per_class_precision) >= criteria["per_class_precision_min"]},
        {"criterion": "worst_class_recall", "threshold": criteria["per_class_recall_min"],
         "value": min(per_class_recall),
         "met": min(per_class_recall) >= criteria["per_class_recall_min"]},
    ]

    sufficient_evidence = test_size >= criteria["test_size_min"]
    if not sufficient_evidence:
        verdict = "INCONCLUSIVE"
        met_all = None
        note = (
            f"Not enough held-out test images (n={test_size}, need "
            f">={criteria['test_size_min']}) to render a verdict. Add verified, "
            "APPROVED test data before relying on these numbers."
        )
    else:
        met_all = all(r["met"] for r in results)
        verdict = "PASS" if met_all else "FAIL"
        note = (
            "Objective criteria met on the held-out test set."
            if verdict == "PASS"
            else "One or more objective criteria not met on the held-out test set."
        ) + " This verdict is advisory: an expert still decides whether to promote/activate/use the model."

    return {
        "verdict": verdict,
        "advisory": True,
        "sufficient_evidence": sufficient_evidence,
        "met_all": met_all,
        "config_version": cfg["version"],
        "criteria": {k: v for k, v in criteria.items()},
        "results": results,
        "note": note,
    }


def test_set_integrity(manifest_file: Path) -> tuple[bool, dict]:
    """Verify the test split is isolated, labeled, readable, and non-duplicated."""
    problems: list[str] = []
    rows = [json.loads(l) for l in manifest_file.read_text().splitlines() if l.strip()]
    test = [r for r in rows if r.get("split") == "test"]
    other = [r for r in rows if r.get("split") != "test"]

    if not test:
        problems.append("no test rows in prepared manifest")

    # labels valid + approved
    cm_keys = set(load_class_mapping())
    for r in test:
        if r.get("class") not in cm_keys:
            problems.append(f"test row {r['image_id'][:12]} has invalid label")
        if r.get("annotation_status") != "APPROVED":
            problems.append(f"test row {r['image_id'][:12]} not APPROVED")
        if not Path(r["path"]).exists():
            problems.append(f"test file missing: {r['path']}")

    # exact-duplicate leakage across splits via content hash of files
    hashes_other = {sha256_file(Path(r["path"])) for r in other if Path(r["path"]).exists()}
    for r in test:
        p = Path(r["path"])
        if p.exists() and sha256_file(p) in hashes_other:
            problems.append(f"LEAKAGE: test image {r['image_id'][:12]} duplicates a train/val image")

    return not problems, {
        "ok": not problems,
        "problems": problems,
        "test_size": len(test),
        "test_classes": dict(Counter(r["class"] for r in test)),
        "note": "Target research test size is 200. Small sizes make metrics statistically meaningless.",
    }


def rebuild_model_from_checkpoint(ckpt_path: Path) -> tuple[LeafNet, dict]:
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    backbone = models.mobilenet_v2(weights=None)
    backbone.classifier = torch.nn.Identity()
    model = LeafNet(backbone, num_classes=len(ckpt["class_mapping"]))
    model.load_state_dict(ckpt["model_state"])
    model.eval()
    return model, ckpt


def evaluate_candidate(
    exp_id: str,
    model_dir: Path,
    manifest_path: Path,
    dataset_version: str,
    out_root: Path,
) -> dict:
    """Identical evaluation procedure for every candidate."""
    integrity_ok, integrity = test_set_integrity(manifest_path)
    if not integrity_ok:
        return {"status": "REFUSED", "integrity": integrity}

    model, ckpt = rebuild_model_from_checkpoint(model_dir / "model_best.pt")
    config = json.loads((Path(__file__).parents[2] / "src/config/training.json").read_text())
    transform = build_transforms(config, train=False)
    id_to_key = {v: k for k, v in ckpt["class_mapping"].items()}
    keys = [id_to_key[i] for i in range(len(id_to_key))]

    test_rows = load_split(manifest_path, "test")
    predictions: list[dict] = []
    y_true, y_pred = [], []

    with torch.no_grad():
        for r in test_rows:
            img = Image.open(r["path"]).convert("RGB")
            probs = torch.softmax(model(transform(img).unsqueeze(0))[0], dim=0)
            prob_d = {keys[i]: round(float(p), 4) for i, p in enumerate(probs)}
            pred_key = max(prob_d, key=prob_d.get)
            y_true.append(r["class"])
            y_pred.append(pred_key)
            ranked = sorted(prob_d.items(), key=lambda kv: -kv[1])
            predictions.append({
                "image_id": r["image_id"],
                "path": r["path"],
                "true_label": r["class"],
                "predicted_label": pred_key,
                "background_type": r.get("background_type") or "unknown",
                "correct": pred_key == r["class"],
                "confidence": prob_d[pred_key],
                "probabilities": prob_d,
                "second_class": ranked[1][0],
                "second_confidence": ranked[1][1],
                "margin": round(ranked[0][1] - ranked[1][1], 4),
                "model_version": model_dir.name,
                "dataset_version": dataset_version,
                "experiment_id": exp_id,
                "predicted_at": datetime.now(timezone.utc).isoformat(),
            })

    labels_order = keys
    acc = float(accuracy_score(y_true, y_pred))
    prec, rec, f1, support = precision_recall_fscore_support(
        y_true, y_pred, labels=labels_order, zero_division=0)
    macro_p, macro_r, macro_f1 = (
        float(np.mean(prec)), float(np.mean(rec)), float(np.mean(f1)))
    weighted = precision_recall_fscore_support(
        y_true, y_pred, labels=labels_order, average="weighted", zero_division=0)
    cm = confusion_matrix(y_true, y_pred, labels=labels_order)

    errors = [p for p in predictions if not p["correct"]]
    difficult = [
        p for p in predictions
        if p["margin"] < 0.10 or p["confidence"] < 0.5
    ]

    # confidence stats (calibration/ECE deferred: requires meaningful n)
    correct_confs = [p["confidence"] for p in predictions if p["correct"]]
    incorrect_confs = [p["confidence"] for p in predictions if not p["correct"]]
    high_conf_wrong = [p for p in errors if p["confidence"] >= 0.8]

    # ---- distribution-shift (covariate) analysis ----
    domains = _per_domain_metrics(predictions, keys)
    natural = domains.get("natural")
    no_natural_test = natural is None
    distribution_shift = {
        "domains": domains,
        "reference_domain": "white_removed",
        "ood_domain": "natural",
        "no_domain_test_data": no_natural_test,
        "note": (
            "Natural-background (in-situ) images are OOD relative to the "
            "white-removed curated test set. A gap between white_removed and "
            "natural accuracy/macro-F1 indicates mild covariate shift."
            + (
                " No natural-background images exist in the test set, so "
                "out-of-distribution accuracy cannot be measured yet. Add "
                "verified in-situ (natural background) images to the dataset "
                "pool to enable this evaluation."
                if no_natural_test else ""
            )
        ),
    }

    result = {
        "status": "OK",
        "experiment_id": exp_id,
        "model_version": model_dir.name,
        "dataset_version": dataset_version,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "integrity": integrity,
        "test_size": len(test_rows),
        "statistical_warning": (
            f"n={len(test_rows)} test images (target 200). Metrics are computed "
            "formally but carry no statistical significance at this size."
        ),
        "metrics": {
            "accuracy": round(acc, 4),
            "per_class": {
                keys[i]: {
                    "precision": round(float(prec[i]), 4),
                    "recall": round(float(rec[i]), 4),
                    "f1": round(float(f1[i]), 4),
                    "support": int(support[i]),
                } for i in range(len(keys))
            },
            "macro": {"precision": round(macro_p, 4), "recall": round(macro_r, 4),
                      "f1": round(macro_f1, 4)},
            "weighted": {"precision": round(float(weighted[0]), 4),
                          "recall": round(float(weighted[1]), 4),
                          "f1": round(float(weighted[2]), 4)},
        },
        "confusion_matrix": {
            "columns_predicted": labels_order,
            "rows_actual": {keys[i]: [int(x) for x in cm[i]] for i in range(len(keys))},
        },
        "confidence_analysis": {
            "mean_confidence_correct": round(float(np.mean(correct_confs)), 4) if correct_confs else None,
            "mean_confidence_incorrect": round(float(np.mean(incorrect_confs)), 4) if incorrect_confs else None,
            "high_confidence_errors_ge_0.8": len(high_conf_wrong),
            "difficult_cases_margin_lt_0.10_or_conf_lt_0.5": len(difficult),
            "calibration_note": "Calibration (ECE/reliability diagram) intentionally NOT computed: requires meaningful test n.",
        },
        "distribution_shift": distribution_shift,
        "_rules_honored": "test set untouched; model weights untouched; single evaluation pass",
    }

    acceptance = evaluate_acceptance(result["metrics"], len(test_rows))
    result["acceptance"] = acceptance

    # ---- artifacts ----
    out = out_root / model_dir.name
    out.mkdir(parents=True, exist_ok=True)
    (out / "metrics.json").write_text(json.dumps(result, indent=2))
    (out / "distribution_shift.json").write_text(json.dumps(distribution_shift, indent=2))
    (out / "acceptance.json").write_text(json.dumps(acceptance, indent=2))

    with (out / "predictions.csv").open("w", newline="") as f:
        import csv
        w = csv.DictWriter(f, fieldnames=list(predictions[0].keys()))
        w.writeheader()
        w.writerows(predictions)

    with (out / "errors.csv").open("w", newline="") as f:
        import csv
        w = csv.writer(f)
        w.writerow(["image_id", "true_label", "predicted_label", "confidence",
                    "probabilities", "second_class", "second_confidence"])
        for e in errors:
            w.writerow([e["image_id"], e["true_label"], e["predicted_label"],
                        e["confidence"], json.dumps(e["probabilities"]),
                        e["second_class"], e["second_confidence"]])

    with (out / "confusion_matrix.csv").open("w", newline="") as f:
        import csv
        w = csv.writer(f)
        w.writerow(["Actual \\ Predicted"] + labels_order)
        for i, k in enumerate(labels_order):
            w.writerow([k] + [int(x) for x in cm[i]])

    _plot_confusion(out / "confusion_matrix.png", cm, keys, exp_id, len(test_rows))
    _error_galleries(out / "error_galleries", errors)
    (out / "difficult_cases.json").write_text(json.dumps(difficult, indent=2))
    return result


def _per_domain_metrics(predictions: list[dict], keys: list[str]) -> dict:
    """Per-background_type metrics for distribution-shift (OOD/covariate) eval.

    Computes accuracy + macro-F1 + per-class F1 per domain (white_removed,
    natural, unknown). Returns an empty/None map when a domain has no test rows
    so callers can honestly report it as "no domain test data" instead of
    fabricating a number.
    """
    from collections import defaultdict
    by_domain: dict[str, list[dict]] = defaultdict(list)
    for p in predictions:
        by_domain[p.get("background_type") or "background_type=missing"].append(p)

    out: dict[str, dict] = {}
    for domain, rows in sorted(by_domain.items()):
        yt = [p["true_label"] for p in rows]
        yp = [p["predicted_label"] for p in rows]
        support = len(rows)
        f1_by_class: dict[str, float] = {}
        if support:
            _, _, f1, _ = precision_recall_fscore_support(
                yt, yp, labels=keys, zero_division=0)
            f1_by_class = {keys[i]: round(float(f1[i]), 4) for i in range(len(keys))}
        out[domain] = {
            "support": support,
            "accuracy": round(float(accuracy_score(yt, yp)), 4) if support else None,
            "macro_f1": round(float(np.mean(
                [v for v in f1_by_class.values() if not np.isnan(v)])
            ), 4) if f1_by_class else None,
            "per_class_f1": f1_by_class,
        }
    return out


def _plot_confusion(png: Path, cm: np.ndarray, keys: list[str], title: str, n: int) -> None:
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(figsize=(5, 4))
        im = ax.imshow(cm, cmap="Greens")
        ax.set_xticks(range(len(keys)), keys, rotation=30, ha="right")
        ax.set_yticks(range(len(keys)), keys)
        for i in range(len(keys)):
            for j in range(len(keys)):
                ax.text(j, i, str(cm[i][j]), ha="center", va="center")
        ax.set_xlabel("Predicted"); ax.set_ylabel("Actual")
        ax.set_title(f"{title} (n={n} — see statistical warning)")
        fig.tight_layout(); fig.savefig(png, dpi=110); plt.close(fig)
    except Exception as e:  # noqa: BLE001
        png.write_text(f"plot failed: {e}")


def _error_galleries(dir_: Path, errors: list[dict]) -> None:
    """Contact sheets grouped by true class so a human can inspect failures."""
    dir_.mkdir(exist_ok=True)
    by_true: dict[str, list[dict]] = {}
    for e in errors:
        by_true.setdefault(e["true_label"], []).append(e)
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from PIL import Image
        for cls, items in by_true.items():
            fig, axes = plt.subplots(1, max(1, min(4, len(items))), figsize=(3 * max(1, min(4, len(items))), 3.6))
            axes = np.atleast_1d(axes)
            for ax, it in zip(axes, items[:4]):
                img = Image.open(it["path"]).convert("RGB").resize((200, 200))
                ax.imshow(img); ax.axis("off")
                ax.set_title(f"true={it['true_label']}\npred={it['predicted_label']}\nconf={it['confidence']}", fontsize=7)
            fig.suptitle(f"Errors where actual = {cls}")
            fig.tight_layout()
            fig.savefig(dir_ / f"errors_true_{cls}.png", dpi=110)
            plt.close(fig)
    except Exception as e:  # noqa: BLE001
        (dir_ / "gallery_failed.txt").write_text(str(e))
