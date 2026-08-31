import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { canActivate } from "../domain/lifecycle.js";

const prisma = new PrismaClient();
const router = Router();

const ml = () => process.env.ML_SERVICE_URL ?? "";

// GET /api/models — list model versions. Empty until a model is trained.
router.get("/", async (_req, res) => {
  const models = await prisma.modelVersion.findMany({
    orderBy: { createdAt: "desc" },
  });
  res.json({
    items: models,
    count: models.length,
    note:
      models.length === 0
        ? "No models exist yet. Model training happens in a later phase."
        : undefined,
  });
});

/**
 * GET /api/models/:id/detail — full performance record for one model version.
 * Pulls the Phase-9 evaluation artifacts (metrics, confusion, confidence/error,
 * improvement opportunities) and the test-split composition from the analytics
 * engine, so a reviewer can see HOW the numbers were computed and on WHAT data.
 */
router.get("/:id/detail", async (req, res) => {
  const m = await prisma.modelVersion.findUnique({
    where: { id: req.params.id },
    include: { dataset: true },
  });
  if (!m) return res.status(404).json({ error: "Model version not found" });

  const base = ml();
  if (!base) return res.status(503).json({ error: "Analytics service unavailable. Start the ML service on :8000." });

  const datasetVersion = m.dataset?.version ?? m.version.split("_")[0] ?? "v0.2";
  try {
    const r = await fetch(
      `${base}/insights?dataset_version=${encodeURIComponent(datasetVersion)}&dataset_id=${encodeURIComponent(m.datasetId ?? "")}`
    );
    if (!r.ok) return res.status(r.status).json(await r.json());
    const research = await r.json();
    const detail = research.models?.[m.version] ?? null;

    res.json({
      model: {
        id: m.id,
        version: m.version,
        modelVersion: m.version,
        lifecycleStatus: m.lifecycleStatus,
        isActive: m.isActive,
        architecture: m.architecture,
        datasetVersion,
        datasetId: m.datasetId,
        trainedAt: m.trainingDate,
        notes: m.notes,
        accuracy: m.accuracy,
        f1Score: m.f1Score,
      },
      detail,
      dataset: research.dataset ?? null,
      missing:
        detail === null
          ? "No recorded evaluation artifacts for this version (it was never evaluated by the pipeline)."
          : null,
    });
  } catch (err: unknown) {
    res.status(503).json({ error: `Analytics service unavailable: ${(err as Error).message}` });
  }
});

/**
 * POST /api/models/:id/activate  { actor, reason? }
 * EXPERT-ONLY activation. Requires the model to be lifecycle `approved` (the
 * approval step itself goes through /api/tools/models/:id/lifecycle). On
 * success: DB row becomes active (others deactivated) AND the ML service is
 * switched to serve it (active.json + in-process reload), fully audited.
 */
router.post("/:id/activate", async (req, res) => {
  const { actor, reason } = req.body ?? {};
  if (!actor) return res.status(400).json({ error: "actor is required (expert-only action)" });

  const m = await prisma.modelVersion.findUnique({ where: { id: req.params.id } });
  if (!m) return res.status(404).json({ error: "Model version not found" });

  if (!canActivate(m.lifecycleStatus as never)) {
    return res.status(409).json({
      error: `Only APPROVED models can be activated (current: ${m.lifecycleStatus}). Promote to approved first.`,
    });
  }

  const base = ml();
  if (!base) return res.status(503).json({ error: "ML service unavailable. Start it on :8000." });

  let mlResult: { model_version: string; sha256_prefix: string; pilot: boolean };
  try {
    const r = await fetch(`${base}/models/${encodeURIComponent(m.version)}/activate`, { method: "POST" });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      return res.status(502).json({ error: `ML activation rejected: ${d.detail ?? r.status}` });
    }
    mlResult = await r.json();
  } catch (err: unknown) {
    return res.status(502).json({ error: `ML activation failed: ${(err as Error).message}` });
  }

  await prisma.modelVersion.updateMany({ data: { isActive: false } });
  const updated = await prisma.modelVersion.update({
    where: { id: m.id },
    data: { lifecycleStatus: "active", isActive: true },
  });

  await prisma.systemAudit.create({
    data: {
      actor,
      action: "model_activation",
      objectType: "ModelVersion",
      objectId: m.id,
      previousState: { lifecycleStatus: m.lifecycleStatus, isActive: m.isActive },
      newState: { lifecycleStatus: updated.lifecycleStatus, isActive: true, servedModelVersion: mlResult.model_version },
      reason: reason ?? null,
    } as never,
  });

  res.json({
    ok: true,
    model_version: updated.version,
    served_model_version: mlResult.model_version,
    sha256_prefix: mlResult.sha256_prefix,
    pilot: mlResult.pilot,
  });
});

export default router;