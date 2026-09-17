# Leaf Analyzer Workflow — End-to-End (as implemented in code)

> This document walks the **actual, current code path** from a user uploading a mulberry
> leaf photo to the four-class classification shown in the UI (healthy / leaf rust /
> leaf spot / leaf blight), including the low-confidence review flag, the saliency +
> image-evidence explanation, and the feedback loop. Every step names the file,
> function, and endpoint that implements it. It is the inference-side companion to
> `docs/model-training-workflow.md` (training side); where the code does something
> surprising or under-documented (e.g. what "confidence" really means), it is called
> out explicitly.

---

## 0. Orientation — the journey in one picture

```
Analyzer.tsx ──multipart──► POST /api/images                     apps/api/src/routes/images.ts
   (pick file)               │                                     (ingestion.ts: magic-byte gate)
                             │ Image row (source = "leaf_analyzer")
                             ▼
 uploadAndPredict ────────► POST /api/predictions { imageId }     apps/api/src/routes/predictions.ts:144
   (one user action,          │ readFile → FormData → ML /predict  (10 s timeout, response-shape check)
    two HTTP calls)           ▼
                             ml/src/api/main.py /predict           main.py:183
                               validate → preprocess → predict_tensor → apply_review_flag
                               (softmax → top-1 + full probabilities + top_k + margin)
                             ▼
                             Prediction row persisted               predictions.ts:172
                             (predictedClass + confidence + full probabilities JSON)
                             ▼
   Result UI:                201 → confidence bar, review warning,          Analyzer.tsx:268
                             all-possibilities ranked bars, disclaimer,
                             model version, history
                             ▼
 "Show visual explanation" ► POST /predictions/:id/explain          predictions.ts:222
                             │     ML /explain:                      main.py:221
                             │       C leg → saliency heatmaps (input gradients)   saliency.py
                             │       B leg → symptom measures + criteria votes      symptom_analysis.py
                             │                                                    criteria_profiles.py
                             ▼
   Saliency PNG (3-panel) + CriterionRow list (→top / →second / inconclusive)
                             ▼
 "Do you agree with this?" ► POST /predictions/:id/feedback         predictions.ts:253
                             ▼
                             Feedback row (stored for expert review — never
                             auto-applied to labels)
```

State note: the analyzer serves whatever model `ml/models/active.json` points to
(see Part 1, Stage 9). As of the Sept 1, 2026 clean slate no model is active, so
`/predict` returns `503` until a model is trained, approved, and activated.

---

## Stage 1 — Upload (client-side gate only)

**Route (UI):** `/analyzer` — `apps/web/src/App.tsx:60`; entry from the landing page
(`apps/web/src/pages/Landing.tsx:22-23`).

**UI:** `apps/web/src/pages/Analyzer.tsx`.

1. `acceptFile` (`Analyzer.tsx:100-118`) enforces the **client-side** contract before
   anything is sent:
   - file type must be `image/jpeg` or `image/png` (`ACCEPTED`, `Analyzer.tsx:5`);
   - size ≤ 20 MB (`MAX_SIZE_MB`, `Analyzer.tsx:4`, checked at `:111`);
   - a local preview via `URL.createObjectURL` (`:117`).
   These are UX-level filters only — the authoritative validation is in the ML service
   (Stage 3).
2. `analyze()` (`Analyzer.tsx:136-153`) is the "one user action, two HTTP calls"
   journey — see Stage 2.

---

## Stage 2 — Node orchestration: upload, then predict

### 2a. `POST /api/images` (persist the photo)

`apps/api/src/routes/images.ts:64-95`:

- `multer` in-memory storage, 25 MB cap (`images.ts:9`) — intentionally looser than the
  ML service's 20 MB so the boundary error surfaces at classification, not upload.
- `ingestImage` (`apps/api/src/services/ingestion.ts`) applies the same
  format/magic-byte gate as bulk ingest: non-`.jpg/.jpeg/.png` → `UNSUPPORTED_FORMAT`
  (`415`), corrupt/mislabeled → `INVALID_IMAGE_CONTENT` (`422`) (`images.ts:84-93`).
- The analyzer upload passes `source = "leaf_analyzer"` as a metadata field, stored on
  the `Image` row.

### 2b. `POST /api/predictions { imageId }`

Frontend (`apps/web/src/lib/api.ts:107-138`, `uploadAndPredict`):

1. `POST ${BASE}/images` multipart with the file + `source: "leaf_analyzer"`;
2. on success, `POST ${BASE}/predictions` with `{ imageId }`,
   `AbortSignal.timeout(30_000)` (`api.ts:127`) — the whole analyze step is bounded.

