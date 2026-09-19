/**
 * Taxonomy enforcement.
 *
 * The ONLY valid classification labels are the approved keys from
 * ml/src/config/classes.json. Arbitrary class names are rejected everywhere.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface ClassDef {
  key: string;
  id: number;
  label: string;
  description?: string;
  enabled?: boolean;
}

let cached: { classes: ClassDef[]; keys: Set<string> } | null = null;

function loadConfig(): { classes: ClassDef[]; keys: Set<string> } {
  if (cached) return cached;
  // Works when run from apps/api (dev server) or repo root
  const candidates = [
    path.resolve(process.cwd(), "ml/src/config/classes.json"),
    path.resolve(process.cwd(), "../../ml/src/config/classes.json"),
    path.resolve(process.cwd(), "../ml/src/config/classes.json"),
  ];
  const configPath = candidates.find((p) => existsSync(p));
  if (!configPath) {
    throw new Error(
      `classes.json not found; tried:\n${candidates.join("\n")}`
    );
  }
  const raw = JSON.parse(readFileSync(configPath, "utf-8"));
  const classes: ClassDef[] = raw.classes.filter(
    (c: ClassDef & { enabled?: boolean }) => c.enabled !== false
  );
  if (classes.length !== 5) {
    throw new Error(
      `Taxonomy integrity violation: expected exactly 5 enabled classes (4 mulberry conditions + not_mulberry rejection), found ${classes.length}`
    );
  }
  return (cached = { classes, keys: new Set(classes.map((c) => c.key)) });
}

export function getClasses(): ClassDef[] {
  return loadConfig().classes;
}

/** Throws on any label outside the approved taxonomy. */
export function assertValidClassKey(key: string): void {
  if (!loadConfig().keys.has(key)) {
    throw Object.assign(
      new Error(
        `Invalid class key "${key}". Allowed: ${[...loadConfig().keys].join(", ")}`
      ),
      { code: "INVALID_CLASS_KEY" }
    );
  }
}

export function isValidClassKey(key: string): boolean {
  try {
    assertValidClassKey(key);
    return true;
  } catch {
    return false;
  }
}
