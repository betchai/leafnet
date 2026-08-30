// TOOLS/INSIGHTS: research insights orchestration.
// Proxies model/dataset insights from the Python analytics engine and adds
// APPLICATION insights computed from the Node-owned database (kept separate
// from research metrics per Phase 9 rule 23).
import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();
const ml = () => process.env.ML_SERVICE_URL ?? "";

router.get("/", async (req, res) => {
  const version = (req.query.dataset_version as string) ?? "v0.2";
  try {
    const r = await fetch(`${ml()}/insights?dataset_version=${encodeURIComponent(version)}&dataset_id=${req.query.dataset_id ?? ""}`);
    if (!r.ok) return res.status(r.status).json(await r.json());
    const research = await r.json();

    // ---- Application insights (from Postgres; separate from research data) ----
    const preds = await prisma.prediction.findMany({
      where: { isPlaceholder: false },
      include: { feedback: true },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });
    const perClass: Record<string, number> = {};
    for (const p of preds) {
      if (p.predictedClass) perClass[p.predictedClass] = (perClass[p.predictedClass] ?? 0) + 1;
    }
    const withFeedback = preds.filter((p) => p.feedback);
    const disagreements = withFeedback.filter((p) => p.feedback?.verdict === "disagree");
    const lowConfidence = preds.filter((p) => (p.confidence ?? 1) < 0.5);

    const application = {
      total_predictions: preds.length,
      note: preds.length < 30
        ? "Insufficient application data to establish this insight."
        : null,
      predictions_per_class: perClass,
      low_confidence_rate:
        preds.length ? Math.round((100 * lowConfidence.length) / preds.length) : null,
      feedback_rate:
        preds.length ? Math.round((100 * withFeedback.length) / preds.length) : null,
      disagreement_rate:
        withFeedback.length ? Math.round((100 * disagreements.length) / withFeedback.length) : null,
      label: "Application Data",
    };

    res.json({
      dataset_version: version,
      dataset: research.dataset ?? null,
      research,
      application,
    });
  } catch {
    res.status(503).json({
      error: "Analytics service unavailable. Start the ML service on :8000.",
    });
  }
});

export default router;
