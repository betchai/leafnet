# Research Insights Report

**Generated:** 2026-08-24 · **Dataset version:** v0.2 · **Models:** Phase-5/9 pilot candidates
**Live bundle:** `GET /api/insights?dataset_version=v0.2`

> ⚠️ All model metrics in this report come from an 11-image pilot dataset with a
> 1-image test set. They demonstrate the analytics capability; they are NOT
> research findings about MobileNetV2 performance.

## Executive Summary

LEAFNET's insights layer is operational: dataset distribution, per-candidate
model performance, directional confusion analysis, confidence/error statistics,
and evidence-linked improvement opportunities are all computed automatically
from recorded artifacts. At the current dataset scale (11 approved images,
test n=1), every model metric carries an explicit statistical-meaninglessness
warning. The single recurring observed pattern across all pilot runs is
leaf_spot → leaf_rust confusion, consistent with the Phase-2 flagged symptom
ambiguity — noted as anecdote pending real data.

## Dataset Overview

- 11 approved research images (target: 2,000) · Farm A / Farm B provenance
- Per class: healthy 2 · leaf_rust 3 · leaf_spot 3 · leaf_blight 3
- Shortfall vs 500/class target in every class
- Dev fixtures tracked separately and excluded from all research counts

## Data Quality

- Content-duplicate scan clean after Phase-8 dedup purge; ingestion hashes every file
- Open duplicate flags: 0 · annotation workflow states enforced since Phase 3

## Model Configuration

MobileNetV2 (torchvision IMAGENET1K_V2 pretrained) + Dropout(0.5)/Linear head;
baseline (frozen) and fine-tuned variants; Adam lr 1e-4; full configs in each
experiment's `config.json`.

## Overall & Per-Class Performance (pilot)

| Candidate | Test acc | Macro F1 |
|---|---|---|
| v0.2_EXP-0.2-B | 0.0 | 0.0 |
| v0.2_EXP-0.2-FT | 0.0 | 0.0 |

Per-class table available at `/insights` and in `ml/reports/evaluation/*/metrics.json`.

## Confusion Analysis

Single observation per candidate: leaf_spot → leaf_rust (EXP-0.2-B, EXP-001)
or leaf_spot → leaf_blight (EXP-0.2-FT). Possible explanation: documented visual
symptom overlap between spot/rust/blight classes. Evidence required to confirm:
a test set large enough for stable confusion estimates.

## Confidence Analysis

Observed behavior on the pilot error: low confidence (~0.29), small top-2 margin.
No high-confidence errors recorded. Calibration has not been formally established.

## Error Analysis

Error galleries, difficult-case flags, and per-error records exist under
`ml/reports/evaluation/*/`. At n=1 no pattern analysis is possible.

## Generalization Analysis

Train/validation/test comparison is not meaningful at this scale; the grouped
split will produce valid comparisons once the full dataset exists.

## Metadata-Based Analysis

Unavailable — required metadata (severity, lighting, cultivar) was not collected
in sufficient quantity. The system reports this honestly rather than inventing it.

## Application Insights

Insufficient data (predictions were purged during beta decommission). The
dashboard activates these statistics automatically as predictions accumulate.

## Improvement Opportunities (evidence-ranked, from live insights engine)

1. Collect images for all four classes to 500/class — evidence: shortfalls vs target
2. Investigate spot/rust/blight boundary cases with expert review — evidence: Phase-2 ambiguity flag + pilot confusions
3. Re-run evaluation only when test n ≥ 30 — evidence: statistical warning threshold

## Limitations & Research Implications

See `docs/dataset.md` §13 and `docs/PHASE_6_STATUS.md`. These results establish
that LEAFNET can *produce* defensible insights; they do not yet establish any
finding about mulberry leaf health classification itself.
