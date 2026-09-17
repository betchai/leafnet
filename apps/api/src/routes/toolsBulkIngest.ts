// TOOLS: bulk ingestion endpoint — encapsulated researcher tooling.
// Accepts many image files + shared collection metadata; optionally assigns
// a preliminary label to each (through the normal audited workflow).
import { Router } from "express";
import multer from "multer";
import { PrismaClient } from "@prisma/client";

import { authorize } from "../auth/middleware.js";
import { roleToActorRole } from "../rbac/permissions.js";
import { ingestImage } from "../services/ingestion.js";
import { assertValidClassKey } from "../domain/taxonomy.js";

const prisma = new PrismaClient();
const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

router.post(
  "/bulk-ingest",
  authorize("bulk_ingest"),
  upload.array("images", 500),
  async (req, res) => {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files?.length) return res.status(400).json({ error: "no images provided" });

    const meta = req.body as Record<string, string>;
    const label = meta.assignLabel || "";
    const actor = req.user!.name;
    const actorRole = roleToActorRole(req.user!.role);

    if (label) {
      try {
        assertValidClassKey(label);
      } catch (err: unknown) {
        return res.status(422).json({ error: (err as Error).message });
      }
    }

    const results = { ingested: 0, duplicatesFlagged: 0, labeled: 0, failed: 0 };
    const failures: { filename: string; error: string }[] = [];

    for (const f of files) {
      try {
        const { image, isExactDuplicate } = await ingestImage(
          {
            originalName: f.originalname,
            buffer: f.buffer,
            metadata: {
              source: meta.source,
              sourceType: meta.sourceType,
              collectionSessionId: meta.collectionSessionId,
              farmId: meta.farmId,
              plantId: meta.plantId,
              leafId: meta.leafId,
              license: meta.license,
            },
            isDevFixture: meta.isDevFixture === "true",
          },
          prisma
        );
        results.ingested++;
        if (isExactDuplicate) results.duplicatesFlagged++;

        if (label && !isExactDuplicate) {
          await prisma.annotation.create({
            data: {
              imageId: image.id,
              stage: "PRELIMINARY",
              preliminaryLabel: label,
              confidence: null,
              annotator: actor,
              annotatedAt: new Date(),
            },
          });
          await prisma.image.update({
            where: { id: image.id },
            data: { annotationStatus: "ANNOTATED" },
          });
          await prisma.annotationAudit.create({
            data: {
              imageId: image.id,
              action: "preliminary_annotate",
              newLabel: label,
              previousStatus: "UNLABELED",
              newStatus: "ANNOTATED",
actor,
            actorRole,
            reason: `bulk ingestion (${meta.source ?? "unspecified"})`,
            },
          });
          results.labeled++;
        }
      } catch (err: unknown) {
        results.failed++;
        failures.push({ filename: f.originalname, error: (err as Error).message });
      }
    }

    res.status(201).json({ ...results, failures });
  }
);

export default router;
