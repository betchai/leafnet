# Continuous Learning (design — human-gated)

The approved improvement loop; nothing automatic:

```
Prediction → User Feedback → Expert Review → Verified Label
    → Candidate Training Data → NEW Dataset Version (explicit cut)
    → Training Experiment → Formal Evaluation (Phase 6 pipeline)
    → Regression Comparison → Approval → Activation → Monitoring
```

Hard prohibitions: no automatic relabeling, no automatic retraining,
no automatic deployment, no accuracy claims from unverified feedback.

Mechanics already implemented: verified feedback labels update image
Classifications and appear in `/api/tools/candidates`; cutting a dataset version
includes them; Pipeline Runner retrains on that version.
