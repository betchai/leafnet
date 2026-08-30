# Model Lifecycle

States: `experimental → evaluated → candidate → approved → active → retired`
(enforced by `apps/api/src/domain/lifecycle.ts`; invalid transitions rejected 409).

- Only APPROVED models can become ACTIVE (activating one deactivates others)
- Retired is terminal; rollback = explicitly activating a previous approved model
- Every transition requires actor + reason, recorded in SystemAudit
- Historical predictions always retain the model version that produced them

Endpoints: `PATCH /api/tools/models/:id/lifecycle` · candidates: `POST /api/tools/models/:id/register` (Phase 7 pattern).
