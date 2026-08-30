# Phase 9.1 Status — Feedback, Monitoring & Continuous Model Improvement

**Date:** 2026-08-24
**Boundary held:** no automatic relabeling, retraining, or deployment anywhere in the implementation.

---

## 1. Objective
Controlled mechanism for feedback collection, expert review, candidate training data, monitoring, and model lifecycle governance — preserving research integrity end-to-end.

## 2. Feedback architecture
`Prediction → User Feedback (agree/disagree/unsure + suggested class from approved taxonomy + comment) → Review Queue → Expert actions → VERIFIED label = candidate training data`
Original predictions are immutable; verified labels update image Classification via audited review.

## 3. Ground-truth protection
- User suggestions stored as `correctedClass`; only expert `verify`/`verify_corrected` produces a `verifiedClass`
- Verified labels are CANDIDATE data — they enter a dataset version only through explicit cut
- Enforced by `domain/lifecycle.ts` (roles, transitions) and validated server-side

## 4. Monitoring (`GET /api/tools/monitoring/summary`)
Prediction volume · avg confidence · low-confidence % · feedback/disagreement rates · review backlog · per-model breakdown (volume, confidence, class distribution, verified corrections) · real-world confusion pairs from VERIFIED corrections · verified accuracy over expert-verified cases only ("baseline being established" shown otherwise).

## 5. Model lifecycle
`experimental → evaluated → candidate → approved → active → retired`, invalid transitions rejected 409, only approved→active allowed (auto-deactivates others), retired is terminal, every transition audited.

## 6–7. Dataset improvement & versioning
Verified feedback → Classification update (audited) → appears in `/api/tools/candidates` → included when researcher cuts next version (vX+1) with composition snapshot. Historical versions remain immutable (many-to-many membership).

## 8. Model improvement
Future loop: cut version → Pipeline Runner trains candidates → Phase-6 evaluation pipeline → regression comparison → human promotion via lifecycle endpoint. All machinery exists and is proven.

## 9. Rollback
Activating a previous approved model restores service to it; historical predictions keep their original modelVersion links — never rewritten.

## 10. Audit trail
Two layers: AnnotationAudit (label lineage) + SystemAudit (model/dataset governance: actor, action, object, previous/new state, reason).

## 11. Security/privacy
Expert/admin role checks on all review endpoints · taxonomy validation on suggested classes · anonymous feedback supported (no user identity required) · rate limiting retained · no raw images or internal URLs logged.

## 12. Testing
13 new vitest domain tests (lifecycle transitions incl. skip/terminal refusal, activation guard, review workflow roles/transitions/terminal states) — 39 API tests total pass; full cycle live-verified (feedback → start_review → verify_corrected → candidates list → monitoring summary showing verified confusion pair).

## 13. Monitoring limitations
With near-zero production usage: drift detection, confidence-distribution shift, and threshold validation cannot be measured yet — "baseline being established" is displayed honestly. Real-world confusion pairs populate automatically once verified corrections accumulate.

## 14. Phase 10 readiness: READY WITH CONDITIONS
Application, inference layer, monitoring, and governance are complete. Conditions: (1) dataset completion remains critical path for any defensible model; (2) authentication/roles required before any deployment beyond local use; (3) alert thresholds need a real usage baseline.

**Stopping here per boundary.**
