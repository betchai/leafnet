import { Router } from "express";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const router = Router();

/**
 * Returns the leaf-health class definitions.
 *
 * Source of truth is the ML-side config (ml/src/config/classes.json).
 * We load the same file here so frontend, API and ML never drift apart.
 * If the config file is missing we fail loudly rather than inventing classes.
 */
function resolveConfigPath(): string {
  const candidates = [
    path.resolve(process.cwd(), "ml/src/config/classes.json"),
    path.resolve(process.cwd(), "../../ml/src/config/classes.json"),
    path.resolve(process.cwd(), "../ml/src/config/classes.json"),
  ];
  const p = candidates.find((c) => existsSync(c));
  if (!p) throw new Error("classes.json not found; tried:\n" + candidates.join("\n"));
  return p;
}

router.get("/", (_req, res) => {
  try {
    res.json(JSON.parse(readFileSync(resolveConfigPath(), "utf-8")));
  } catch {
    res.status(500).json({
      error:
        "Class configuration not found. Expected ml/src/config/classes.json — see docs/dataset.md.",
    });
  }
});

export default router;
