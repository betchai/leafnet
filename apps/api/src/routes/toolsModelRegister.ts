// TOOLS + PIPELINE: registers evaluated candidates as ModelVersion rows.
// Called by the Python pipeline after Step 11 so handoff is automatic.
// NOTE: this NEVER sets isActive — promotion remains a human decision.
import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { requireServiceToken } from "../auth/middleware.js";

const prisma = new PrismaClient();
const router = Router();

router.post("/register", requireServiceToken, async (req, res) => {
  const { versionLabel, experimentId, architecture, framework, trainedAt, notes } = req.body ?? {};
  const missing = [versionLabel, experimentId].filter((v) => !v);
  if (missing.length) return res.status(400).json({ error: `missing: ${missing.join(", ")}` });

  const ds = await prisma.dataset.findUnique({ where: { version: versionLabel } });
  if (!ds) return res.status(404).json({ error: `dataset version ${versionLabel} not found` });

  const mvVersion = `${versionLabel}_${experimentId}`;
  const mv = await prisma.modelVersion.upsert({
    where: { version: mvVersion },
    create: {
      version: mvVersion,
      architecture: architecture ?? "mobilenet_v2",
      datasetId: ds.id,
      artifactPath: `ml/models/${mvVersion}/model_best.pt`,
      framework: framework ?? null,
      trainingDate: trainedAt ? new Date(trainedAt) : new Date(),
      // Real metrics copied from the evaluation result if provided
      ...(typeof req.body.accuracy === "number" ? { accuracy: req.body.accuracy } : {}),
      ...(typeof req.body.f1Score === "number" ? { f1Score: req.body.f1Score } : {}),
      ...(req.body.confusionMatrix ? { confusionMatrix: req.body.confusionMatrix } : {}),
      acceptanceVerdict: typeof req.body.acceptanceVerdict === "string" ? req.body.acceptanceVerdict : null,
      notes: notes ?? "registered by pipeline runner",
    },
    update: {
      accuracy: typeof req.body.accuracy === "number" ? req.body.accuracy : undefined,
      f1Score: typeof req.body.f1Score === "number" ? req.body.f1Score : undefined,
      confusionMatrix: req.body.confusionMatrix ?? undefined,
      acceptanceVerdict: typeof req.body.acceptanceVerdict === "string" ? req.body.acceptanceVerdict : undefined,
    },
  });
  res.status(201).json({ registered: mv.version });
});

export default router;
