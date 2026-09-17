import { describe, expect, it } from "vitest";
import { CAPABILITY_ROLES, can, roleToActorRole, ROLES } from "./permissions.js";

describe("RBAC permission map", () => {
  it("defines exactly the three roles", () => {
    expect(ROLES).toEqual(["FARMER", "RESEARCHER", "EXPERT"]);
  });

  it("every capability has a non-empty role set", () => {
    for (const [cap, roles] of Object.entries(CAPABILITY_ROLES)) {
      expect(roles.length).toBeGreaterThan(0);
      // every listed role is a known role
      for (const r of roles) expect(ROLES).toContain(r);
      expect(cap).not.toBe("");
    }
  });

  it("analyzer capability is open to all roles", () => {
    expect(ROLES.every((r) => can(r, "analyze"))).toBe(true);
  });

  it("preliminary annotation and bulk ingest are researcher+expert only (no farmers)", () => {
    expect(can("FARMER", "annotate")).toBe(false);
    expect(can("RESEARCHER", "annotate")).toBe(true);
    expect(can("EXPERT", "annotate")).toBe(true);
    expect(can("FARMER", "bulk_ingest")).toBe(false);
    expect(can("RESEARCHER", "bulk_ingest")).toBe(true);
  });

  it("governance capabilities are expert-only", () => {
    for (const cap of [
      "expert_review",
      "feedback_review",
      "model_admin",
      "dataset_admin",
      "insights",
      "monitoring",
      "user_admin",
    ] as const) {
      expect(can("FARMER", cap)).toBe(false);
      expect(can("RESEARCHER", cap)).toBe(false);
      expect(can("EXPERT", cap)).toBe(true);
    }
  });

  it("maps app roles to annotation actor roles", () => {
    expect(roleToActorRole("EXPERT")).toBe("expert");
    expect(roleToActorRole("RESEARCHER")).toBe("annotator");
    expect(roleToActorRole("FARMER")).toBe("annotator");
  });
});