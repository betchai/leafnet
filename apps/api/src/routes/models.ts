import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

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

export default router;
