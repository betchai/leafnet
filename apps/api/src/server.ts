import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";

import healthRoutes from "./routes/health.js";
import classRoutes from "./routes/classes.js";
import imageRoutes from "./routes/images.js";
import predictionRoutes from "./routes/predictions.js";
import modelRoutes from "./routes/models.js";
import datasetRoutes from "./routes/datasets.js";
import annotationRoutes from "./routes/annotations.js";
import datasetStatusRoutes from "./routes/datasetStatus.js";
import datasetManifestRoutes from "./routes/datasetManifest.js";
import toolsBulkIngestRoutes from "./routes/toolsBulkIngest.js"; // TOOLS
import toolsPipelineRoutes from "./routes/toolsPipeline.js"; // TOOLS + PIPELINE
import toolsModelRegisterRoutes from "./routes/toolsModelRegister.js"; // TOOLS + PIPELINE
import toolsInsightsRoutes from "./routes/toolsInsights.js"; // INSIGHTS
import toolsFeedbackReviewRoutes from "./routes/toolsFeedbackReview.js"; // PHASE 9.1
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";

const app = express();
const PORT = Number(process.env.API_PORT ?? 4000);

// Production security: explicit CORS (set WEB_ORIGIN in production), secure headers
const allowedOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:5173,http://localhost:5174").split(",");
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(helmet());
app.use(express.json({ limit: "1mb" }));

// Request-ID + logging for traceability
app.use((req, res, next) => {
  const id = Math.random().toString(36).slice(2, 10);
  (req as any).requestId = id;
  res.setHeader("X-Request-Id", id);
  const t0 = Date.now();
  res.on("finish", () =>
    console.log(`${id} ${req.method} ${req.path} ${res.statusCode} ${Date.now() - t0}ms`));
  next();
});

// Safety nets: an unexpected async failure must degrade one request,
// never terminate the whole API process.
process.on("unhandledRejection", (reason) =>
  console.error("[api] unhandled rejection:", reason));
process.on("uncaughtException", (err) => {
  console.error("[api] uncaught exception:", err);
});

// Async-route wrapper: Express 4 does not catch rejected promises.
const aw = (fn: express.RequestHandler): express.RequestHandler =>
  (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.use("/api/health", healthRoutes);
app.use("/api/classes", classRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/images", imageRoutes);
app.use("/api/predictions", predictionRoutes);
app.use("/api/models", modelRoutes);
app.use("/api/datasets", datasetRoutes);
app.use("/api/datasets", datasetStatusRoutes);
app.use("/api/datasets", datasetManifestRoutes);
app.use("/api", annotationRoutes);
app.use("/api/tools", toolsBulkIngestRoutes); // TOOLS
app.use("/api/tools/pipeline", toolsPipelineRoutes); // TOOLS + PIPELINE
app.use("/api/tools/models", toolsModelRegisterRoutes); // TOOLS + PIPELINE
app.use("/api/insights", toolsInsightsRoutes); // INSIGHTS
app.use("/api/tools", toolsFeedbackReviewRoutes); // PHASE 9.1 feedback review + monitoring + lifecycle

// ── Production: serve the React frontend from the same origin ───────────
// In production the built React app lives at apps/web/dist relative to the
// repo root. The frontend uses relative /api paths, so both must share an
// origin. In development, Vite's dev server proxies /api to this port.
if (process.env.NODE_ENV === "production") {
  const __filename = fileURLToPath(import.meta.url);
  const apiDistDir = path.dirname(__filename);
  const webDist = path.resolve(apiDistDir, "../../apps/web/dist");

  app.use(express.static(webDist));

  // SPA fallback: any non-API request that didn't match a static file
  // returns index.html so React Router handles the route client-side.
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
}

// Central error handler: no stack traces to clients
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[api] unhandled error:", err);
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error." });
  }
});


app.listen(PORT, () => {
  console.log(`[api] Mulberry Leaf Intelligence API listening on :${PORT}`);
});
