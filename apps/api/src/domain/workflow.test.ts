import { describe, it, expect } from "vitest";
import {
  validateTransition,
  validatePreliminaryAnnotation,
  AnnotationStatus,
} from "./workflow.js";

const base = {
  currentStatus: "ANNOTATED" as AnnotationStatus,
  actorRole: "expert" as const,
  hasPreliminaryLabel: true,
};

describe("annotation workflow state machine", () => {
  it("expert confirm on annotated image -> APPROVED", () => {
    expect(
      validateTransition({ ...base, action: "confirm", newLabel: "healthy" }).newStatus
    ).toBe("APPROVED");
  });

  it("expert relabel -> EXPERT_REVIEWED with new label", () => {
    expect(
      validateTransition({ ...base, action: "relabel", newLabel: "leaf_spot" }).newStatus
    ).toBe("EXPERT_REVIEWED");
  });

  it("annotator role is forbidden from review actions", () => {
    expect(() =>
      validateTransition({ ...base, action: "confirm", actorRole: "annotator" })
    ).toThrowError(/expert/i);
  });

  it("system role can never drive transitions (AI cannot create ground truth)", () => {
    expect(() =>
      validateTransition({ ...base, action: "confirm", actorRole: "system" })
    ).toThrowError();
  });

  it("cannot approve without a preliminary label", () => {
    expect(() =>
      validateTransition({
        ...base,
        currentStatus: "ANNOTATED",
        action: "confirm",
        hasPreliminaryLabel: false,
      })
    ).toThrowError(/preliminary/i);
  });

  it("relabel requires a label", () => {
    expect(() => validateTransition({ ...base, action: "relabel" })).toThrowError(
      /newLabel/
    );
  });

  it("APPROVED is terminal", () => {
    expect(() =>
      validateTransition({ ...base, currentStatus: "APPROVED", action: "confirm" })
    ).toThrowError(/terminal/i);
  });

  it("REJECTED is terminal", () => {
    expect(() =>
      validateTransition({ ...base, currentStatus: "REJECTED", action: "relabel", newLabel: "healthy" })
    ).toThrowError(/terminal/i);
  });

  it("uncertain images may be relabeled by an expert but never auto-approved", () => {
    const r = validateTransition({
      ...base,
      currentStatus: "UNCERTAIN",
      action: "relabel",
      newLabel: "leaf_rust",
    });
    expect(r.newStatus).toBe("EXPERT_REVIEWED"); // still requires another review pass
    expect(r.newStatus).not.toBe("APPROVED");
  });

  it("mark_uncertain allowed from early states", () => {
    expect(
      validateTransition({ ...base, currentStatus: "NEEDS_REVIEW", action: "mark_uncertain" }).newStatus
    ).toBe("UNCERTAIN");
  });

  it("second opinion routes back for more review, not approval", () => {
    expect(
      validateTransition({ ...base, action: "second_opinion" }).newStatus
    ).toBe("SECOND_OPINION");
  });

  it("preliminary annotation only from pre-annotation states", () => {
    expect(() => validatePreliminaryAnnotation("UNLABELED")).not.toThrow();
    expect(() => validatePreliminaryAnnotation("NEEDS_REVIEW")).not.toThrow();
    expect(() => validatePreliminaryAnnotation("ANNOTATED")).toThrowError();
    expect(() => validatePreliminaryAnnotation("APPROVED")).toThrowError();
  });
});
