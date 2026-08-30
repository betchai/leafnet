# LEAFNET — Test Plan

## Summary

| Metric | Count |
|---|---|
| Test framework | Vitest (API) + pytest (ML) |
| API test files | 5 |
| API test cases | 39 |
| ML test files | — |
| ML test cases | 59 |
| Total test cases | 98 |

## API Tests (Vitest)

| File | Count | What it tests |
|---|---|---|
| `domain/workflow.test.ts` | 12 | Annotation state machine (transitions, role enforcement, terminal states) |
| `domain/lifecycle.test.ts` | 13 | Model lifecycle (experimental→evaluated→candidate→approved→active→retired) + feedback review workflow |
| `domain/composition.test.ts` | 5 | Dataset balance computation (status counts, fixture exclusion, imbalance detection) |
| `domain/taxonomy.test.ts` | 4 | 4-class taxonomy enforcement (valid/invalid keys, config drift) |
| `services/ingestion.test.ts` | 5 | Image ingestion (magic-byte validation, dedup, checksum, naming) |

### workflow.test.ts (12 tests)

- expert confirm on annotated image -> APPROVED
- expert relabel -> EXPERT_REVIEWED with new label
- annotator role is forbidden from review actions
- system role can never drive transitions (AI cannot create ground truth)
- cannot approve without a preliminary label
- relabel requires a label
- APPROVED is terminal
- REJECTED is terminal
- uncertain images may be relabeled by an expert but never auto-approved
- mark_uncertain allowed from early states
- second opinion routes back for more review, not approval
- preliminary annotation only from pre-annotation states

### lifecycle.test.ts (13 tests)

- allows experimental -> evaluated
- allows evaluated -> candidate
- allows candidate -> approved
- allows approved -> active
- allows active -> retired
- refuses skipping stages (experimental -> active)
- only approved models can become active
- retired is terminal
- start_review moves SUBMITTED -> UNDER_REVIEW
- verify requires a class label
- verify with label -> VERIFIED
- annotator role cannot review feedback
- reject allowed from submitted; verified is terminal for review actions

### composition.test.ts (5 tests)

- reports honest zeros on an empty dataset
- counts statuses correctly
- dev fixtures are NEVER counted as research data
- tracks per-class lifecycle counts
- flags imbalance without suggesting duplication

### taxonomy.test.ts (4 tests)

- loads exactly the four approved classes
- accepts each approved class key
- rejects arbitrary / legacy class names
- config file has not drifted from the approved taxonomy

### ingestion.test.ts (5 tests)

- produces identical sha256 for identical content
- rejects unsupported formats before any persistence
- accepts jpg/jpeg/png with valid image bytes
- generates unique stored names so originals are never overwritten
- flags exact duplicates and dev fixtures into NEEDS_REVIEW

## Running Tests

```bash
# API tests (from repo root)
cd apps/api && npm run test

# API tests with verbose output
cd apps/api && npx vitest run --reporter=verbose

# ML tests
cd ml && python -m pytest tests/ -v
```
