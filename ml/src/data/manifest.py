"""Dataset manifest generation for LEAFNET.

Format: JSON Lines (JSONL) — one image record per line.

Why JSONL:
- streaming-friendly (datasets will hold 2,000+ rows and grow),
- git-diffable line-by-line (auditable changes between versions),
- trivially loadable by pandas (`read_json(lines=True)`), Python, and Node,
- no schema rigidity: optional metadata fields may be absent per row.

Manifest columns follow docs/annotation-schema.md.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

MANIFEST_FIELDS = [
    "image_id", "path", "source", "source_type", "license",
    "class", "severity", "annotation_status",
    "plant_id", "leaf_id", "farm_id", "collection_session_id",
    "split", "dataset_version",
]


def manifest_hash(path: Path) -> str:
    """Content hash of a manifest — recorded on the Dataset row for audit."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_manifest(rows: list[dict], output_path: Path) -> str:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w") as f:
        for row in rows:
            f.write(json.dumps({k: row.get(k) for k in MANIFEST_FIELDS}) + "\n")
    return manifest_hash(output_path)


def read_manifest(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text().splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows
