# Model Monitoring

Signals computed from real application data (`GET /api/tools/monitoring/summary`):

| Signal | Definition |
|---|---|
| Prediction volume | non-placeholder predictions |
| Avg confidence | mean softmax of predicted class |
| Low-confidence rate | % below configurable threshold (0.5) |
| Feedback rate | % predictions receiving feedback |
| Disagreement rate | % of feedback that was "disagree" |
| Review backlog | SUBMITTED feedback count |
| Verified accuracy | accuracy over EXPERT-VERIFIED cases only |
| Real-world confusion pairs | verified corrections grouped predicted→verified |
| Per-model breakdown | all above grouped by model version |

Rules: never call unverified rates "accuracy" · no alert thresholds claimed as
validated ("baseline being established") · research metrics and application
metrics reported separately.
