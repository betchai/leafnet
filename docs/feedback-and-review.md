# Feedback & Review

## How user feedback works
After each analysis, users answer: **Yes / No / Unsure** ("Do you agree?"),
optionally suggesting one of the four approved classes and a comment.

- Stored as a `Feedback` row linked to the `Prediction` (which links Image + ModelVersion)
- The original prediction is NEVER altered
- A user suggestion is **not** ground truth — it enters the review queue as SUBMITTED

## How expert verification works
Researchers use Tools → Feedback Review:
```
SUBMITTED → UNDER_REVIEW → VERIFIED | REJECTED   (+ NEEDS_REVIEW for uncertain)
Actions: Start review · Verify · Verify corrected · Mark uncertain · Reject
```
Only expert/admin roles can act. Verified labels update the image's
Classification and are recorded in both audit trails (AnnotationAudit +
SystemAudit). Verified images appear under **candidate training data**
(`GET /api/tools/candidates`) and enter a dataset version only via an explicit
cut by an authorized researcher.
