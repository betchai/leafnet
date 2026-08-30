# Manuscript ↔ Implementation Check

Handoff artifact for the student. The manuscript should NOT be silently
rewritten — use this table to locate sections needing revision.

## Discrepancy table

| # | Manuscript statement (typical) | Actual implementation | Status | Recommended action |
|---|---|---|---|---|
| 1 | Classification of four leaf conditions | ✅ matches (`classes.json`) | Aligned | none |
| 2 | 2,000-image dataset, 500/class | Only 11 approved images at handoff; targets configured but unmet | **Discrepancy** | Either complete acquisition before submission OR revise manuscript to describe target vs achieved counts honestly |
| 3 | 80/10/10 partition | Splitter implements it; pilot runs used a documented image-level fallback | Partially aligned | Describe grouped-split method + pilot fallback as limitation if pilot numbers are cited |
| 4 | Streamlit used for the application | Production app is React+Tailwind frontend, Node.js API, Python FastAPI ML service; no Streamlit exists | **Discrepancy** | Revise the manuscript's "System Implementation" section; recommended wording below |
| 5 | MobileNetV2 with ImageNet transfer learning | Matches exactly (torchvision IMAGENET1K_V2, new 4-class head) | Aligned | cite Sandler et al. 2018 + weight version |
| 6 | Preprocessing 224×224, normalization | Matches (shared code path training/inference) | Aligned | none |
| 7 | Augmentation (flip/rotation/jitter) | Matches config; train-only | Aligned | include exact settings + rationales from training.json |
| 8 | Accuracy/Precision/Recall/F1/Confusion matrix | All computed by formal pipeline | Aligned (method) | report only post-full-dataset numbers |
| 9 | Database/backend technology | PostgreSQL + Prisma ORM + Express REST API | Likely needs update | state the actual stack explicitly |
| 10 | Confidence interpretation | Softmax predicted-class probability; NOT calibrated | Add to manuscript | add limitation paragraph |

## Recommended wording for item 4 (system implementation)

> "The LEAFNET system was implemented as a three-tier web application: a
> TypeScript React frontend for user interaction, a Node.js (Express) REST API
> for orchestration and persistence via PostgreSQL through the Prisma ORM, and
> an independent Python FastAPI microservice hosting the trained MobileNetV2
> model for inference. The Node.js API communicates with the Python service
> over HTTP, preserving separation between application logic and machine-
> learning execution."

## Also flag

- Pilot experiments (EXP-001…0.2-FT) were run on an 11-image dataset purely to
  validate the pipeline — do not cite their metrics as results.
- Phase-6 verdict at handoff: NOT READY for performance claims.
