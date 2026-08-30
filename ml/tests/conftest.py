"""Shared pytest fixtures.

All test images are generated synthetic DEV FIXTURES written to tmp paths.
They can never contaminate the research dataset (which lives in ml/data and
the database), satisfying the RESEARCH vs DEVELOPMENT separation requirement.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from PIL import Image

ML_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_ROOT))


@pytest.fixture(scope="session")
def ml_root() -> Path:
    return ML_ROOT


@pytest.fixture
def fixture_dir(tmp_path: Path) -> Path:
    """Directory of tiny synthetic 'leaf' images (clearly dev-only)."""
    d = tmp_path / "fixtures"
    d.mkdir()
    # solid green = fake healthy; speckled = fake spotted; two identical copies
    green = Image.new("RGB", (900, 900), (60, 120, 40))
    green.save(d / "DEVFIX_green_a.jpg")
    green.save(d / "DEVFIX_green_b.jpg")  # exact duplicate content
    spotted = Image.new("RGB", (900, 900), (60, 120, 40))
    for x in range(200, 700, 50):
        for y in range(200, 700, 50):
            for dx in range(8):
                for dy in range(8):
                    spotted.putpixel((x + dx, y + dy), (160, 90, 30))
    spotted.save(d / "DEVFIX_spotted.jpg")
    # corrupt file with an image extension
    (d / "DEVFIX_corrupt.jpg").write_bytes(b"not-an-image-at-all")
    return d
