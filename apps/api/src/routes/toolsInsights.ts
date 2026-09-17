// TOOLS/INSIGHTS: research insights orchestration.
// Proxies model/dataset insights from the Python analytics engine and adds
// APPLICATION insights computed from the Node-owned database (kept separate
// from research metrics per Phase 9 rule 23).
import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { authorize } from "../auth/middleware.js";

const prisma = new PrismaClient();
const router = Router();
const ml = () => process.env.ML_SERVICE_URL ?? "";

router.get("/", authorize("insights"), async (req, res) => {
  // Default to the ACTIVE model's dataset lineage when the caller doesn't pin
  // one — evaluation artifacts are keyed by that dataset's version (e.g. V1.0).
  // Fall back to the most recently cut dataset, then to a safe placeholder.
  const active = await prisma.modelVersion.findFirst({
    where: { isActive: true },
    include: { dataset: true },
  });
  const latest = await prisma.dataset.findFirst({ orderBy: { createdAt: "desc" } });
  const fallback = active?.dataset ?? latest;
  const version = (req.query.dataset_version as string) ?? fallback?.version ?? "v0.2";
  const datasetId = (req.query.dataset_id as string) ?? fallback?.id ?? "";
  try {
    const r = await fetch(`${ml()}/insights?dataset_version=${encodeURIComponent(version)}&dataset_id=${encodeURIComponent(datasetId)}`);
    if (!r.ok) return res.status(r.status).json(await r.json());
    const research = await r.json();

    // ---- Application insights (from Postgres; separate from research data) ----
    const preds = await prisma.prediction.findMany({
      where: { isPlaceholder: false },
      include: { feedback: true, image: { select: { backgroundType: true } } },
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

    // ---- Distribution-shift (covariate/OOD) application insight ----
    // The in-situ (natural-background) analyzer predictions are the growing OOD
    // pool. Cross-reference background_type x feedback verdict; verified
    // corrections on natural-background images are the labeled OOD signal.
    const byBg: Record<string, { total: number; disagree: number; agree: number }> = {};
    for (const p of preds) {
      const bg = p.image?.backgroundType ?? "unknown";
      byBg[bg] ??= { total: 0, disagree: 0, agree: 0 };
      byBg[bg].total++;
      if (p.feedback) {
        if (p.feedback.verdict === "disagree") byBg[bg].disagree++;
        else if (p.feedback.verdict === "agree") byBg[bg].agree++;
      }
    }
    const natural = byBg["natural"];
    const verifiedCorrections = withFeedback.filter(
      (p) =>
        p.image?.backgroundType === "natural" &&
        p.feedback?.reviewStatus === "VERIFIED"
    ).length;

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
      // Covariate-shift (OOD) pool: live analyzer uploads with natural background
      distribution_shift: {
        by_background_type: byBg,
        natural_ood: {
          total_predictions: natural?.total ?? 0,
          disagreement_rate: natural?.total
            ? Math.round((100 * (natural?.disagree ?? 0)) / natural.total)
            : null,
          verified_corrected_labels: verifiedCorrections,
          note: natural?.total
            ? `Live in-situ (natural-background) uploads serve as the growing OOD pool. Verified corrections (${verifiedCorrections}) become labeled OOD candidate data.`
            : "No natural-background (in-situ) analyzer predictions yet — the OOD pool is empty. Add live in-situ uploads and verify corrections to build it.",
        },
      },
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
