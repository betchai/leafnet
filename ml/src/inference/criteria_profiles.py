"""Criteria-based "why" for LEAFNET explainability.

Given the measured symptom signals (see symptom_analysis.py) and the model's
top + runner-up class, produce a small set of per-criterion votes phrased as
image evidence. Each criterion states which of the two candidate classes the
measured signal *supports*, or "inconclusive" when it is neutral.

Signatures are derived from ml/src/config/classes.json (visual_indicators,
annotation_guidance, confounding_conditions) — the approved four-class
taxonomy. Terminology is deliberately hypothesis-checking ("evidence
consistent with X is present") rather than claiming the model "reasoned" X.
"""

from __future__ import annotations

HEALTHY = "healthy"
RUST = "leaf_rust"
SPOT = "leaf_spot"
BLIGHT = "leaf_blight"

# Relative thresholds for each measure (derived from symptom semantics).
_M = {
    "necrosis_fraction": {
        "blight_high": 0.18,   # large areas of dead tissue -> blight
        "spot_low": 0.02,      # at least some necrosis typical of spot/rust
        "healthy_low": 0.015,  # below this, sparing -> healthy-like
    },
    "largest_component_share": {
        "blight": 0.22,        # one big coalesced necrotic area -> blight
        "spot": 0.45,          # below this, discrete -> spot-like
    },
    "chlorosis_fraction": {
        "spot_halo": 0.10,     # yellow halos around spots
    },
    "pustule_density": {
        "rust": 0.0015,        # tiny pulverulent structures -> rust
        "spot_high": 0.01,     # above this, likely broader damage not pustules
    },
    "margin_involvement": {
        "blight": 0.02,        # marginal necrosis -> blight
    },
    "leaf_green_fraction": {
        "healthy": 0.85,       # mostly green -> healthy
        "blight_low": 0.45,    # far below -> heavy damage
    },
}


def _vsup(meas, key, gate, compare="ge") -> bool:
    """Compare a measure against a threshold; 'ge' or 'le'."""
    val = meas.get(key, 0.0)
    if compare == "le":
        return val <= gate
    return val >= gate


def _criterion(
    key: str,
    label: str,
    description: str,
    value,
    unit: str,
    *,
    supports: str,  # "top" | "second" | "inconclusive"
    supports_class: str | None = None,
    top: str | None = None,
) -> dict:
    return {
        "key": key,
        "label": label,
        "description": description,
        "value": value if isinstance(value, (int, float, bool)) else str(value),
        "unit": unit,
        "supports": supports,
        "supports_class": supports_class if supports != "inconclusive" else None,
    }


def _append_healthy_rule(c, meas, top, second):
    """Handles pairs where one candidate is healthy."""
    healthy = top if top == HEALTHY else second
    other = second if top == HEALTHY else top
    green = meas.get("leaf_green_fraction", 0.0)
    nec = meas.get("necrosis_fraction", 0.0)
    pus = meas.get("pustule_density", 0.0)
    # healthy is supported when green dominates and necrosis/pustules are minimal
    healthy_supported = (
        green >= _M["leaf_green_fraction"]["healthy"]
        and nec <= _M["necrosis_fraction"]["healthy_low"]
        and pus <= _M["pustule_density"]["rust"]
    )
    supports = "top" if healthy == top else "second"
    c.append(_criterion(
        "overall_greenness", "Overall greenness",
        "Fraction of the leaf that is uniformly green (low necrosis/pustule signal)",
        f"{green:.0%}", "of leaf",
        supports=supports if healthy_supported else "inconclusive",
        supports_class=healthy if healthy_supported else None,
    ))
    return c


def evaluate_criteria(meas: dict, top: str, second: str) -> list[dict]:
    """Return ordered per-criterion votes for the resolved (top, second) pair."""
    c: list[dict] = []

    # --- healthy inclusive pairs -------------------------------------------------
    if HEALTHY in (top, second):
        return _append_healthy_rule(c, meas, top, second)

    # --- rust vs spot / blight ---------------------------------------------------
    if RUST in (top, second):
        other = second if top == RUST else top
        pus = meas.get("pustule_density", 0.0)
        rust_supported = pus >= _M["pustule_density"]["rust"] and pus <= _M["pustule_density"]["spot_high"]
        supports = "top" if top == RUST else "second"
        c.append(_criterion(
            "powdery_pustules", "Powdery pustules",
            "Tiny raised powdery/rust-like structures typical of rust",
            f"{pus:.2%}", "of leaf",
            supports=supports if rust_supported else "inconclusive",
            supports_class=RUST if rust_supported else None,
        ))
        # rust and spot overlap on discrete signs; rely on discreteness vs blight
        if other == BLIGHT:
            _append_spread(c, meas, top, second)

    # --- spot vs blight ----------------------------------------------------------
    if {SPOT, BLIGHT} <= {top, second}:
        _append_spread(c, meas, top, second)
        _append_margin(c, meas, top, second)
        _append_necrosis(c, meas, top, second)
        _append_halo(c, meas, top, second)

    if not c:
        # generic catch-all: necrosis extent between any two disease classes
        _append_spread(c, meas, top, second)

    return c


