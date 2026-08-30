import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "leafnet-api",
    // The ML service is a separate Python process; it is NOT implemented yet.
    mlServiceConnected: false,
    time: new Date().toISOString(),
  });
});

export default router;
