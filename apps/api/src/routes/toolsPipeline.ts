// TOOLS + PIPELINE: thin HTTP proxy to the Python ML service pipeline endpoints.
// The Node API never spawns Python — it forwards like every other ML call.
import { Router } from "express";

const router = Router();
const ml = () => process.env.ML_SERVICE_URL ?? "";

router.post("/start", async (req, res) => {
  try {
    const r = await fetch(`${ml()}/pipeline/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    res.status(r.status).json(await r.json());
  } catch {
    res.status(503).json({
      error: "ML service unreachable. Start it: cd ml && .venv/bin/python -m uvicorn src.inference.service:app --port 8000",
    });
  }
});

router.get("/status/:jobId", async (req, res) => {
  try {
    const r = await fetch(`${ml()}/pipeline/status/${req.params.jobId}`);
    res.status(r.status).json(await r.json());
  } catch {
    res.status(503).json({ error: "ML service unreachable." });
  }
});

router.get("/jobs", async (_req, res) => {
  try {
    const r = await fetch(`${ml()}/pipeline/jobs`);
    res.status(r.status).json(await r.json());
  } catch {
    res.status(503).json({ error: "ML service unreachable." });
  }
});

export default router;
