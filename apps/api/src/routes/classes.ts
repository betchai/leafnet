import { Router } from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const router = Router();

/**
 * Returns the leaf-health class definitions.
 *
 * Source of truth is the ML-side config (ml/src/config/classes.yaml).
 * We load the same file here so frontend, API and ML never drift apart.
 * If the config file is missing we fail loudly rather than inventing classes.
 */
router.get("/", (_req, res) => {
  try {
    const configPath = path.resolve(
      process.cwd(),
      "../../ml/src/config/classes.json"
    );
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    res.json(config);
  } catch {
    res.status(500).json({
      error:
        "Class configuration not found. Expected ml/src/config/classes.json — see docs/dataset.md.",
    });
  }
});

export default router;
