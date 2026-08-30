# Insights & Analytics (Phase 9)

How LEAFNET turns recorded data into evidence-based research insights.

## Sources (kept strictly separate)

| Source | Used for | Stored in |
|---|---|---|
| **Research dataset** (approved images, splits, evaluation artifacts) | dataset insights, model performance, confusion, confidence, errors | prepared manifests + `ml/reports/evaluation/*/` |
| **Application data** (user uploads, predictions, feedback) | application insights only | PostgreSQL |

Research metrics are never mixed with application statistics.

## Insight types & language rules

Every insight is one of: *observed fact*, *statistical finding*, *observed model
behavior*, *possible explanation* (labeled as such), or *recommendation*
(must cite its evidence). Hypotheses are never presented as causes.

## Calculations

- **Dataset:** counts per class/split; percentages; imbalance ratio = largest/smallest
  present class; shortfall vs 500/class target
- **Performance:** reads Phase-6 `metrics.json` (accuracy, per-class P/R/F1,
  macro/weighted); identifies best/weakest class by F1, most sensitive by recall,
  most precise by precision — the metric used is always named
- **Confusion:** directional pairs (A→B ≠ B→A), ranked by count; total misclassified
- **Confidence/errors:** from `predictions.csv`; high-confidence error threshold ≥0.8
  and low-confidence <0.5 are configuration, not validated boundaries;
  correct-vs-incorrect mean confidence comparison with honest "insufficient data" fallback

## Honest-evidence rules

- n < 30 → explicit statistical-meaninglessness warning
- No calibration performed → confidence is never correctness probability
- Missing metadata → "analysis unavailable because metadata was not collected"
- Zero data → "No … data currently available", never fabricated narratives

## Accessing

- Dashboard: `/insights` page (research + clearly-labeled application sections)
- API: `GET /api/insights?dataset_version=vX` → full JSON bundle
- Python directly: `src/analytics/insights.py::build_all`

## Limitations

Current artifacts come from an 11-image pilot; every model insight carries a
statistical-meaninglessness warning. Metadata-based analyses (severity,
cultivar, lighting) activate automatically only when that metadata exists.
