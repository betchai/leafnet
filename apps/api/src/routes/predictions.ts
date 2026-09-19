import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import path from "node:path";
import { readFile } from "node:fs/promises";

import { authorize } from "../auth/middleware.js";

// BETA-MODEL: HTTP boundary to the Python ML service (Phase 7 contract).
const prisma = new PrismaClient();
const router = Router();

const ML_TIMEOUT_MS = 10_000;
interface InferenceResult {
  predictedClass: string;
  confidence: number;
  probabilities?: Record<string, number>;
  modelVersion?: string;
  reviewRecommended?: boolean;
}

function noServiceError() {
  return Object.assign(
    new Error("We couldn't analyze the image right now. Please try again later."),
    { code: "ML_SERVICE_UNAVAILABLE", status: 503 }
  );
}

async function requestInference(imagePath: string): Promise<InferenceResult> {
  const base = process.env.ML_SERVICE_URL;
  if (!base) throw noServiceError();

  const buffer = await readFile(path.resolve(imagePath));
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)]), path.basename(imagePath));

  let res: Response;
  try {
    res = await fetch(`${base}/predict`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(ML_TIMEOUT_MS),
    });
  } catch (err) {
    if ((err as Error).name === "TimeoutError") {
      throw Object.assign(new Error("Analysis timed out. Please try again."), {
        code: "ML_TIMEOUT", status: 504,
      });
    }
    throw noServiceError();
  }
  if (!res.ok) throw noServiceError();

  const data = await res.json();
  // Validate the ML response shape before trusting it
  if (
    typeof data.predicted_class !== "string" ||
    typeof data.confidence !== "number" ||
    typeof data.probabilities !== "object" ||
    !data.model_version
  ) {
    throw Object.assign(new Error("We couldn't analyze the image right now."), {
      code: "ML_INVALID_RESPONSE", status: 502,
    });
  }
  return {
    predictedClass: data.predicted_class,
    confidence: data.confidence,
    probabilities: data.probabilities,
    reviewRecommended: Boolean(data.review_recommended),
  };
}

interface ExplainResult {
  predictedClass: string;
  secondClass: string | null;
  saliencyBase64: string;
  criteria: {
    key: string;
    label: string;
    description: string;
    value: string | number | boolean;
    unit: string;
    supports: "top" | "second" | "inconclusive";
    supports_class?: string | null;
  }[];
}

async function requestExplain(imagePath: string): Promise<ExplainResult> {
  const base = process.env.ML_SERVICE_URL;
  if (!base) throw noServiceError();

  const buffer = await readFile(path.resolve(imagePath));
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)]), path.basename(imagePath));

  let res: Response;
  try {
    res = await fetch(`${base}/explain`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(ML_TIMEOUT_MS),
    });
  } catch (err) {
    if ((err as Error).name === "TimeoutError") {
      throw Object.assign(new Error("Explanation timed out. Please try again."), {
        code: "ML_TIMEOUT", status: 504,
      });
    }
    throw noServiceError();
  }
  if (!res.ok) throw noServiceError();

  const data = await res.json();
  if (typeof data.saliency_png_base64 !== "string" || typeof data.predicted_class !== "string") {
    throw Object.assign(new Error("Explanation unavailable right now."), {
      code: "ML_INVALID_RESPONSE", status: 502,
    });
  }
  const criteria = Array.isArray(data.criteria) ? data.criteria : [];
  return {
    predictedClass: data.predicted_class,
    secondClass: typeof data.second_class === "string" ? data.second_class : null,
    saliencyBase64: data.saliency_png_base64,
    criteria,
  };
}

// Simple in-memory rate limiter: 30 predictions / minute / IP
const hits = new Map<string, { count: number; reset: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.reset < now) {
    hits.set(ip, { count: 1, reset: now + 60_000 });
    return false;
  }
  entry.count++;
  return entry.count > 30;
}

/**
 * POST /api/predictions { imageId }
 * Orchestrates: fetch image → forward to ML service (timeout + validation)
 * → persist prediction with full probability distribution.
 */
// Whether the currently SERVED model already knows the not_mulberry rejection
// class. Cached briefly so the Analyzer banner doesn't hit the ML service per
// page view / analysis.
let servedCache: { at: number; classes: string[]; version: string | null } | null = null;

async function servedModelClasses(
  activeVersion: string | null
): Promise<{ classes: string[]; version: string | null }> {
  const base = process.env.ML_SERVICE_URL;
  if (!base) return { classes: [], version: activeVersion };
  if (servedCache && Date.now() - servedCache.at < 60_000) {
    return { classes: servedCache.classes, version: servedCache.version ?? activeVersion };
  }
  try {
    const res = await fetch(`${base}/model`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const info = (await res.json()) as {
        version_id?: string;
        classes?: Record<string, unknown> | unknown[];
      };
      const raw = info.classes;
      const classes = Array.isArray(raw)
        ? raw.map(String)
        : raw && typeof raw === "object"
          ? Object.keys(raw as Record<string, unknown>)
          : [];
      const version = info.version_id ?? null;
      servedCache = { at: Date.now(), classes, version };
      return { classes, version: version ?? activeVersion };
    }
  } catch {
    // ML unreachable — fall back to whatever we cached, or nothing.
  }
  return { classes: servedCache?.classes ?? [], version: servedCache?.version ?? activeVersion };
}