Node route (`apps/api/src/routes/predictions.ts:144-193`):

1. **Rate limit** — 30 predictions / minute / IP on an in-memory map
   (`predictions.ts:126-137`), `429` when exceeded (`:146-148`).
2. `imageId` must be present (`:150-153`) and the `Image` must exist (`:155-156`).
3. The DB's **active model** is looked up (`isActive: true`, newest first) purely to
   stamp `modelVersionId` on the prediction (`:158-161`); inference itself is done by
   whatever the ML service loaded.
4. `requestInference(image.storagePath)` (`predictions.ts:26-69`) reads the stored
   original back off disk and forwards it as a multipart `file` to
   `${ML_SERVICE_URL}/predict` with a **10 s timeout**:
   - timeout → `ML_TIMEOUT` / `504`; network/unreachable → `ML_SERVICE_UNAVAILABLE` /
     `503`; non-OK response → `503` (`:41-49`);
   - the ML response is **shape-validated before it is trusted** — `predicted_class`
     string, `confidence` number, `probabilities` object, `model_version` present,
     else `ML_INVALID_RESPONSE` / `502` (`:52-62`).
5. **Persistence** — a single `Prediction` row carries `imageId`, `modelVersionId`,
   `predictedClass`, `confidence`, and the **full probability distribution as JSON**
   (`isPlaceholder: false`) (`:171-181`). The argmax alone is never stored.
6. The `201` response (`:183-192`) returns only the application-safe surface:
   `predictionId`, `predictedClass`, `confidence`, `probabilities`,
   `reviewRecommended`, `modelVersion`, `disclaimer`. Internal ML fields
   (`top_k`, `second_class`, `margin`, `inference_ms`, `preprocessing_version`,
   `dataset_version`) are **deliberately not forwarded**; ranked display is recomputed
   client-side from `probabilities` (see Stage 4).

> All ML errors arrive at the user as app-safe messages — the UI never sees internal
> service details (`Analyzer.tsx:10-14`, `api.ts:119-136`).

---

## Stage 3 — ML inference: the classification actually happens here

`ml/src/api/main.py::predict` (`main.py:183-218`).

1. **Model availability** — `get_bundle()` (`main.py:58-71`) lazy-loads the model
   named in `ml/models/active.json` on first use and caches it in-process; if no model
   is loaded it raises `503 "model unavailable"`. Only one explicitly-identified model
   is ever served.
