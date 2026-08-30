import { describe, it, expect } from "vitest";
import { isValidClassKey, getClasses } from "./taxonomy.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// process.cwd() is apps/api under vitest; repo root is two levels up
const ROOT = path.resolve(process.cwd(), "../..");

describe("taxonomy enforcement", () => {
  it("loads exactly the four approved classes", () => {
    const classes = getClasses();
    expect(classes.map((c) => c.key).sort()).toEqual(
      ["healthy", "leaf_blight", "leaf_rust", "leaf_spot"].sort()
    );
  });

  it("accepts each approved class key", () => {
    for (const key of ["healthy", "leaf_rust", "leaf_spot", "leaf_blight"]) {
      expect(isValidClassKey(key)).toBe(true);
    }
  });

  it("rejects arbitrary / legacy class names", () => {
    for (const bad of ["diseased", "nutrient_deficient", "damaged", "unknown", "", "Leaf Rust", "rust"]) {
      expect(isValidClassKey(bad)).toBe(false);
    }
  });

  it("config file has not drifted from the approved taxonomy", () => {
    const raw = JSON.parse(
      readFileSync(path.resolve(ROOT, "ml/src/config/classes.json"), "utf-8")
    );
    expect(raw.classes).toHaveLength(4);
    expect(raw.task.single_label ?? raw.task.type).toContain("single_label");
  });
});
