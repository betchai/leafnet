import { Router } from "express";
import { PrismaClient, AnnotationStatus } from "@prisma/client";

import { authorize } from "../auth/middleware.js";
import { roleToActorRole } from "../rbac/permissions.js";
import { assertValidClassKey } from "../domain/taxonomy.js";
import {
  validatePreliminaryAnnotation,
  validateTransition,
  ReviewAction,
} from "../domain/workflow.js";

const prisma = new PrismaClient();
const router = Router();

async function audit(params: {
  imageId: string;
  action: string;
  previousLabel?: string | null;
  newLabel?: string | null;
  previousStatus?: AnnotationStatus | null;
  newStatus?: AnnotationStatus | null;
  actor: string;
  actorRole: string;
  reason?: string | null;
}) {
  await prisma.annotationAudit.create({ data: params });
}

/**
 * POST /api/images/:id/annotations — preliminary annotation by a researcher.
 * Body: { actor, label, confidence?, severity?, notes? }
 * Labels are strictly validated against the approved 4-class taxonomy.
 */
router.post("/images/:id/annotations", authorize("annotate"), async (req, res) => {
  const { label, confidence, severity, notes } = req.body ?? {};
  if (!label)
    return res.status(400).json({ error: "label is required" });
  const actor = req.user!.name;
  const actorRole = roleToActorRole(req.user!.role);

  try {
    assertValidClassKey(label);
  } catch (err: unknown) {
    return res.status(422).json({ error: (err as Error).message });
  }

  const image = await prisma.image.findUnique({
    where: { id: req.params.id },
    include: { classifications: true },
  });
  if (!image) return res.status(404).json({ error: "Image not found" });

  try {
    validatePreliminaryAnnotation(image.annotationStatus as AnnotationStatus);
  } catch (err: unknown) {
    return res.status(409).json({ error: (err as Error).message });
  }

  const annotation = await prisma.annotation.create({
    data: {
      imageId: image.id,
      stage: "PRELIMINARY",
      preliminaryLabel: label,
      confidence: typeof confidence === "number" ? confidence : null,
      severity: typeof severity === "number" ? severity : null,
      annotator: actor,
      annotatedAt: new Date(),
      reviewNotes: notes || null,
    },
  });
  await prisma.image.update({
    where: { id: image.id },
    data: { annotationStatus: "ANNOTATED" },
  });
  await audit({
    imageId: image.id,
    action: "preliminary_annotate",
    previousLabel: null,
    newLabel: label,
    previousStatus: image.annotationStatus as AnnotationStatus,
    newStatus: "ANNOTATED",
    actor,
    actorRole: "annotator",
    reason: notes || null,
  });

  res.status(201).json(annotation);
});

/**
 * POST /api/images/:id/review — expert verification.
 * Body: { actor, action: confirm|relabel|mark_uncertain|reject|second_opinion,
 *         label?, reason? }
 * Enforces role, state machine, and taxonomy. Appends audit entries only.
 */
