# LEAFNET — Test Results

**Run date:** August 26, 2026
**Framework:** Vitest v4.1.11
**Duration:** 175ms (transform 164ms, setup 22ms, tests 22ms, environment 18ms)

## Summary

| Metric | Result |
|---|---|
| Test files | 5 passed (5) |
| Tests | 39 passed (39) |
| Failed | 0 |
| Skipped | 0 |

## Results

```
 RUN  v4.1.11 /Users/betchai/Developer/learning/leafnet/apps/api

 ✓ src/domain/taxonomy.test.ts > taxonomy enforcement > loads exactly the four approved classes 2ms
 ✓ src/domain/taxonomy.test.ts > taxonomy enforcement > accepts each approved class key 0ms
 ✓ src/domain/taxonomy.test.ts > taxonomy enforcement > rejects arbitrary / legacy class names 0ms
 ✓ src/domain/taxonomy.test.ts > taxonomy enforcement > config file has not drifted from the approved taxonomy 0ms
 ✓ src/domain/workflow.test.ts > annotation workflow state machine > expert confirm on annotated image -> APPROVED 1ms
 ✓ src/domain/workflow.test.ts > annotation workflow state machine > expert relabel -> EXPERT_REVIEWED with new label 0ms
 ✓ src/domain/workflow.test.ts > annotation workflow state machine > annotator role is forbidden from review actions 1ms
 ✓ src/domain/workflow.test.ts > annotation workflow state machine > system role can never drive transitions (AI cannot create ground truth) 0ms
 ✓ src/domain/workflow.test.ts > annotation workflow state machine > cannot approve without a preliminary label 0ms
 ✓ src/domain/workflow.test.ts > annotation workflow state machine > relabel requires a label 0ms
 ✓ src/domain/workflow.test.ts > annotation workflow state machine > APPROVED is terminal 0ms
 ✓ src/domain/workflow.test.ts > annotation workflow state machine > REJECTED is terminal 0ms
 ✓ src/domain/workflow.test.ts > annotation workflow state machine > uncertain images may be relabeled by an expert but never auto-approved 1ms
 ✓ src/domain/workflow.test.ts > annotation workflow state machine > mark_uncertain allowed from early states 0ms
 ✓ src/domain/workflow.test.ts > annotation workflow state machine > second opinion routes back for more review, not approval 0ms
 ✓ src/domain/workflow.test.ts > annotation workflow state machine > preliminary annotation only from pre-annotation states 0ms
 ✓ src/domain/composition.test.ts > dataset composition tracking > reports honest zeros on an empty dataset 1ms
 ✓ src/domain/composition.test.ts > dataset composition tracking > counts statuses correctly 0ms
 ✓ src/domain/composition.test.ts > dataset composition tracking > dev fixtures are NEVER counted as research data 0ms
 ✓ src/domain/composition.test.ts > dataset composition tracking > tracks per-class lifecycle counts 1ms
 ✓ src/domain/composition.test.ts > dataset composition tracking > flags imbalance without suggesting duplication 0ms
 ✓ src/domain/lifecycle.test.ts > model lifecycle > allows experimental -> evaluated 2ms
 ✓ src/domain/lifecycle.test.ts > model lifecycle > allows evaluated -> candidate 0ms
 ✓ src/domain/lifecycle.test.ts > model lifecycle > allows candidate -> approved 0ms
 ✓ src/domain/lifecycle.test.ts > model lifecycle > allows approved -> active 0ms
 ✓ src/domain/lifecycle.test.ts > model lifecycle > allows active -> retired 0ms
 ✓ src/domain/lifecycle.test.ts > model lifecycle > refuses skipping stages (experimental -> active) 0ms
 ✓ src/domain/lifecycle.test.ts > model lifecycle > only approved models can become active 0ms
 ✓ src/domain/lifecycle.test.ts > model lifecycle > retired is terminal 0ms
 ✓ src/domain/lifecycle.test.ts > feedback review workflow > start_review moves SUBMITTED -> UNDER_REVIEW 0ms
 ✓ src/domain/lifecycle.test.ts > feedback review workflow > verify requires a class label 0ms
 ✓ src/domain/lifecycle.test.ts > feedback review workflow > verify with label -> VERIFIED 0ms
 ✓ src/domain/lifecycle.test.ts > feedback review workflow > annotator role cannot review feedback 0ms
 ✓ src/domain/lifecycle.test.ts > feedback review workflow > reject allowed from submitted; verified is terminal for review actions 0ms
 ✓ src/services/ingestion.test.ts > checksum generation > produces identical sha256 for identical content 3ms
 ✓ src/services/ingestion.test.ts > ingest preparation > rejects unsupported formats before any persistence 0ms
 ✓ src/services/ingestion.test.ts > ingest preparation > accepts jpg/jpeg/png with valid image bytes 0ms
 ✓ src/services/ingestion.test.ts > ingest preparation > generates unique stored names so originals are never overwritten 0ms
 ✓ src/services/ingestion.test.ts > ingest preparation > flags exact duplicates and dev fixtures into NEEDS_REVIEW 0ms

 Test Files  5 passed (5)
      Tests  39 passed (39)
   Start at  08:48:56
   Duration  175ms (transform 164ms, setup 22ms, tests 22ms, environment 18ms)
```
