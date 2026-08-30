# System Limitations

Honest, current limitations of LEAFNET at handoff. Do not minimize or omit
these in the thesis.

## Data
- **Dataset scale:** 11 approved images vs the 2,000-image target. All model
  metrics to date are pilot-scale and statistically meaningless.
- **Geographic coverage:** two farms only; no claim of generalizability beyond them.
- **Cultivar/variety metadata:** largely uncollected; cultivar shortcut risk unmeasurable.
- **Class ambiguity:** leaf_spot ↔ leaf_blight boundary is scientifically ambiguous
  (documented since Phase 2); some label noise is irreducible without expert adjudication.
- **Severity, lighting, cultivar metadata** mostly uncollected → conditional
  performance analyses unavailable.

## Model
- **Confidence is not calibrated.** Softmax probability ≠ probability of correctness.
- Pilot models were trained with an image-level split fallback (grouping keys
  existed but groups were too few); real runs must use grouped splitting.
- Single learning-rate group during fine-tuning (head lr applied to backbone);
  param-group separation recommended before final training.

## Application / deployment
- **No authentication** — acceptable for single-researcher local use; required
  before any public deployment (Tools pages are unprotected by design locally).
- In-memory rate limiter resets on restart; no distributed limiting.
- Single-process ML service; no horizontal scaling configuration.
- Alert thresholds for monitoring show "baseline being established" — no
  validated alerting until production usage data exists.
- Frontend component tests not implemented (typecheck + scripted E2E cover it).

## Environment
- Validated on macOS CPU (PyTorch 2.13); GPU path supported but untested on hardware.
- Python 3.14 venv used locally; Docker image targets 3.12 — verify torch wheels
  when building containers.