2. **Authoritative validation** — `validate_image_bytes` (`ml/src/inference/
   preprocessing.py:29-51`): non-empty; ≤ 20 MB; decodable (else "unreadable or corrupt
   image"); format JPEG/PNG only; 32–8000 px on each side; mode `RGB`/`RGBA`/`L`.
   A `ValueError` → `422` with the reason (`main.py:192-194`).
3. **Preprocessing must match training** — `preprocess` (`preprocessing.py:54-59`)
   reuses `build_transforms(config, train=False)` from the training pipeline
   (`ml/src/training/data.py:105-135`) — there is **exactly one** definition of
   eval-time preprocessing in the codebase (`preprocessing.py:1-6`). This yields
   deterministic Resize 224×224 → ToTensor → ImageNet normalize
   (`ml/src/config/training.json:36,39-40`), **no augmentation at inference**, input
   forced to RGB, batch dimension added. Any change here changes training-eval too — by
   design.
4. **Forward pass** — `predict_tensor` (`ml/src/inference/predictor.py:18-42`),
   deterministic and single-image:
   - `torch.no_grad()` forward → `softmax(logits[0])`;
   - `id_to_key` maps output index → class key from the checkpoint's `class_mapping`;
   - returns `probabilities` per class, `ranked` descending, `predicted_class` +
     `confidence` (rounded 4 dp), `top_k` (rank/class/probability), `second_class`,
     `margin` = top − runner-up, and `inference_ms`.
5. **Review flag** — `apply_review_flag` (`predictor.py:45-56`):
   `review_recommended = confidence < 0.50` (`LOW_CONFIDENCE_THRESHOLD`,
   `main.py:47`), with the reason string when triggered. It is a **flag**, not a
   validated decision boundary.
6. **Response** — `PredictionResponse` (`main.py:206-218`) adds `display_name` from
   `ml/src/config/classes.json` (healthy / leaf_rust / leaf_spot / leaf_blight
   + display names), `preprocessing_version = "training-config-eval-v1"`,
   `dataset_version`, `review_recommended`, and a `disclaimer`. When the metadata notes
   carry a PILOT / PIPELINE marker, the disclaimer gets a
   `" [pilot-grade model]"` suffix (`is_pilot`, `main.py:90-92`, `:205`).

> **What "confidence" means, honestly:** the displayed value is the **softmax
> probability of the predicted class**, *not* the probability the prediction is
> correct. Calibration was explicitly not established (predictor docstring
> `predictor.py:1-7`); the review threshold is configuration, not a validated
> boundary. The disclaimers exist at three layers: the FastAPI description
> (`main.py:95-103`), every `/predict` response, and the Analyzer UI scope note.

---

## Stage 4 — The result UI (Analyzer step 3)

`apps/web/src/pages/Analyzer.tsx:268-390`:

- **Confidence bar** — `(confidence * 100).toFixed(1)%`, phrased honestly as "of
  predictions for this class probability" (`:275-284`).
- **Review warning** — shown only when `reviewRecommended` (`:286-291`).
- **"All possibilities considered"** — every class's probability as a ranked bar
  (`:293-309`). The ranking is computed client-side by sorting the persisted
  `probabilities` (`:184-186`) — no second ML call, no reliance on ML `top_k`.
- **Class labels** — `labelOf` resolves class key → `display_name`
  (`:180-182`), i.e. `Mulberry Leaf Rust` etc.
- **Always-visible scope box** — "visual classification … not a laboratory diagnosis"
  plus `Model version` when present (`:191-200`).
- **History** — `GET /api/predictions?limit=10` (`api.predictionHistory`, `api.ts:104-105`;
  `predictions.ts:196-219`), newest-first, real predictions only
  (`isPlaceholder: false`).

---

## Stage 5 — "Why did the model say this?" (two independent explanations)

Triggered from the UI button → `api.explainPrediction` (`api.ts:156-182`,
30 s timeout) → `POST /predictions/:id/explain`
(`predictions.ts:222-236`; `requestExplain` shape-validates `saliency_png_base64` +
`predicted_class`, `:86-124`). The Node route re-reads the prediction's image and
forwards it to the ML service's `/explain` (`ml/src/api/main.py:221-293`).

The explanation is two **independent** legs computed from the same base prediction:

### C leg — pixel influence (what the network "looked at")

- `input_gradient_saliency(model, device, tensor, target_idx)`
  (`ml/src/inference/saliency.py:21-37`): converts the target class's **raw** score
  (pre-softmax) to a gradient w.r.t. every input pixel, pooled as mean |grad| across
  channels. Computed for the **top** class and the **runner-up** (`second_class`).
  Requires at least 2 classes (`main.py:244-247`).
- `render_explanation` (`saliency.py:40-87`) builds a 3-panel PNG — original +
  top-class saliency (inferno) + runner-up saliency (inferno) + a third
  "red = top, blue = runner-up" difference panel (coolwarm) — returned as base64
  (`main.py:289`). Rendering is wrapped so it can never take the service down
  (`main.py:263-267`).

### B leg — image-evidence criteria (deterministic, model-free)

Computed directly from the raw image — explicitly **never from the NN internals**
(`main.py:269-273`):

- `measure_symptoms(img)` (`ml/src/inference/symptom_analysis.py:110-152`) runs
  color-based heuristics (necrotic / chlorotic / pustule masks via
  `:44-90`) and returns per-image relative measurements: `necrosis_fraction`,
  `chlorosis_fraction`, `pustule_density`, `lesion_count`,
  `largest_component_share`, `chlorotic_component_count`, `margin_involvement`,
  `leaf_green_fraction`, `leaf_area_px` — all relative to leaf area (not absolute),
  to survive lighting variation (`:9-11`).
- `evaluate_criteria(metrics, top, second)` (`ml/src/inference/criteria_profiles.py:
  103-139`) decides, per visible signal, which candidate it *supports* using the
  relative thresholds in `_M` (`:22-46`): overall greenness handles the
  healthy-inclusive pair (`:79-100`); rust/spot/blight share spread (coalesced vs
  discrete, `_append_spread` `:142-168`), margin involvement (`:171-189`), necrotic
  extent (`:192-216`) and chlorotic halo (`:219-235`) rules. Each criterion carries
  `supports ∈ {top, second, inconclusive}` plus `supports_class`.
- Both legs are wrapped in `try/except`; if explainability fails, the response carries
  `measurements = {}` and `criteria = []` rather than an error
  (`main.py:271-278`).

### UI rendering

`Analyzer.tsx:311-355`: the PNG is shown with an honest caption — heatmaps "measure
influence, not a diagnosis or a precise region of symptoms" (`:333-340`); each
`CriterionRow` (`Analyzer.tsx:33-68`) shows label, measured value + unit, a
`→ <class>` badge (emerald for top, sky for runner-up, gray "Inconclusive" when
neutral) and the signal's description. Terminology is hypothesis-checking
("evidence consistent with X is present"), not "the model reasoned X"
(`criteria_profiles.py:8-11`).

---

## Stage 6 — Feedback (the loop, not automatic ground truth)

**UI:** "Do you agree with this classification?" → Yes / No / Unsure + optional comment
(`Analyzer.tsx:357-386`).

**Flow:** `sendFeedback(verdict, correctedClass?)` (`Analyzer.tsx:168-178`) →
`api.sendFeedback` (`api.ts:140-154`) → `POST /predictions/:id/feedback`
(`predictions.ts:253-281`):

1. `verdict` must be `agree | disagree | unsure` (`:255-257`); prediction must exist
   (`:259-262`).
2. One `Feedback` row per prediction — **upserted** (`:264-279`) with
   `isCorrect = true/false/null`, `correctedClass`, `comment`.
3. Feedback is **stored for future expert review (Phase 9.1)** and never automatically
   becomes ground truth — the UI itself states "it does not automatically change any
   dataset labels" (`Analyzer.tsx:381-383`), and `GET /predictions/:id` is the only way
   it resurfaces (`predictions.ts:239-246`, includes `feedback` + `modelVersion`).

---

## Reference map (file → stage)

| Stage | Location |
|---|---|
| Analyzer UI (upload / result / explanation / feedback) | `apps/web/src/pages/Analyzer.tsx`, `apps/web/src/App.tsx:60` |
| API client helpers | `apps/web/src/lib/api.ts` (`uploadAndPredict`:107, `sendFeedback`:140, `explainPrediction`:156) |
| Image upload + persistence | `apps/api/src/routes/images.ts:64`, `apps/api/src/services/ingestion.ts` |
| Prediction orchestration + persistence + history | `apps/api/src/routes/predictions.ts:144` (POST /), `:196` (GET /), `:239` (GET /:id) |
| Explain proxy | `apps/api/src/routes/predictions.ts:222`, `:86` (`requestExplain`) |
| Feedback persistence | `apps/api/src/routes/predictions.ts:253` |
| ML predict endpoint | `ml/src/api/main.py:183` |
| Input validation | `ml/src/inference/preprocessing.py` (`validate_image_bytes`:29, `preprocess`:54) |
| Forward pass / postprocess | `ml/src/inference/predictor.py` (`predict_tensor`:18, `apply_review_flag`:45) |
| Model serving (active.json) | `ml/src/inference/model_loader.py`, activation `ml/src/api/main.py:114` |
| Saliency explanation (C leg) | `ml/src/inference/saliency.py` |
| Symptom + criteria explanation (B leg) | `ml/src/inference/symptom_analysis.py`, `ml/src/inference/criteria_profiles.py` |
| Config | `ml/src/config/training.json` (preprocessing), `classes.json` (taxonomy + display names) |

---

## Honest caveats (as true in the code today)

- **Confidence is not correctness.** It is the predicted-class softmax probability;
  calibration is explicitly out of scope (`predictor.py:1-7`, `main.py:95-103`). The
  `0.50` review flag is configuration, not a validated boundary (`main.py:47`).
- **No model → no predictions.** `/predict` and `/explain` return `503` when no model
  is loaded. As of the Sept 1, 2026 clean slate the ML service is `unhealthy`
  (`model_loaded: false`) — the analyzer cannot classify until a model is trained,
  approved, and activated (see `docs/model-training-workflow.md`).
- **Startup warm-up is a synthetic fixture.** `warm_up` (`main.py:74-82`) runs an
  all-zero tensor to verify wiring; it is never presented as a real prediction.
- **Pilot discipline is preserved.** Serving a PILOT / pipeline-validation model
  appends `" [pilot-grade model]"` to the disclaimer (`main.py:90-92, 205`).
- **The UI is intentionally thin on internals.** Internal ML fields
  (`top_k`, `second_class`, `margin`, `inference_ms`) are not forwarded to the UI;
  ranked bars are recomputed client-side from persisted probabilities. This keeps the
  API boundary stable and the stored truth (full probability distribution) complete.
- **Explanation ≠ diagnosis.** Both legs (saliency gradients, image-evidence
  thresholds) are heuristics phrased as influence/evidence; neither is a segmentation
  nor a biological determination (`saliency.py:1-9`, `symptom_analysis.py:9-11`).
- **Feedback never mutates the dataset.** It is stored for expert review; the only way
  labels change is the human annotation/review pipeline (Part 1, Stages 2–3).