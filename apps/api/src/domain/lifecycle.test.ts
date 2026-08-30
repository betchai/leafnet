/* Phase 9.1 domain tests: model lifecycle + feedback review workflow. */
import { describe, it, expect } from "vitest";
import {
  validateLifecycleTransition, canActivate,
  validateFeedbackReview,
} from "../domain/lifecycle.js";

describe("model lifecycle", () => {
  const happy: [string, string][] = [
    ["experimental", "evaluated"],
    ["evaluated", "candidate"],
    ["candidate", "approved"],
    ["approved", "active"],
    ["active", "retired"],
  ];
  it.each(happy)("allows %s -> %s", (from, to) => {
    expect(() =>
      validateLifecycleTransition(from as never, to as never)
    ).not.toThrow();
  });

  it("refuses skipping stages (experimental -> active)", () => {
    expect(() => validateLifecycleTransition("experimental" as never, "active" as never)).toThrow();
  });

  it("only approved models can become active", () => {
    expect(canActivate("approved")).toBe(true);
    expect(canActivate("candidate")).toBe(false);
    expect(canActivate("experimental")).toBe(false);
  });

  it("retired is terminal", () => {
    expect(() => validateLifecycleTransition("retired" as never, "active" as never)).toThrow();
  });
});

describe("feedback review workflow", () => {
  const base = { reviewerRole: "expert" };

  it("start_review moves SUBMITTED -> UNDER_REVIEW", () => {
    const r = validateFeedbackReview({ ...base, action: "start_review", currentStatus: "SUBMITTED" });
    expect(r.newStatus).toBe("UNDER_REVIEW");
  });

  it("verify requires a class label", () => {
    expect(() =>
      validateFeedbackReview({ ...base, action: "verify", currentStatus: "UNDER_REVIEW" })
    ).toThrow(/label/);
  });

  it("verify with label -> VERIFIED", () => {
    const r = validateFeedbackReview({
      ...base, action: "verify", currentStatus: "UNDER_REVIEW", verifiedClass: "leaf_spot",
    });
    expect(r.newStatus).toBe("VERIFIED");
    expect(r.verifiedClass).toBe("leaf_spot");
  });

  it("annotator role cannot review feedback", () => {
    expect(() =>
      validateFeedbackReview({
        ...base, action: "verify", currentStatus: "ANNOTATED" as never,
        verifiedClass: "healthy", reviewerRole: "annotator",
      })
    ).toThrow();
  });

  it("reject allowed from submitted; verified is terminal for review actions", () => {
    expect(validateFeedbackReview({ ...base, action: "reject", currentStatus: "SUBMITTED" }).newStatus).toBe("REJECTED");
    expect(() =>
      validateFeedbackReview({ ...base, action: "verify", currentStatus: "VERIFIED", verifiedClass: "healthy" })
    ).toThrow(/not allowed/);
  });
});
