import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

// GET /api/datasets — list dataset versions.
router.get("/", async (_req, res) => {
  const datasets = await prisma.dataset.findMany({
    include: { _count: { select: { images: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json({ items: datasets, count: datasets.length });
});

/**
 * POST /api/datasets/cut { version } — cut a new dataset version from all
 * APPROVED research images (dev fixtures excluded by definition).
 * Records real composition counts; never fabricates.
 */
router.post("/cut", async (req, res) => {
  const { version, changes, knownIssues } = req.body ?? {};
  if (!version) return res.status(400).json({ error: "version is required" });

  const exists = await prisma.dataset.findUnique({ where: { version } });
  if (exists) return res.status(409).json({ error: `Version ${version} already exists` });

  const approved = await prisma.image.findMany({
    where: { isDevFixture: false, annotationStatus: "APPROVED" },
    include: { classifications: true },
  });

  const perClass: Record<string, number> = {};
  for (const img of approved) {
    const k = img.classifications[0]?.classKey;
    if (k) perClass[k] = (perClass[k] ?? 0) + 1;
  }

  const prev = await prisma.dataset.findFirst({ orderBy: { createdAt: "desc" } });
  const dataset = await prisma.dataset.create({
    data: {
      name: `LEAFNET ${version}`,
      version,
      status: "DRAFT",
      totalImages: approved.length,
      imagesPerClass: perClass,
      splitCounts: undefined, // assigned later by the leakage-safe splitter
      sources: undefined,
      changesFromPrevious: changes ?? (prev ? `Cut after ${prev.version}` : "Initial cut"),
      knownIssues: knownIssues ?? null,
      validationStatus: approved.length ? "pending_exploration" : "empty",
    },
  });

  // MANY-TO-MANY membership: cutting a new version never mutates old versions.
  await prisma.dataset.update({
    where: { id: dataset.id },
    data: { images: { set: approved.map((i) => ({ id: i.id })) } },
  });

  res.status(201).json({ dataset, members: approved.length, perClass });
});

export default router;
