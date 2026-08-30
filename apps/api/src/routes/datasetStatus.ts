import { Router } from "express";
import { PrismaClient } from "@prisma/client";

import { computeComposition } from "../domain/composition.js";

const prisma = new PrismaClient();
const router = Router();

/**
 * GET /api/datasets/status — live composition tracking (Phase 3 §11–12).
 * Research vs dev fixtures are reported separately; fixtures never count
 * toward research targets.
 */
router.get("/status", async (_req, res) => {
  const images = await prisma.image.findMany({
    include: { classifications: { select: { classKey: true } } },
  });
  const composition = computeComposition(
    images.map((i) => ({
      annotationStatus: i.annotationStatus,
      isDevFixture: i.isDevFixture,
      classification: i.classifications[0] ?? null,
    }))
  );

  // Open duplicate/near-dup flags needing human resolution
  const openRelations = await prisma.imageRelation.count({
    where: { resolution: "" },
  });
  const feedbackCount = await prisma.feedback.count();
  const activeModel = await prisma.modelVersion.findFirst({
    where: { isActive: true }, select: { version: true, architecture: true },
  });

  // Balance severity from approved research images (dominant-class share).
  // Never masks imbalance behind a single accuracy number.
  const approved = composition.perClass as Record<string, { approved: number }>;
  const classes = Object.keys(approved);
  const totalApproved = classes.reduce((a, c) => a + approved[c].approved, 0);
  let balanceSummary = {
    totalApproved,
    dominantClass: null as string | null,
    dominantShare: 0,
    severity: "unknown" as "unknown" | "ok" | "attention" | "critical",
    message: "" as string,
  };
  if (totalApproved > 0) {
    let dom: string | null = null, max = 0;
    for (const c of classes) {
      if (approved[c].approved > max) { max = approved[c].approved; dom = c; }
    }
    const share = totalApproved ? max / totalApproved : 0;
    balanceSummary.dominantClass = dom;
    balanceSummary.dominantShare = Math.round(share * 100);
    balanceSummary.severity =
      share >= 0.7 ? "critical"
      : share >= 0.5 ? "attention"
      : "ok";
    balanceSummary.message = dom
      ? `${dom} is ${Math.round(share * 100)}% of ${totalApproved} approved research image(s).`
      : "";
  }

  res.json({
    ...composition,
    openDuplicateFlags: openRelations,
    feedbackCount,
    activeModel: activeModel ?? null,
    balanceSummary,
  });
});

export default router;
