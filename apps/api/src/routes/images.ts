import { Router } from "express";
import multer from "multer";
import { PrismaClient } from "@prisma/client";

import { ingestImage } from "../services/ingestion.js";

const prisma = new PrismaClient();
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// GET /api/images?class=&annotationStatus=&datasetId=&fixtures=include|exclude|only
router.get("/", async (req, res) => {
  const { class: classKey, annotationStatus, datasetId, fixtures } = req.query;

  const fixtureFilter =
    fixtures === "only"
      ? true
      : fixtures === "include"
        ? undefined
        : false; // default: research data only

  const images = await prisma.image.findMany({
    where: {
      ...(annotationStatus
        ? { annotationStatus: annotationStatus as never }
        : {}),
      ...(fixtureFilter !== undefined ? { isDevFixture: fixtureFilter } : {}),
      ...(classKey
        ? { classifications: { some: { classKey: classKey as string } } }
        : {}),
    },
    include: {
      classifications: true,
      annotations: {
        where: { stage: "PRELIMINARY" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { preliminaryLabel: true, annotator: true, annotatedAt: true, reviewNotes: true },
      },
      predictions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          predictedClass: true,
          confidence: true,
          createdAt: true,
          modelVersion: { select: { version: true } },
        },
      },
      _count: { select: { predictions: true, audits: true, relationsA: true, relationsB: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  res.json({ items: images, count: images.length });
});

/**
 * POST /api/images — multipart ingestion (Phase 3).
 * Fields: image (file) + metadata fields + isDevFixture.
 * Originals are preserved; exact duplicates are flagged via ImageRelation.
 */
router.post("/", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "image file is required" });

  try {
    // Technical validation gate (dimensions/format/corruption) before persisting record
    const result = await ingestImage(
      {
        originalName: req.file.originalname,
        buffer: req.file.buffer,
        metadata: req.body as Record<string, string>,
        isDevFixture: req.body.isDevFixture === "true",
      },
      prisma
    );
    res.status(201).json({
      ...result,
      note: result.isExactDuplicate
        ? "Exact duplicate of an existing image — flagged for review, original preserved."
        : undefined,
    });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "UNSUPPORTED_FORMAT") {
      return res.status(415).json({ error: (err as Error).message });
    }
    if (code === "INVALID_IMAGE_CONTENT") {
      return res.status(422).json({ error: (err as Error).message });
    }
    console.error("[images] ingestion failed:", err);
    return res.status(500).json({ error: "Image ingestion failed." });
  }
});

// GET /api/images/:id/file — serve the stored original (TOOLS: used by annotation UI)
router.get("/:id/file", async (req, res) => {
  const image = await prisma.image.findUnique({ where: { id: req.params.id } });
  if (!image) return res.status(404).json({ error: "Image not found" });
  res.sendFile(image.storagePath, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// GET /api/images/:id — full detail with workflow history
router.get("/:id", async (req, res) => {
  const image = await prisma.image.findUnique({
    where: { id: req.params.id },
    include: {
      classifications: true,
      annotations: { orderBy: { createdAt: "asc" } },
      audits: { orderBy: { createdAt: "asc" } },
      relationsA: true,
      relationsB: true,
    },
  });
  if (!image) return res.status(404).json({ error: "Image not found" });
  res.json(image);
});

export default router;
