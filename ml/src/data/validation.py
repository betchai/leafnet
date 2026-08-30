"""Image file validation for the LEAFNET dataset.

Checks readability, format, dimensions, color channels, and corruption.
Never mutates or deletes anything — produces a report dict.

Usage:
    from src.data.validation import validate_directory
    report = validate_directory(Path("ml/data/validated"))
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

CONFIG_PATH = Path(__file__).resolve().parents[1] / "config" / "pipeline.json"

ACCEPTABLE = "acceptable"
QUESTIONABLE = "questionable"
REJECTED = "rejected"


def _load_config() -> dict:
    return json.loads(CONFIG_PATH.read_text())


def validate_image(path: Path, min_resolution: tuple[int, int]) -> dict:
    """Validate a single image file. Returns a per-file verdict."""
    result: dict = {
        "filename": path.name,
        "path": str(path),
        "verdict": ACCEPTABLE,
        "issues": [],
    }

    suffix = path.suffix.lower().lstrip(".")
    if suffix == "jpg":
        suffix = "jpeg"
    if suffix not in {"jpeg", "png"}:
        result["verdict"] = REJECTED
        result["issues"].append(f"unsupported_format:{suffix}")
        return result

    try:
        # load() forces full decode — catches truncated/corrupt files
        with Image.open(path) as img:
            img.load()
            width, height = img.size
            mode = img.mode
    except Exception as exc:  # noqa: BLE001 - any decode failure is a rejection
        result["verdict"] = REJECTED
        result["issues"].append(f"unreadable:{type(exc).__name__}")
        return result

    result.update({"width": width, "height": height, "mode": mode})

    if width < min_resolution[0] or height < min_resolution[1]:
        result["issues"].append("below_min_resolution")
        result["verdict"] = REJECTED

    if mode not in {"RGB", "RGBA", "L"}:
        result["issues"].append(f"unexpected_color_mode:{mode}")

    if path.stat().st_size < 5_000:  # tiny files are almost always broken/thumbnails
        result["issues"].append("suspiciously_small_file")
        result["verdict"] = QUESTIONABLE if result["verdict"] == ACCEPTABLE else result["verdict"]

    # Questionable (needs human review), never auto-rejected
    if result["verdict"] == ACCEPTABLE and width * height < 500_000:
        result["issues"].append("low_resolution_review_recommended")
        result["verdict"] = QUESTIONABLE

    return result


def validate_directory(directory: Path) -> dict:
    """Validate every supported image in a directory (non-recursive)."""
    config = _load_config()
    formats = config["supportedFormats"]
    min_w, min_h = config.get("qualityRules", {}).get(
        "minResolutionPx", [800, 800]
    )
    min_res = (min_w, min_h)

    files = sorted(
        p for p in directory.iterdir()
        if p.is_file() and p.suffix.lower().lstrip(".") in {f.lower() for f in formats}
    ) if directory.exists() else []

    results = [validate_image(p, min_res) for p in files]

    summary = {
        "directory": str(directory),
        "total_files": len(results),
        "acceptable": sum(r["verdict"] == ACCEPTABLE for r in results),
        "questionable": sum(r["verdict"] == QUESTIONABLE for r in results),
        "rejected": sum(r["verdict"] == REJECTED for r in results),
        "results": results,
    }
    return summary


if __name__ == "__main__":
    import sys

    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("ml/data/validated")
    print(json.dumps(validate_directory(target), indent=2))
