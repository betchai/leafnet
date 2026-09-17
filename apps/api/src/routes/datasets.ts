import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { authorize } from "../auth/middleware.js";
import {
  buildCutWhere,
  cutSourcesSnapshot,
  buildApprovedClassWhere,
} from "../domain/datasetCut.js";

const prisma = new PrismaClient();
const router = Router();

// GET /api/datasets — list dataset versions.
router.get("/", authorize("dataset_admin"), async (_req, res) => {
  const datasets = await prisma.dataset.findMany({
    include: { _count: { select: { images: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json({ items: datasets, count: datasets.length });
});

/**
 * POST /api/datasets/cut { version } — cut a new dataset version from research
 * images. Records real composition counts; never fabricates.
 *
 * Membership = all APPROVED non-dev images by default. Optional provenance
 * filter (sources[] / sourceType) restricts the cut to specific uploaded
 * populations — e.g. a raw in-situ batch. Optional additionalApprovedClasses
 * merges in existing APPROVED images of the given classes (by confirmed
 * classification), so classes whose raw originals were discarded (e.g.
 * healthy) can still be sourced from earlier curated versions. Provided the
 * two selectors are disjoint, versions stay clean snapshots; cut membership
 * never mutates prior versions (MANY-TO-MANY).
 */
router.post("/cut", authorize("dataset_admin"), async (req, res) => {
  const { version, changes, knownIssues, sources, sourceType } = req.body ?? {};
  const additionalClasses = (req.body ?? {}).additionalApprovedClasses;
  if (!version) return res.status(400).json({ error: "version is required" });

  const exists = await prisma.dataset.findUnique({ where: { version } });
  if (exists) return res.status(409).json({ error: `Version ${version} already exists` });

  const where = buildCutWhere(sources, sourceType);

  const approved = await prisma.image.findMany({
    where,
    include: { classifications: true },
  });

  // Merge existing APPROVED images of requested classes (e.g. curated healthy)
  // into the membership, de-duplicated by id.
  const extraWhere = buildApprovedClassWhere(additionalClasses);
  if (extraWhere) {
    const extra = await prisma.image.findMany({
      where: extraWhere,
      include: { classifications: true },
    });
    const seen = new Set(approved.map((i) => i.id));
    for (const img of extra) {
      if (!seen.has(img.id)) {
        seen.add(img.id);
        approved.push(img);
      }
    }
  }

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
      sources: cutSourcesSnapshot(sources, sourceType, additionalClasses),
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