def _append_spread(c, meas, top, second):
    """Discrete spots vs one large coalesced necrotic area."""
    share = meas.get("largest_component_share", 0.0)
    if share >= _M["largest_component_share"]["blight"]:
        supports = "top" if top == BLIGHT else "second"
        c.append(_criterion(
            "lesion_spread", "Lesion spread",
            "Necrosis concentrated into one large coalesced area (blight-like) vs discrete spots",
            f"{share:.0%}", "of necrotic area",
            supports=supports, supports_class=BLIGHT,
        ))
    elif share <= _M["largest_component_share"]["spot"]:
        supports = "top" if top == SPOT else "second"
        c.append(_criterion(
            "lesion_spread", "Lesion spread",
            "Necrosis split into discrete, separate spots (spot-like)",
            f"{share:.0%}", "of necrotic area",
            supports=supports, supports_class=SPOT,
        ))
    else:
        supports = "second" if top == BLIGHT else "top"
        c.append(_criterion(
            "lesion_spread", "Lesion spread",
            "Discreteness between discrete spots and full coalescence (inconclusive)",
            f"{share:.0%}", "of necrotic area",
            supports="inconclusive",
        ))


def _append_margin(c, meas, top, second):
    gate = _M["margin_involvement"]["blight"]
    mar = meas.get("margin_involvement", 0.0)
    if mar >= gate:
        supports = "top" if top == BLIGHT else "second"
        c.append(_criterion(
            "margin_involvement", "Margin involvement",
            "Necrosis reaches the leaf margin / tip (blight-like), which is uncommon for discrete spot",
            f"{mar:.0%}", "of leaf edge",
            supports=supports, supports_class=BLIGHT,
        ))
    else:
        c.append(_criterion(
            "margin_involvement", "Margin involvement",
            "Necrosis largely avoids the leaf margin (spot-like versus spreading blight)",
            f"{mar:.0%}", "of leaf edge",
            supports=("second" if top == BLIGHT else "top"),
            supports_class=(SPOT if top == SPOT else BLIGHT if top == BLIGHT else None),
        ))


def _append_necrosis(c, meas, top, second):
    nec = meas.get("necrosis_fraction", 0.0)
    if nec >= _M["necrosis_fraction"]["blight_high"]:
        supports = "top" if top == BLIGHT else "second"
        c.append(_criterion(
            "necrosis_extent", "Necrotic extent",
            "Large fraction of the leaf is dead tissue (blight-like)",
            f"{nec:.0%}", "of leaf",
            supports=supports, supports_class=BLIGHT,
        ))
    elif nec <= _M["necrosis_fraction"]["healthy_low"]:
        supports = "top" if top == SPOT else "second"
        c.append(_criterion(
            "necrosis_extent", "Necrotic extent",
            "Little necrotic tissue — mild or early presentation",
            f"{nec:.0%}", "of leaf",
            supports=supports, supports_class=SPOT,
        ))
    else:
        c.append(_criterion(
            "necrosis_extent", "Necrotic extent",
            "Moderate necrotic area — consistent with either discrete spot or partial blight",
            f"{nec:.0%}", "of leaf",
            supports="inconclusive",
        ))


def _append_halo(c, meas, top, second):
    chl = meas.get("chlorosis_fraction", 0.0)
    if chl >= _M["chlorosis_fraction"]["spot_halo"]:
        supports = "top" if top == SPOT else "second"
        c.append(_criterion(
            "chlorotic_halo", "Chlorotic halo",
            "Yellow (chlorotic) tissue, typical of spots with halos rather than spreading blight",
            f"{chl:.0%}", "of leaf",
            supports=supports, supports_class=SPOT,
        ))
    else:
        c.append(_criterion(
            "chlorotic_halo", "Chlorotic halo",
            "Little chlorotic (yellow) tissue detected",
            f"{chl:.0%}", "of leaf",
            supports="inconclusive",
        ))
