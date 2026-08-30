# Phase 10 Status — Final Hardening, Deployment & Research Handoff

**Date:** 2026-08-24
**Nature:** hardening/audit/handoff — no model changes, no dataset changes, no taxonomy changes.

---

## 1. Final system architecture
React + TypeScript + Tailwind → Node.js (Express) REST API → { PostgreSQL via Prisma | Python FastAPI ML service → PyTorch MobileNetV2 }.
Boundaries preserved: frontend never reaches Python; Python never writes the database.

## 2. Final model
`v0.2_EXP-0.2-B` — **PILOT**, frozen with MANIFEST.json (sha256 `a6e8c1ad51ce1cc2…`).
Phase 6 verdict stands: NOT READY for performance claims. The frozen artifact
exists to verify serving integrity, not as a research result.

## 3. Final dataset
v0.2 — 11 approved research images (healthy 2 / rust 3 / spot 3 / blight 3).
Frozen via immutable version membership; dev fixtures isolated. **Target of
2,000 remains unmet — this is the project's dominant open item.**

## 4. Evaluation
Official Phase-6 results unchanged and preserved: accuracy/macro-F1 0.0 at test
n=1, statistically meaningless by explicit warning. No new results generated.

## 5. Application
Complete user journey live: upload (drag-drop, validation) → analyze → prediction
with confidence + full distribution → low-confidence review flag → feedback
(agree/disagree/unsure) → recent-analyses list. Functional Dashboard, Dataset
browser, Models registry, Insights dashboard.

## 6. Feedback & monitoring
Phase 9.1 delivered: expert review queue, candidate training data registry,
model lifecycle governance (experimental→…→retired), SystemAudit trail,
monitoring summary API ("baseline being established" honesty).

## 7. Security
helmet() headers · explicit CORS allow-list (`WEB_ORIGIN`) · magic-byte image
validation at ingest · upload size/type limits · rate limiting · safe generated
filenames · central error handler (no stack traces) · unhandledRejection/
uncaughtException safety nets · no secrets in code (scan clean) · ML service has
no arbitrary model loading or filesystem access.

## 8. Performance (local, CPU)
Warm inference ~18–26 ms · end-to-end predict ~40–80 ms · cold model load ~1–2 s.
Single-node measurements only — no scalability claims.

## 9. Deployment
Docker Compose provided (db + api + ml), production Dockerfiles for API/ML,
frontend build served behind reverse proxy. Full guide: `docs/deployment.md`.
Backup: pg_dump + uploads/ + ml/models/.

## 10–11. Reproducibility & testing
Reproducibility chain documented (`docs/reproducibility.md`). Final suites:
**55 pytest + 39 vitest pass**; typechecks clean on both workspaces; web
production build succeeds; fresh-restart E2E verified including failure recovery
(ML-down → honest 503; corrupt image → 422; server survives errors).

## 12. Known limitations
See `docs/limitations.md`. Headlines: dataset scale (11/2,000); no auth;
uncalibrated confidence; single-node serving; metadata-based analytics dormant.

## 13. Manuscript discrepancies
Documented in `docs/manuscript-implementation-check.md`. Headline item:
manuscript references Streamlit while the actual implementation is React +
Node.js + Python FastAPI — recommended replacement wording provided.

## 14. Recommended student actions
1. Complete image acquisition/annotation/expert review (critical path).
2. Revise manuscript §implementation per the discrepancy table.
3. Re-train + re-run Phase-6 evaluation on the completed dataset; replace pilot artifacts/cards.
4. Add authentication before any multi-user deployment.
5. Update the final model card from real Phase-6 results when available.

## 15. Final readiness: READY FOR RESEARCH USE (WITH CONDITIONS)

The LEAFNET *system* is complete, tested, documented, deployable, and honest.
The *research results* are not yet defensible because the dataset is not yet
populated — a fact every layer of the system states openly. Once the dataset is
complete and re-evaluated, the same pipelines produce thesis-grade evidence.

---

**End of the current implementation roadmap.**
