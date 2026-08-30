# Phase 2 Status — Dataset Engineering & Classification Taxonomy

**Date:** 2026-08-23
**Phase:** 2 — Mulberry Leaf Dataset Engineering & Classification Taxonomy
**Model training performed in this phase:** **NONE** (per phase constraints)

---

## 1. Scientific class definitions (research findings)

### Healthy
Uniform green coloration appropriate to leaf age; no necrotic spots, pustules,
chlorotic halos, or lesions. Expert-annotated mulberry datasets establish
"disease-free" as a distinct expert-verifiable category.
**Confidence: high.**

### Leaf Rust (`leaf_rust`)
Caused by rust fungi — principally *Cerotelium fici*; also *Peridiopsora mori*
/ *Aecidium mori* (recombined as *Gymnosporangium mori*, Mycoscience 2024).
Visual signature: pinhead circular brown/black spots developing into raised
powdery pustules (~0.5–1 mm, light brown/yellowish-orange spore masses with
yellowish halos), frequently abaxial; leaves yellow and wither prematurely.
Sources: Mordue 1991 (CAB Descriptions of Fungi and Bacteria); Baiyewu et al.
2005 (Pak. J. Plant Pathol.); Gonçalves et al. 2022 (Plant Disease); Dev Maji
2011; Kasuya et al. 2024. **Confidence: high.**

### Leaf Spot (`leaf_spot`)
Symptom-based grouping of diverse fungal pathogens (*Cercospora moricola*,
*Pseudocercospora mori*, *Mycosphaerella mori*/Phloeospora maculans,
*Bipolaris sorokiniana*, *Curvularia lunata*, etc.). Visual signature: flat,
discrete necrotic spots from small dark dots to ~1 cm dry lesions with pale
centers and chlorotic halos; vein-limited angular spots in some pathogens;
coalescence and grey mold-like patches in severe cases.
Sources: Arunakumar et al. 2023 (PMC10665727); Frontiers 2025 (Pseudocercospora
mori); Soylu et al. 2003; Florida DPI Circular 329. **Confidence: medium-high**
(symptom grouping of multiple causal agents is an inherent limitation).

### Leaf Blight (`leaf_blight`)
Extensive, rapidly spreading tissue death — large irregular necrotic areas
from tips/margins; water-soaked margins characteristic of bacterial blight
(*Pseudomonas syringae* pv. *mori*). Sources: Texas A&M Plant Disease Handbook;
J-Stage 2014 "Mulberry Diseases and Their Control"; coalescing-lesion evidence
in PMC10665727. **Confidence: medium** — see flagged risk below.

### ⚠️ Flagged research risk (documented, not silently resolved)
The literature does not provide a crisp visual boundary between severe
(coalesced) leaf spot and leaf blight on mulberry — PMC10665727 explicitly
describes spot lesions producing a "blightened appearance". Boundary cases are
routed to expert review / uncertain status by design. The approved taxonomy was
NOT changed.

## 2. Taxonomy confirmation
Implemented taxonomy = exactly the four approved classes:
`healthy`, `leaf_rust`, `leaf_spot`, `leaf_blight`. Single-label, four-class.
No extra disease classes; the previous Phase-1 placeholder classes were fully
removed from config.

## 3. Classification strategy confirmed
Four-class, single-label visual classification only. Explicit distinction
between visual classification ("visual classification suggests…") and
biological diagnosis enforced across schema (AI predictions can never become
annotations), docs, and planned UI language.

## 4. Dataset specification confirmed
2,000 total images = complete dataset: healthy 500 · leaf_rust 500 ·
leaf_spot 500 · leaf_blight 500. Encoded in `ml/src/config/pipeline.json`
(`datasetTargets`) and reported against in tooling.

## 5. Dataset partition confirmed
Train 1,600 (80%) / Validation 200 (10%) / Test 200 (10%). Encoded in
pipeline.json `splitRatios`; group-aware splitter targets these counts.

