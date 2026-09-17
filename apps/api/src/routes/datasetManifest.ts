import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { authorize } from "../auth/middleware.js";

const prisma = new PrismaClient();
const router = Router();

export const MANIFEST_FIELDS = [
  "image_id", "path", "source", "source_type", "license", "background_type",
  "class", "severity", "plant_id", "leaf_id", "farm_id",
  "collection_session_id", "split", "annotation_status", "review_status",
  "dataset_version", "sha256",
] as const;

/**
 * GET /api/datasets/:id/manifest — reproducible JSONL manifest (Phase 3 §17).
 * Includes APPROVED research images only; dev fixtures excluded by design.
 * Split assignment is NOT generated here — splitting happens in the
 * dedicated group-aware splitter once the dataset is complete.
 */
router.get("/:id/manifest", authorize("dataset_admin"), async (req, res) => {
  const dataset = await prisma.dataset.findUnique({ where: { id: req.params.id } });
  if (!dataset) return res.status(404).json({ error: "Dataset not found" });

  const images = await prisma.image.findMany({
    where: { datasets: { some: { id: dataset.id } }, isDevFixture: false },
    include: { classifications: true, annotations: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  res.type("application/x-ndjson");
  for (const img of images) {
    const row: Record<string, string | null> = {
      image_id: img.id,
      path: img.storagePath,
      source: img.source,
      source_type: img.sourceType,
      background_type: img.backgroundType,
      license: img.license,
      class: img.classifications[0]?.classKey ?? null,
      severity: String(img.classifications[0]?.severity ?? "") || null,
      plant_id: img.plantId,
      leaf_id: img.leafId,
      farm_id: img.farmId,
      collection_session_id: img.collectionSessionId,
      split: null, // assigned later by the leakage-safe splitter
      annotation_status: img.annotationStatus,
      review_status:
        img.annotations[0]?.stage === "FINAL_VERIFIED" ? "final_verified"
        : img.annotations[0]?.stage === "EXPERT_REVIEW" ? "expert_review"
        : null,
      dataset_version: dataset.version,
      sha256: img.sha256,
    };
    res.write(
      JSON.stringify(Object.fromEntries(MANIFEST_FIELDS.map((f) => [f, row[f]]))) + "\n"
    );
  }
  res.end();
});

export default router;