router.post("/", authorize("analyze"), async (req, res) => {
  const ip = req.ip ?? "unknown";
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests. Please wait a moment." });
  }

  const { imageId } = req.body ?? {};
  if (typeof imageId !== "string" || !imageId) {
    return res.status(400).json({ error: "imageId is required" });
  }

  const image = await prisma.image.findUnique({ where: { id: imageId } });
  if (!image) return res.status(404).json({ error: "Image not found" });

  const activeModel = await prisma.modelVersion.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });

  let result: InferenceResult;
  try {
    result = await requestInference(image.storagePath);
  } catch (err: unknown) {
    const e = err as { code?: string; status?: number; message?: string };
    return res.status(e.status ?? 503).json({ error: e.message ?? "Analysis failed." });
  }

  // Persist atomically enough: single Prediction row carries everything needed
  const prediction = await prisma.prediction.create({
    data: {
      imageId: image.id,
      modelVersionId: activeModel?.id ?? null,
      predictedClass: result.predictedClass,
      confidence: result.confidence,
      probabilities: result.probabilities ?? {},
      isPlaceholder: false,
    },
  });

  res.status(201).json({
    predictionId: prediction.id,
    predictedClass: result.predictedClass,
    confidence: result.confidence,
    probabilities: result.probabilities ?? {},
    reviewRecommended: result.reviewRecommended ?? false,
    modelVersion: activeModel?.version ?? null,
    disclaimer:
      "Visual classification suggestion only — not a laboratory diagnosis or definitive determination of biological cause.",
  });
});

// GET /api/predictions?limit=20 — prediction history (newest first)
router.get("/", authorize("analyze"), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const predictions = await prisma.prediction.findMany({
    where: { isPlaceholder: false },
    include: {
      image: { select: { filename: true } },
      modelVersion: { select: { version: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  res.json({
    items: predictions.map((p) => ({
      predictionId: p.id,
      imageId: p.imageId,
      filename: p.image.filename,
      predictedClass: p.predictedClass,
      confidence: p.confidence,
      modelVersion: p.modelVersion?.version ?? null,
      createdAt: p.createdAt,
    })),
    count: predictions.length,
  });
});

// GET /api/predictions/served — does the served model support the rejection
// class? Lets the Analyzer warn when a legacy 4-class model is still live.
router.get("/served", authorize("analyze"), async (_req, res) => {
  const active = await prisma.modelVersion.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });
  const { classes, version } = await servedModelClasses(active?.version ?? null);
  res.json({
    modelVersion: version,
    servedClassCount: classes.length,
    classes,
    rejectionEnabled: classes.includes("not_mulberry"),
  });
});

// POST /api/predictions/:id/explain — visual explanation (saliency heatmap)
router.post("/:id/explain", authorize("analyze"), async (req, res) => {
  const prediction = await prisma.prediction.findUnique({
    where: { id: req.params.id },
    include: { image: true },
  });
  if (!prediction) return res.status(404).json({ error: "Prediction not found" });

  try {
    const expl = await requestExplain(prediction.image.storagePath);
    res.json(expl);
  } catch (err: unknown) {
    const e = err as { code?: string; status?: number; message?: string };
    res.status(e.status ?? 503).json({ error: e.message ?? "Explanation unavailable." });
  }
});

// GET /api/predictions/:id
router.get("/:id", authorize("analyze"), async (req, res) => {
  const prediction = await prisma.prediction.findUnique({
    where: { id: req.params.id },
    include: { feedback: true, modelVersion: true },
  });
  if (!prediction) return res.status(404).json({ error: "Prediction not found" });
  res.json(prediction);
});

/**
 * POST /api/predictions/:id/feedback
 * Body: { verdict: "agree" | "disagree" | "unsure", correctedClass?, comment? }
 * Stored for future expert review (Phase 9.1) — never becomes ground truth automatically.
 */
router.post("/:id/feedback", authorize("analyze"), async (req, res) => {
  const { verdict, correctedClass, comment } = req.body ?? {};
  if (!["agree", "disagree", "unsure"].includes(verdict)) {
    return res.status(400).json({ error: 'verdict must be "agree", "disagree" or "unsure"' });
  }

  const prediction = await prisma.prediction.findUnique({
    where: { id: req.params.id },
  });
  if (!prediction) return res.status(404).json({ error: "Prediction not found" });

  const feedback = await prisma.feedback.upsert({
    where: { predictionId: prediction.id },
    create: {
      predictionId: prediction.id,
      verdict,
      isCorrect: verdict === "agree" ? true : verdict === "disagree" ? false : null,
      correctedClass: correctedClass ?? null,
      comment: comment ?? null,
    },
    update: {
      verdict,
      isCorrect: verdict === "agree" ? true : verdict === "disagree" ? false : null,
      correctedClass: correctedClass ?? null,
      comment: comment ?? null,
    },
  });
  res.status(201).json(feedback);
});

export default router;
