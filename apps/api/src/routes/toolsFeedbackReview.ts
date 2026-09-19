// TOOLS (Phase 9.1): feedback review queue, candidates, monitoring, model lifecycle.
import { Router } from "express";
import { PrismaClient } from "@prisma/client";

import { authorize } from "../auth/middleware.js";
import {
  validateFeedbackReview, validateLifecycleTransition, canActivate,
} from "../domain/lifecycle.js";
import type { ReviewAction } from "../domain/lifecycle.js";
import { assertValidClassKey } from "../domain/taxonomy.js";

const prisma = new PrismaClient();
const router = Router();

async function sysAudit(a: {
  actor: string; action: string; objectType: string; objectId: string;
  previousState?: unknown; newState?: unknown; reason?: string;
}) {
  await prisma.systemAudit.create({ data: a as never });
}

/* ================= FEEDBACK REVIEW QUEUE ================= */

// GET /api/tools/feedback?status=&verdict=&modelVersion=
router.get("/feedback", authorize("feedback_review"), async (req, res) => {
  const { status, verdict, modelVersion } = req.query;
  const feedbacks = await prisma.feedback.findMany({
    where: {
      ...(status ? { reviewStatus: status as string } : {}),
      ...(verdict ? { verdict: verdict as string } : {}),
      ...(modelVersion
        ? { prediction: { modelVersion: { version: modelVersion as string } } }
        : {}),
    },
    include: {
      prediction: {
        include: {
          image: { select: { filename: true, storagePath: true } },
          modelVersion: { select: { version: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json({
    items: feedbacks.map((f) => ({
      feedbackId: f.id,
      verdict: f.verdict,
      suggestedClass: f.correctedClass,
      comment: f.comment,
      reviewStatus: f.reviewStatus,
      reviewer: f.reviewer,
      reviewNotes: f.reviewNotes,
      verifiedClass: f.verifiedClass,
      createdAt: f.createdAt,
      prediction: {
        id: f.prediction.id,
        predictedClass: f.prediction.predictedClass,
        confidence: f.prediction.confidence,
        probabilities: f.prediction.probabilities,
        imageId: f.prediction.imageId,
        filename: f.prediction.image.filename,
        imageUrl: `/api/images/${f.prediction.imageId}/file`,
        modelVersion: f.prediction.modelVersion?.version ?? null,
      },
    })),
    count: feedbacks.length,
  });
});

/**
 * PATCH /api/tools/feedback/:id/review  (expert/admin)
 * Body: { actor, actorRole, action: start_review|verify|verify_corrected|
 *                mark_uncertain|reject, verifiedClass?, notes? }
 */
router.patch("/feedback/:id/review", authorize("feedback_review"), async (req, res) => {
  const { action, verifiedClass, notes } = req.body ?? {};
  if (!action)
    return res.status(400).json({ error: "action is required" });
  const actor = req.user!.name;
  const reviewerRole = "expert";

  const fb = await prisma.feedback.findUnique({
    where: { id: req.params.id },
    include: { prediction: true },
  });
  if (!fb) return res.status(404).json({ error: "Feedback not found" });

  let newStatus: string;
  let finalClass: string | undefined;
  try {
    if ((action === "verify" || action === "verify_corrected") && verifiedClass) {
      assertValidClassKey(verifiedClass);
    }
    const r = validateFeedbackReview({
      action: action as ReviewAction,
      currentStatus: fb.reviewStatus as never,
      reviewerRole,
      verifiedClass: verifiedClass ?? fb.verifiedClass ?? fb.correctedClass ?? undefined,
    });
    newStatus = r.newStatus;
    finalClass =
      action === "verify"
        ? verifiedClass ?? fb.correctedClass ?? fb.verifiedClass ?? undefined
        : verifiedClass;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    const status = code === "FORBIDDEN_ROLE" ? 403 : code === "INVALID_TRANSITION" ? 409 : 400;
    return res.status(status).json({ error: (err as Error).message });
  }

  const updated = await prisma.feedback.update({
    where: { id: fb.id },
    data: {
      reviewStatus: newStatus,
      verifiedClass: finalClass ?? fb.verifiedClass,
      reviewer: actor,
      reviewedAt: new Date(),
      reviewNotes: notes ?? fb.reviewNotes,
    },
  });

  // VERIFIED label becomes CANDIDATE training data on the image — recorded via
  // Classification update + audit, but NEVER auto-added to any dataset version.
  if (newStatus === "VERIFIED" && finalClass) {
    const existing = await prisma.classification.findUnique({
      where: { imageId: fb.prediction.imageId },
    });
    await prisma.classification.upsert({
      where: { imageId: fb.prediction.imageId },
      create: { imageId: fb.prediction.imageId, classKey: finalClass },
      update: { classKey: finalClass },
    });
    await prisma.annotationAudit.create({
      data: {
        imageId: fb.prediction.imageId,
        action: "feedback_verified_label",
        previousLabel: existing?.classKey ?? null,
        newLabel: finalClass,
        previousStatus: null, newStatus: null,
        actor, actorRole: reviewerRole,
        reason: `Verified from application feedback ${fb.id} (Phase 9.1). Candidate training data only.`,
      },
    });
  }

  await sysAudit({
    actor, action: `feedback_${action}`, objectType: "Feedback", objectId: fb.id,
    previousState: { reviewStatus: fb.reviewStatus }, newState: { reviewStatus: newStatus, verifiedClass: finalClass },
    reason: notes,
  });

  res.json({ id: updated.id, reviewStatus: newStatus, verifiedClass: finalClass ?? null });
});

/* ================= CANDIDATE TRAINING DATA ================= */

// GET /api/tools/candidates — images with VERIFIED labels from feedback review
router.get("/candidates", authorize("feedback_review"), async (_req, res) => {
  const items = await prisma.feedback.findMany({
    where: { reviewStatus: "VERIFIED" },
    include: {
      prediction: {
        include: {
          image: { include: { classifications: true } },
          modelVersion: { select: { version: true } },
        },
      },
    },
    orderBy: { reviewedAt: "desc" },
  });
  res.json({
    count: items.length,
    items: items.map((f) => ({
      image_id: f.prediction.imageId,
      filename: f.prediction.image.filename,
      original_prediction: f.prediction.predictedClass,
      original_model_version: f.prediction.modelVersion?.version ?? null,
      user_suggested_class: f.correctedClass,
      verified_class: f.verifiedClass,
      verification_source: "expert_feedback_review",
      reviewer: f.reviewer,
      review_date: f.reviewedAt,
      current_dataset_class: f.prediction.image.classifications[0]?.classKey ?? null,
      eligible_for_next_dataset_cut: true,
    })),
  });
});

/* ================= MODEL LIFECYCLE ================= */

// PATCH /api/tools/models/:id/lifecycle { to, reason }
router.patch("/models/:id/lifecycle", authorize("model_admin"), async (req, res) => {
  const { to, reason } = req.body ?? {};
  if (!to) return res.status(400).json({ error: "to is required" });
  const actor = req.user!.name;

  const m = await prisma.modelVersion.findUnique({ where: { id: req.params.id } });
  if (!m) return res.status(404).json({ error: "ModelVersion not found" });

  try {
    validateLifecycleTransition(m.lifecycleStatus as never, to);
  } catch (err: unknown) {
    return res.status(409).json({ error: (err as Error).message });
  }

  // Guard: only approved models may become active; activating deactivates others.
  if (to === "active") {
    if (!canActivate(m.lifecycleStatus as never)) {
      return res.status(409).json({
        error: `Only APPROVED models can become active (current: ${m.lifecycleStatus})`,
      });
    }
    await prisma.modelVersion.updateMany({ data: { isActive: false } });
  }

  const updated = await prisma.modelVersion.update({
    where: { id: m.id },
    data: { lifecycleStatus: to, isActive: to === "active" },
  });

  await sysAudit({
    actor, action: to === "active" ? "model_activation" : "model_status_change",
    objectType: "ModelVersion", objectId: m.id,
    previousState: { lifecycleStatus: m.lifecycleStatus, isActive: m.isActive },
    newState: { lifecycleStatus: to, isActive: updated.isActive },
    reason,
  });
  res.json(updated);
});

/* ================= MONITORING SUMMARY ================= */

router.get("/monitoring/summary", authorize("monitoring"), async (_req, res) => {
  const preds = await prisma.prediction.findMany({
    where: { isPlaceholder: false },
    include: { feedback: true, modelVersion: { select: { version: true, lifecycleStatus: true } } },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });

  const byModel: Record<string, any> = {};
  for (const p of preds) {
    const key = p.modelVersion?.version ?? "unknown";
    const g = (byModel[key] ??= {
      predictions: 0, avg_confidence: null, low_confidence_rate: null,
      feedback_count: 0, disagreements: 0, verified_corrections: 0,
      verified_total: 0, verified_correct: 0,
      class_distribution: {} as Record<string, number>,
      confusion_pairs: {} as Record<string, number>,
      lifecycle: p.modelVersion?.lifecycleStatus ?? null,
    });
    g.predictions++;
    if (p.predictedClass) g.class_distribution[p.predictedClass] = (g.class_distribution[p.predictedClass] ?? 0) + 1;
    if (p.feedback) {
      g.feedback_count++;
      if (p.feedback.verdict === "disagree") g.disagreements++;
      if (p.feedback.reviewStatus === "VERIFIED") {
        g.verified_total++;
        if (p.feedback.isCorrect === true) g.verified_correct++;
        if (p.feedback.isCorrect === false) g.verified_corrections++;
      }
    }
  }
  for (const key of Object.keys(byModel)) {
    const group = preds.filter((p) => (p.modelVersion?.version ?? "unknown") === key);
    const confs = group.map((p) => p.confidence).filter((c): c is number => c != null);
    byModel[key].avg_confidence = confs.length
      ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 1000) / 1000 : null;
    const lowN = group.filter((p) => (p.confidence ?? 1) < 0.5).length;
    byModel[key].low_confidence_rate = confs.length
      ? Math.round((100 * lowN) / group.length) : null;
  }

  // Real-world confusion pairs from VERIFIED corrections only
  const confusionPairs: Record<string, number> = {};
  for (const p of preds) {
    if (p.feedback?.reviewStatus === "VERIFIED" && p.feedback.isCorrect === false &&
        p.feedback.verifiedClass && p.predictedClass) {
      const k = `${p.predictedClass} -> ${p.feedback.verifiedClass}`;
      confusionPairs[k] = (confusionPairs[k] ?? 0) + 1;
    }
  }

  const withFeedback = preds.filter((p) => p.feedback);
  const disagreements = withFeedback.filter((p) => p.feedback?.verdict === "disagree");
  const verified = preds.filter((p) => p.feedback?.reviewStatus === "VERIFIED");
  const verifiedCorrect = verified.filter((p) => p.feedback?.isCorrect === true);

  // Lab (held-out acceptance) vs field (verified feedback) comparison across
  // every model version — lab-only and field-only models included so reviewers
  // see coverage gaps, not just overlap.
  const modelRows = await prisma.modelVersion.findMany({ include: { dataset: true } });
  const labVsField = modelRows.map((m) => {
    const f = byModel[m.version];
    const verifiedTotal = f?.verified_total ?? 0;
    const verifiedCorrectN = f?.verified_correct ?? 0;
    return {
      version: m.version,
      is_active: m.isActive,
      lifecycle_status: m.lifecycleStatus,
      dataset_version: m.dataset?.version ?? null,
      lab: {
        accuracy: m.accuracy,
        f1_score: m.f1Score,
        acceptance_verdict: m.acceptanceVerdict ?? null,
      },
      field: {
        predictions: f?.predictions ?? 0,
        feedback_count: f?.feedback_count ?? 0,
        disagreements: f?.disagreements ?? 0,
        verified_total: verifiedTotal,
        verified_accuracy: verifiedTotal > 0
          ? Math.round((100 * verifiedCorrectN) / verifiedTotal) : null,
        verified_wrong: f?.verified_corrections ?? 0,
        average_confidence: f?.avg_confidence ?? null,
        low_confidence_rate: f?.low_confidence_rate ?? null,
      },
    };
  });

  res.json({
    total_predictions: preds.length,
    baseline_note: "Baseline being established — no alert thresholds are validated yet.",
    lab_vs_field: labVsField,
    overall: {
      avg_confidence: preds.length && preds.filter(p=>p.confidence!=null).length
        ? Math.round((preds.reduce((a,p)=>a+(p.confidence??0),0)/preds.filter(p=>p.confidence!=null).length)*1000)/1000
        : null,
      low_confidence_pct: preds.length ? Math.round((100*preds.filter((p)=>(p.confidence??1)<0.5).length)/preds.length) : null,
      feedback_pct: preds.length ? Math.round((100*withFeedback.length)/preds.length) : null,
      disagreement_pct: withFeedback.length ? Math.round((100*disagreements.length)/withFeedback.length) : null,
      // Verified accuracy reported ONLY over expert-verified cases:
      verified_accuracy: verified.length
        ? Math.round((100 * verifiedCorrect.length) / verified.length) : null,
      verified_accuracy_note: verified.length
        ? "Computed ONLY over expert-verified cases."
        : "No verified cases yet — application accuracy cannot be calculated.",
    },
    by_model: byModel,
    real_world_confusion_pairs_verified: confusionPairs,
    review_backlog: await prisma.feedback.count({ where: { reviewStatus: "SUBMITTED" } }),
  });
});

export default router;
