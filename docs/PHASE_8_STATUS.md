# Phase 8 Status — LEAFNET Application Integration & UX

**Date:** 2026-08-24
**Mode:** Production integration built against the PILOT model (same honesty rules as Phases 5–7).

---

## 1. Objective
Connect the Phase-7 inference service to the React app via Node.js, and complete the user journey: upload → analyze → prediction → probabilities → feedback, with persistence, error handling, responsive UI.

## 2. Architecture (unchanged boundary)
```
React (apps/web) → Node API (apps/api) → Python FastAPI (ml/src/api) → MobileNetV2
                                        └ Prisma → PostgreSQL
```
Frontend never bypasses Node; ML responses are validated server-side before reaching the browser.

## 3. User workflow implemented
Upload (drag&drop/browse) → preview (replace/remove) → Analyze → loading state →
prediction card (primary class, confidence bar, ranked 4-class distribution,
low-confidence warning) → feedback (Yes/No/Unsure + comment) → recent-analyses list.
Scope disclaimer permanently visible; image-quality guidance shown pre-upload.

## 4. Pages completed
- **Dashboard** — live: approved/acquired counts, active model, feedback count, duplicate flags, classes, recent predictions. Honest zeros when empty.
- **Leaf Analyzer** — full journey incl. drag-drop, validation messages, a11y (aria-live, roles, focus states)
- **Dataset** — browser with class/status filters (research images only)
- **Models** — registry with dataset version, training date, test metrics, Active/Pilot status badges; promotion deliberately not exposed
- **Tools section** — Bulk Ingest, Labeling, Expert Review, Dataset Status, Pipeline Runner, Phase-2 Validator (from earlier phases)

## 5–7. API / ML / DB integration
- All endpoints from the Phase-1 list live: health, classes, images (+GET history), predictions (+GET), predictions/:id/feedback, models, datasets + datasets/status + tools endpoints
- ML contract per `docs/ml-api.md`: multipart forward, **10s timeout**, response-shape validation before trust, mapped error statuses (503 unavailable / 504 timeout / 502 invalid)
- Persistence: Prediction rows carry predictedClass, confidence, **full probability distribution (JSON)**, ModelVersion link, timestamp; Feedback supports **agree/disagree/unsure** (`verdict`, nullable `isCorrect`) + correctedClass + comment

## 8. Security
Rate limiting (30/min/IP on predictions) · MIME/size/dimension validation · safe generated filenames · no internal paths or service URLs in client responses · request-ID logging without image data · CORS unchanged · no auth complexity added (single-researcher tool).

## 9. Testing
- **Backend:** 26 vitest (Phase 1–6 regression) ✅ · typecheck clean
- **Python:** 47 pytest (service layer) ✅
- **Live E2E (scripted):** upload → predict (probabilities persisted) → history → feedback "unsure" → invalid-verdict rejection → all verified against running services
- Frontend component tests: deferred — covered by strict TypeScript + scripted E2E; noted as limitation

## 10. Performance (measured, local)
Upload+predict end-to-end ≈ 40–80 ms typical; ML inference ~18–26 ms of that; DB writes negligible. No bottlenecks at research scale.

## 11–12. Known limitations & UI surfaces
- Serving pilot-grade predictions until a real candidate is promoted (disclaimed everywhere)
- No authentication/roles yet — Tools pages are open locally; required before any deployment
- Rate limiter is in-memory (resets on restart)
- Frontend unit-test suite not yet set up

## 13. Phase 9.1 handoff ready (Feedback, Monitoring & Continuous Learning — renumbered)
Feedback table now stores verdicts (incl. unsure) with comments, linked to predictions/model versions — exactly the input Phase 9.1's review→verify→dataset-promotion workflow needs. Dashboard exposes feedbackCount for monitoring. Continuous learning itself remains unimplemented per boundary.

**Stopping here per phase boundary.** No retraining, no taxonomy change, no automatic ground-truth mutation, no fabricated data.