## 6. Annotation strategy
Workflow states: UNLABELED → NEEDS_REVIEW → ANNOTATED → EXPERT_REVIEWED →
APPROVED (+ REJECTED / SECOND_OPINION / UNCERTAIN). Preliminary labels stored
as `Annotation(stage=PRELIMINARY)` with annotator/timestamp/confidence;
ground truth requires expert review (`FINAL_VERIFIED`) before a
`Classification` row may be treated as confirmed. AI output lives only in
`Prediction` rows. Uncertain images never forced into a class.
Schema: Prisma models + [docs/annotation-schema.md](docs/annotation-schema.md).

## 7. Dataset quality strategy
- **Validation:** `ml/src/data/validation.py` — readable/format/dimensions/
  color-mode/corruption checks with acceptable/questionable/rejected verdicts.
- **Duplicates:** `ml/src/data/deduplication.py` — exact (SHA-256) + near
  (perceptual hash) detection; flags for review, never deletes.
- **Leakage prevention:** grouping keys (plant/leaf/farm/session) in schema;
  group-aware stratified splitter in `ml/src/data/splitting.py`; test set isolated.
- **Exclusion rules & quality tiers:** docs/dataset.md §9–10.

## 8. Dataset risks identified
- Spot↔blight boundary ambiguity → irreducible label noise at margins (mitigated via review workflow).
- Rust early-stage ≈ spot pinhead lesions → early-stage images must be marked uncertain.
- Geographic/cultivar bias depends on collection sources; provenance mandatory per image.
- Symptom-based grouping means the model cannot identify causal species (by design).
- External dataset (Rajshahi) lacks any blight class — unsuitable alone for this taxonomy.
- Severity scale unvalidated.
- Class-balance pressure could incentivize forcing ambiguous images into classes — workflow forbids it.

## 9. External datasets summary
One strong candidate documented ([docs/data-sources.md](docs/data-sources.md)):
the Rajshahi/Bangladesh mulberry dataset (healthy/rust/spot, ~1,091 images,
expert-annotated, Frontiers 2023) — potential benchmarking/external-test role
pending license verification; NOT merged into the research dataset. Cultivar-
classification datasets explicitly excluded from scope confusion.

## 10. Files created or modified

**Created**
- `docs/annotation-schema.md`
- `docs/dataset-versioning.md`
- `docs/data-sources.md`
- `Phase2_Status.md` (this file)
- `ml/scripts/dataset_report.py`
- `ml/src/data/manifest.py`
- `ml/notebooks/01_dataset_exploration.ipynb`
- `ml/data/incoming/.gitkeep`, `ml/data/validated/.gitkeep`, `ml/data/rejected/.gitkeep`

**Rewritten/updated**
- `ml/src/config/classes.json` — approved 4-class taxonomy w/ definitions, visual indicators, confounders, sources, confidence
- `ml/src/config/pipeline.json` — 2,000-image targets, 80/10/10 ratios, quality rules
- `prisma/schema.prisma` — annotation workflow states, Annotation audit model, severity, grouping keys, version metadata
- `docs/dataset.md` — full dataset specification (14 sections)
- `ml/src/data/validation.py` — implemented
- `ml/src/data/statistics.py` — implemented
- `ml/src/data/deduplication.py` — implemented
- `ml/src/data/splitting.py` — implemented (group-aware)
- `ml/requirements.txt` — added imagehash

## 11. Verification performed
- `prisma validate` + `db push` ✅
- All Python modules compile ✅
- `dataset_report.py` runs correctly on empty dataset (zeros only) ✅
- Splitter smoke run on empty input ✅

## 12. What remains for Phase 3 (next steps)
1. **Image acquisition** — collect/source real photos per class under recorded licenses (target composition §4).
2. **Metadata collection** — capture-context fields per annotation-schema.md; grouping keys wherever possible.
3. **Annotation** — preliminary labeling against classes.json visual-indicator guidance.
4. **Expert verification** — sericulture/plant-pathology expert review to APPROVED; resolve flagged spot/blight boundary cases.
5. **Dataset population** — run ingestion→validation→dedup→review pipeline; cut dataset version v0.x manifests.
6. Only after that: preprocessing/splits for training (still no MobileNetV2 work until the model-training phase).
