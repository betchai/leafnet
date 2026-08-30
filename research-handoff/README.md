# Research Handoff Package

This directory indexes everything needed to continue or defend the LEAFNET
research. Large binaries are referenced, not duplicated.

## Final versions at handoff
- **Dataset:** v0.2 (11 approved images — pilot scale; target 2,000 unmet)
- **Model:** v0.2_EXP-0.2-B (PILOT — frozen, see MANIFEST.json)
- **Evaluation:** Phase-6 pipeline, test n=1 → NOT READY verdict
- **Code:** this repository (see git log for phase commits)

| Directory | Contents |
|---|---|
| `dataset/` | → `ml/data/` (raw/prepared manifests) + PostgreSQL records |
| `model/` | → `ml/models/v0.2_EXP-0.2-B/` (checkpoint, metadata, card, MANIFEST) |
| `evaluation/` | → `ml/reports/evaluation/v0.2_EXP-0.2-*/` |
| `experiment-records/` | → `ml/reports/experiments/` |
| `methodology/` | → `docs/dataset.md`, `docs/analytics-methodology.md`, `docs/research-traceability-matrix.md` |
| `architecture/` | → `docs/architecture.md`, `docs/model-architecture.md`, `docs/system-card.md` |
| `deployment/` | → `docs/deployment.md`, `docs/deployment-checklist.md`, `docker-compose.yml` |

## Key status documents
- Phase statuses: `docs/PHASE_{1..10}_STATUS.md` (5–9.1 delivered as validated pilots where noted)
- Known limitations: `docs/limitations.md`
- Manuscript revision needs: `docs/manuscript-implementation-check.md`

## The single most important handoff note

The system is complete and trustworthy; the *research dataset* is not yet
populated. Every downstream claim depends on completing acquisition,
annotation, expert review, and a final frozen dataset version.
