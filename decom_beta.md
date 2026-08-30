# Decommission the BETA model version

Context: LEAFNET project. A beta prototype exists from before the full
dataset was ready:
- ml/models/v0.2_EXP-001/ and v0.2_EXP-002/ (checkpoints, 11-image pilot)
- ml/models/MODEL_CARDS_PILOT.md
- ModelVersion rows v0.2_EXP-001 (isActive=true) and v0.2_EXP-002
- ml/data/prepared/*_PILOT* split manifests
- reports/experiments/EXP-001..002
- Possibly stray smoke-test images ingested with source=beta_chain_test /
  source=analyzer_beta / tools_smoke

Task — remove the BETA ARTIFACTS but PRESERVE permanent infrastructure:

DELETE:
1. The directories/files listed above (after confirming no real data is among them —
   check Image.source and Image.isDevFixture first; ask me before deleting anything
   that might be real research data).
2. Deactivate/delete the two beta ModelVersion rows.
3. Any Prediction rows referencing those ModelVersions (they are demo predictions).

DO NOT DELETE (permanent infrastructure reused by Phases 6–10):
- ml/src/inference/service.py (Phase 8 reuses it; just repoint MODEL_PATH)
- the "// BETA-MODEL" HTTP boundary block in apps/api/src/routes/predictions.ts
- the wired Leaf Analyzer UI (apps/web/src/pages/Analyzer.tsx)
- ml/src/training/, ml/src/config/training.json, evaluation stub
- the Feedback table and any REAL user feedback rows

BEFORE deleting, verify and report to me:
- which approved images exist and whether any are real research data
- whether the active ModelVersion is still a beta (if a real model has since
  been trained and activated, only deactivate the beta, never the real one)

After deletion, verify: Leaf Analyzer gracefully shows the honest
"no model available" state; npm/vitest/pytest suites pass.
