"""Image-based symptom measurements for LEAFNET explainability (B leg).

Deterministic, model-free CV heuristics that describe what is visible in the
leaf photo (necrosis, chlorosis, lesion discreteness, margin involvement,
pustule-like structures, overall greenness). These are IMAGE-EVIDENCE
signals — independent of what the neural network "looked at" — and are used to
phrase an explainable story alongside saliency (the C leg).

These are heuristics, not a diagnosis and not a segmentation. Relative
(per-image) thresholds are used instead of absolute ones to stay somewhat
robust to variation in lighting and camera across field photos.
"""

from __future__ import annotations

import numpy as np
from PIL import Image
from scipy import ndimage

ANALYSIS_SIZE = 256  # working resolution for measurement (kept small for speed)


def _to_arrays(img: Image.Image) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (rgb, hsv) arrays downscaled to ANALYSIS_SIZE, float32 in [0,1]."""
    small = img.convert("RGB").resize((ANALYSIS_SIZE, ANALYSIS_SIZE), Image.Resampling.BILINEAR)
    rgb = np.asarray(small).astype(np.float32) / 255.0
    hsv = np.asarray(small.convert("HSV")).astype(np.float32) / 255.0
    return rgb, hsv


def _leaf_mask(rgb: np.ndarray) -> np.ndarray:
    """Mask of leaf/foreground pixels (non-near-white background)."""
    min_ch = rgb.min(axis=2)
    max_ch = rgb.max(axis=2)
    # background: very bright AND low saturation (flat) OR near-white
    background = (rgb.mean(axis=2) > 0.90) | ((rgb.mean(axis=2) > 0.75) & ((max_ch - min_ch) < 0.08))
    mask = ~background
    mask = ndimage.binary_opening(mask, structure=np.ones((3, 3)))
    mask = ndimage.binary_closing(mask, structure=np.ones((5, 5)))
    mask = ndimage.binary_fill_holes(mask)
    return mask


def _necrotic_mask(rgb: np.ndarray, leaf: np.ndarray) -> np.ndarray:
    """Dark brown/black 'dead' tissue pixels on the leaf.

    Dead/dried tissue is dark and roughly neutral-to-warm in hue. Pure dark +
    very-low-saturation catches scorched black; a warm-dark band catches drier
    brown. Both are region-checked so highlights on a single dark leaf don't
    erode the signal.
    """
    hsv = _hsv(rgb)
    h = hsv[..., 0]
    v = hsv[..., 2]
    mean = rgb.mean(axis=2)
    # necrotic = dark tissue that is NOT live-green (brown/red/neutral/black)
    dark = mean < 0.42
    not_green = ~((h > 0.25) & (h < 0.45))
    return (dark & not_green & (v < 0.60)) & leaf


def _chlorotic_mask(rgb: np.ndarray, leaf: np.ndarray) -> np.ndarray:
    """Yellow/pale 'chlorotic' pixels on the leaf (halos / yellowing)."""
    hsv = _hsv(rgb)
    h = hsv[..., 0]
    v = hsv[..., 2]
    # yellow hue band, moderate value, not too pale background
    yellow = ((h > 0.10) & (h < 0.22)) | (h < 0.05)
    return yellow & (v > 0.30) & leaf


def _hsv(rgb: np.ndarray) -> np.ndarray:
    """Float RGB [0,1] -> HSV [0,1] float array."""
    img = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)).convert("HSV")
    return np.asarray(img).astype(np.float32) / 255.0


def _pustule_mask(rgb: np.ndarray, leaf: np.ndarray) -> np.ndarray:
    """Tiny bright orange/tan raised 'rust-like' structures (heuristic).

    Pustules are small, roundish, high-value, moderately saturated spots that
    contrast with surrounding leaf tissue.
    """
    hsv = _hsv(rgb)
    h = hsv[..., 0]
    s = hsv[..., 1]
    v = hsv[..., 2]
    # orange/tan band
    orange = (h > 0.03) & (h < 0.12) & (s > 0.25) & (s < 0.70) & (v > 0.45)
    return orange & leaf


def _margin_involvement(necrotic: np.ndarray, leaf: np.ndarray) -> float:
    """Fraction of necrotic area touching the leaf-edge ring (0..1)."""
    interior = ndimage.binary_erosion(leaf, structure=np.ones((3, 3)))
    ring = leaf & ~interior
    if not np.any(necrotic):
        return 0.0
    on_margin = bool(np.any(necrotic & ring))
    # continuous-ish estimate: fraction of leaf ring that is necrotic
    return float(ring[necrotic].sum() / max(1, ring.sum())) if on_margin else 0.0


def _connected_components(mask: np.ndarray) -> tuple[int, np.ndarray]:
    """Label connected components; return (count, labeled array)."""
    labeled, n = ndimage.label(mask, structure=np.ones((3, 3)))
    return int(n), labeled


def measure_symptoms(img: Image.Image) -> dict:
    """Compute symptom measurements for an uploaded leaf image.

    Returns a flat dict of floats; all proportions are relative to leaf area.
    """
    rgb, _ = _to_arrays(img)
    leaf = _leaf_mask(rgb)
    leaf_area = max(1, int(leaf.sum()))

    nec = _necrotic_mask(rgb, leaf)
    chl = _chlorotic_mask(rgb, leaf)
    pus = _pustule_mask(rgb, leaf)

    necrosis_fraction = float(nec.sum() / leaf_area)
    chlorosis_fraction = float(chl.sum() / leaf_area)
    pustule_density = float(pus.sum() / leaf_area)

    n_nec, nec_labeled = _connected_components(nec)
    n_chl, _ = _connected_components(chl)
    n_pus, _ = _connected_components(pus)

    # lesion-size statistics over necrotic components (excluding 1-px noise)
    sizes = np.bincount(nec_labeled.ravel())
    sizes = sizes[1:]
    real = sizes[sizes >= 3]
    lesion_count = int(len(real))
    largest = int(real.max()) if len(real) else 0
    largest_component_share = float(largest / max(1, int(nec.sum())))

    green = (rgb[..., 1] > rgb[..., 0]) & (rgb[..., 1] > rgb[..., 2]) & leaf
    leaf_green_fraction = float(green.sum() / leaf_area)

    return {
        "necrosis_fraction": round(necrosis_fraction, 4),
        "chlorosis_fraction": round(chlorosis_fraction, 4),
        "pustule_density": round(pustule_density, 4),
        "lesion_count": lesion_count,
        "largest_component_share": round(largest_component_share, 4),
        "chlorotic_component_count": int(n_chl),
        "margin_involvement": round(_margin_involvement(nec, leaf), 4),
        "leaf_green_fraction": round(leaf_green_fraction, 4),
        "leaf_area_px": int(leaf_area),
    }


def detect_background(img: Image.Image) -> dict:
    """Classify the image background as white-removed vs natural (in-situ).

    Distribution signal for OOD analysis: curated lab/curation sets are usually
    photographed against a clean white/plain background, while live field photos
    keep the natural background. Returns:
        background_type: "white_removed" | "natural" | "unknown"
        white_fraction:  fraction of the border/background region that is
                         near-uniform near-white (0..1)
        background_fraction: fraction of the image not covered by the leaf

    Heuristic only — no model. Not a diagnosis.
    """
    rgb, _ = _to_arrays(img)
    leaf = _leaf_mask(rgb)
    total = rgb.shape[0] * rgb.shape[1]
    leaf_frac = float(leaf.sum() / max(1, total))
    bg = ~leaf
    bg_frac = float(bg.sum() / max(1, total))

    if bg.sum() == 0:
        return {"background_type": "unknown", "white_fraction": 0.0,
                "background_fraction": round(bg_frac, 4)}

    # Guard: if (nearly) the whole frame reads as background there is no
    # reliable leaf/background split (e.g. a blank/off-frame photo) — refuse to
    # guess rather than mislabel it as a natural (in-situ) OOD image.
    if leaf_frac < 0.05:
        return {"background_type": "unknown", "white_fraction": 0.0,
                "background_fraction": round(bg_frac, 4)}

    # Background pixels must be near-white AND low-chroma (uniform/flat): a white
    # curation backdrop reads as low mean-color variance with high luminance.
    hsv = _hsv(rgb)
    lum = rgb.mean(axis=2)
    chroma = hsv[..., 1]
    white_mask = (lum > 0.80) & (chroma < 0.10) & bg
    white_frac = float(white_mask.sum() / bg.sum())

    if white_frac >= 0.90:
        btype = "white_removed"
    elif white_frac <= 0.30:
        btype = "natural"
    else:
        btype = "unknown"
    return {"background_type": btype, "white_fraction": round(white_frac, 4),
            "background_fraction": round(bg_frac, 4)}