router.post("/images/:id/review", authorize("expert_review"), async (req, res) => {
  const { action, label, reason } = req.body ?? {};
  if (!action)
    return res.status(400).json({ error: "action is required" });
  const actor = req.user!.name;
  const actorRole = roleToActorRole(req.user!.role);

  if (label) {
    try {
      assertValidClassKey(label);
    } catch (err: unknown) {
      return res.status(422).json({ error: (err as Error).message });
    }
  }

  const image = await prisma.image.findUnique({
    where: { id: req.params.id },
    include: {
      classifications: true,
      annotations: { where: { stage: "PRELIMINARY" }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!image) return res.status(404).json({ error: "Image not found" });

  const preliminary = image.annotations[0];
  const currentStatus = image.annotationStatus as AnnotationStatus;

  let result;
  try {
    result = validateTransition({
      action: action as ReviewAction,
      currentStatus,
      actorRole,
      hasPreliminaryLabel: Boolean(preliminary),
      newLabel: label ?? preliminary?.preliminaryLabel,
    });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    const status = code === "FORBIDDEN_ROLE" ? 403 : code === "MISSING_LABEL" || code === "NO_PRELIMINARY_LABEL" ? 400 : 409;
    return res.status(status).json({ error: (err as Error).message });
  }

  const finalLabel =
    action === "confirm" || action === "relabel" ? label ?? preliminary!.preliminaryLabel! : null;

  // Record the review
  await prisma.annotation.create({
    data: {
      imageId: image.id,
      stage: action === "confirm" ? "FINAL_VERIFIED" : "EXPERT_REVIEW",
      finalLabel,
      reviewer: actor,
      reviewedAt: new Date(),
      reviewNotes: reason || null,
      uncertain: action === "mark_uncertain",
    },
  });

  // Confirmed ground truth only exists at APPROVED
  if (result.newStatus === "APPROVED" && finalLabel) {
    await prisma.classification.upsert({
      where: { imageId: image.id },
      create: { imageId: image.id, classKey: finalLabel },
      update: { classKey: finalLabel },
    });
  }
  if (action === "relabel") {
    await prisma.classification.upsert({
      where: { imageId: image.id },
      create: { imageId: image.id, classKey: finalLabel! },
      update: { classKey: finalLabel! },
    });
  }

  await prisma.image.update({
    where: { id: image.id },
    data: {
      annotationStatus: result.newStatus,
      rejectedReason: action === "reject" ? reason || null : null,
    },
  });

  await audit({
    imageId: image.id,
    action: `review_${action}`,
    previousLabel: preliminary?.preliminaryLabel ?? null,
    newLabel: finalLabel,
    previousStatus: currentStatus,
    newStatus: result.newStatus,
    actor,
    actorRole,
    reason: reason || null,
  });

  res.status(201).json({ status: result.newStatus, finalLabel });
});

// GET /api/images/:id/audit — who/when/what/why history
router.get("/images/:id/audit", authorize("view_dataset"), async (req, res) => {
  const audits = await prisma.annotationAudit.findMany({
    where: { imageId: req.params.id },
    orderBy: { createdAt: "asc" },
  });
  res.json({ items: audits, count: audits.length });
});

/**
 * POST /api/review/batch-confirm  { actor, imageIds?, label? }
 * Confirm ALL pending (ANNOTATED / EXPERT_REVIEWED / SECOND_OPINION) images in one
 * action. If imageIds is omitted, every eligible image is confirmed. If `label`
 * is provided, it overrides the preliminary label (used to bulk-confirm a batch
 * to a known class); otherwise each image is confirmed to its own preliminary
 * label. Failed images are reported per-id, never silently skipped.
 */
router.post("/review/batch-confirm", authorize("expert_review"), async (req, res) => {
  const { imageIds, label } = req.body ?? {};
  const actor = req.user!.name;
  const actorRole = roleToActorRole(req.user!.role);

  if (label) {
    try {
      assertValidClassKey(label);
    } catch (err: unknown) {
      return res.status(422).json({ error: (err as Error).message });
    }
  }

  // Eligibility: pre-APPROVED states that may be confirmed to APPROVED
  const eligibleStatuses = ["ANNOTATED", "EXPERT_REVIEWED", "SECOND_OPINION"];
  const where: Record<string, unknown> = { annotationStatus: { in: eligibleStatuses } };
  if (Array.isArray(imageIds) && imageIds.length) where.id = { in: imageIds };

  const images = await prisma.image.findMany({
    where,
    include: {
      annotations: { where: { stage: "PRELIMINARY" }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const confirmed: string[] = [];
  const failed: { imageId: string; error: string }[] = [];
  for (const image of images) {
    const preliminary = image.annotations[0];
    const currentStatus = image.annotationStatus as AnnotationStatus;
    try {
      validateTransition({
        action: "confirm" as ReviewAction,
        currentStatus,
        actorRole,
        hasPreliminaryLabel: Boolean(preliminary) || Boolean(label),
        newLabel: label ?? preliminary?.preliminaryLabel,
      });
    } catch (err: unknown) {
      failed.push({ imageId: image.id, error: (err as Error).message });
      continue;
    }
    const finalLabel = label ?? preliminary?.preliminaryLabel;
    if (!finalLabel) {
      failed.push({ imageId: image.id, error: "no label to confirm (provide label or a preliminary label)" });
      continue;
    }

    try {
      await prisma.annotation.create({
        data: { imageId: image.id, stage: "FINAL_VERIFIED", finalLabel, reviewer: actor, reviewedAt: new Date() },
      });
      await prisma.classification.upsert({
        where: { imageId: image.id },
        create: { imageId: image.id, classKey: finalLabel },
        update: { classKey: finalLabel },
      });
      await prisma.image.update({ where: { id: image.id }, data: { annotationStatus: "APPROVED" } });
      await audit({
        imageId: image.id, action: "review_confirm", previousLabel: preliminary.preliminaryLabel ?? null,
        newLabel: finalLabel, previousStatus: currentStatus, newStatus: "APPROVED",
        actor, actorRole,
        reason: label ? `batch confirm to ${label}` : "batch confirm",
      });
      confirmed.push(image.id);
    } catch (err: unknown) {
      failed.push({ imageId: image.id, error: (err as Error).message });
    }
  }

  res.status(201).json({ confirmed: confirmed.length, failed, note: "Batch confirmation is audited per image." });
});

/**
 * GET /api/review/batch-confirm-preview — count pending images by their
 * preliminary label, so the UI can show a breakdown before bulk-confirming.
 */
router.get("/review/batch-confirm-preview", authorize("expert_review"), async (_req, res) => {
  const eligibleStatuses: AnnotationStatus[] = ["ANNOTATED", "EXPERT_REVIEWED", "SECOND_OPINION"];
  const images = await prisma.image.findMany({
    where: { annotationStatus: { in: eligibleStatuses } },
    include: {
      annotations: { where: { stage: "PRELIMINARY" }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const byStatus: Record<string, number> = {};
  const byLabel: Record<string, number> = {};
  for (const img of images) {
    byStatus[img.annotationStatus] = (byStatus[img.annotationStatus] ?? 0) + 1;
    const label = img.annotations[0]?.preliminaryLabel ?? "(no label)";
    byLabel[label] = (byLabel[label] ?? 0) + 1;
  }
  res.json({ total: images.length, byStatus, byLabel });
});

export default router;
