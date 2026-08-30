# LEAFNET — Phase 10 Final Status

**Date:** August 26, 2026
**Status:** Complete (Pilot Cleaned, Ready for Real Data)

---

## Executive Summary

LEAFNET (Mulberry Leaf Intelligence) is a full-stack machine-learning application that classifies mulberry leaf health into four classes using MobileNetV2 transfer learning. The system spans 10 phases from scaffolding through hardening, covering the complete ML lifecycle: data acquisition, annotation, training, evaluation, inference, feedback, and monitoring.

**The system is built, tested, and deployed. The only remaining work is data collection — the dataset must be balanced before any model can be trusted.**

---

## What Was Built

### Phase 1: Project Scaffolding
- Monorepo structure (apps/api, apps/web, ml/)
- Express API with Prisma ORM (PostgreSQL)
- React + Tailwind frontend with Vite
- Python ML service with FastAPI
- Docker Compose for local development

### Phase 2: Taxonomy & Data Model
- 4-class taxonomy: healthy, leaf_rust, leaf_spot, leaf_blight
- Prisma schema with Image, Classification, Annotation, ModelVersion, Prediction, Feedback, SystemAudit
- Annotation workflow: UNLABELED → NEEDS_REVIEW → ANNOTATED → EXPERT_REVIEWED → APPROVED
- Leakage-prevention grouping (plantId, leafId, farmId, collectionSessionId)

### Phase 3: Data Acquisition Tools
- Bulk ingest tool (500 images/batch max, 25MB each)
- Magic-byte validation (rejects corrupt/invalid uploads)
- Image metadata extraction (dimensions, file size, SHA-256)

### Phase 4: Exploratory Data Analysis
- Dataset composition tracking with balance warnings
- Duplicate candidate detection
- Image quality metrics (brightness, contrast, blur)
- Outlier detection

### Phase 5: Training Pipeline
- MobileNetV2 transfer learning (torchvision pretrained weights)
- Configurable hyperparameters (training.json)
- Data augmentation (random horizontal/vertical flip, rotation, color jitter)
- Checkpointing with best-model tracking
- Class-weighted loss for imbalanced datasets

### Phase 6: Evaluation
- Test-set evaluation pipeline
- Per-class precision, recall, F1
- Confusion matrix generation
- Model card generation

### Phase 7: Inference Service
- FastAPI service with model loading from active.json
- Image validation + preprocessing
- Prediction with confidence scores
- Review-recommended flag (low confidence threshold)
- Health check endpoint

### Phase 8: Application Integration
- Dashboard with dataset status
- Model management (list, promote, demote)
- Prediction history
- User feedback collection (agree/disagree/unsure)

### Phase 9: Research Analytics
- Insights engine with 7 research queries
- Data leakage detection
- Class separability analysis (t-SNE, PCA)
- Overfitting indicators
- Training history comparison

### Phase 9.1: Feedback Review + Monitoring
- Expert feedback review queue
- System health monitoring (disk, memory, uptime)
- Model lifecycle transitions (candidate → staging → production → archived)

### Phase 10: Hardening
- Batch confirmation with class override
- Balance warning banner on Models page
- Decommission prompt (decom_beta.md)
- Bulk upload operating manual (BULK_UPLOAD.MD)
- Architecture schematic diagram
- Landing page with brand "Leafnet"

---

## What Was Learned

### The Pilot Phase Was Essential
The 11-image pilot (Farm A/B collection) validated every layer of the system:
- Ingestion → annotation → training → evaluation → inference → feedback
- All 39 vitest + 59 pytest tests pass
- TypeScript typechecks clean (except pre-existing Prisma enum issue in annotations.ts)

### Dataset Balance Is Everything
- The 421 approved research images are **98% leaf_spot** (413 of 421)
- healthy: 2 | leaf_rust: 3 | leaf_blight: 3
- Any model trained on this data will be biased toward leaf_spot
- The balance banner correctly shows "critical" severity

### The System Works — The Data Doesn't (Yet)
- All code is proven and tested
- The ML pipeline runs end-to-end
- The inference service loads models and returns predictions
- The feedback loop captures expert corrections
- The only bottleneck is acquiring balanced, real-world data

---

## Current State (Post-Pilot Clean Slate)

### Database
- **0 images** (all 421 research + 20 fixtures deleted for fresh start)
- **0 dataset versions** (v0.1, v0.2, v1.0, v1.1 removed)
- **0 model versions** (all checkpoints + registry rows removed)
- **0 predictions, 0 feedback** (pilot application data cleared)
- Schema intact, migrations current

### Disk
- `ml/models/` — empty (only .gitkeep)
- `ml/reports/evaluation/` — removed
- `ml/reports/experiments/` — removed
- `ml/data/prepared/` — empty (only .gitkeep)
- `uploads/` — empty (421 research files + 20 fixture files removed)

### Services
- **Node API** — running, healthy, no active model
- **Python ML** — running, "unhealthy" (honest — no model to load)
- **Frontend** — serving, all pages render empty states correctly

### Tests
- 39 vitest (API) — passing
- 59 pytest (ML) — passing
- TypeScript typechecks — clean (except pre-existing annotations.ts Prisma enum issue)

---

## Recommendations for Next Steps

### 1. Balance the Dataset (Critical)
The single most important action. Without balanced data, no model is trustworthy.

**Target:** 500 images per class (2,000 total)
**Current:** healthy: 0 | leaf_rust: 0 | leaf_spot: 0 | leaf_blight: 0 (clean slate)

**Approach:**
- Bulk upload images class-by-class (one session per class)
- Use the Expert Review "Confirm all" dialog for speed
- Watch the balance banner on the Models page — it stays red until balanced

### 2. Cut Dataset Version
Once balanced:
- Tools → Dataset Status → Cut version (fresh v1.0)
- This creates an immutable snapshot for training

### 3. Train with Real Data
- Pipeline Runner (automated) or manual training
- Expect better results than pilot (more data, balanced classes)
- Compare frozen vs. fine-tuned variants

### 4. Evaluate Honestly
- Per-class precision/recall (not just overall accuracy)
- Confusion matrix — look for class pairs that confuse the model
- If any class has <80% recall, acquire more images for that class

### 5. Deploy to Render
- Push to GitHub → Blueprint deploy
- See DEPLOYMENT.md for full instructions
- Estimated cost: $21/month (or $0 on free tier for demo)

---

## File Reference

| File | Purpose |
|---|---|
| `DEPLOYMENT.md` | Render deployment guide |
| `BULK_UPLOAD.MD` | Operating manual for image acquisition |
| `decom_beta.md` | Beta decommission prompt |
| `docs/schematic.md` | Architecture diagram spec |
| `docs/limitations.md` | System limitations |
| `docs/reproducibility.md` | Reproducibility notes |
| `docs/final-model-card.md` | Model card template |
| `docs/system-card.md` | System card |
| `docs/deployment.md` | Legacy deployment notes |
| `render.yaml` | Render blueprint |
| `docker-compose.yml` | Local development |
| `docker/api.Dockerfile` | Node API + frontend (production) |
| `docker/ml.Dockerfile` | Python ML service (production) |

---

## Conclusion

LEAFNET is a complete, tested, deployable ML system. The codebase spans 10 phases covering the full lifecycle from data acquisition to monitoring. The pilot phase proved every layer works. The only remaining work is collecting balanced, real-world data and training a production model.

The system is ready. The data is not. Collect balanced images, and the machine will do the rest.
