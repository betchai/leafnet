import { describe, it, expect } from "vitest";
import { computeComposition, ImageRow } from "./composition.js";

function row(status: string, cls?: string, fixture = false): ImageRow {
  return {
    annotationStatus: status,
    isDevFixture: fixture,
    classification: cls ? { classKey: cls } : null,
  };
}

describe("dataset composition tracking", () => {
  it("reports honest zeros on an empty dataset", () => {
    const c = computeComposition([]);
    expect(c.research.totalAcquired).toBe(0);
    expect(c.research.approved).toBe(0);
    expect(c.devFixtures).toBe(0);
    expect(c.note).toMatch(/not.*populated|no research images/i);
    for (const cls of ["healthy", "leaf_rust", "leaf_spot", "leaf_blight", "not_mulberry"]) {
      expect(c.perClass[cls].approved).toBe(0);
    }
  });

  it("counts statuses correctly", () => {
    const c = computeComposition([
      row("UNLABELED"),
      row("ANNOTATED", undefined),
      row("EXPERT_REVIEWED"),
      row("APPROVED", "healthy"),
      row("REJECTED", "leaf_rust"),
      row("UNCERTAIN"),
      row("SECOND_OPINION"),
      row("NEEDS_REVIEW"),
    ]);
    expect(c.research.totalAcquired).toBe(8);
    expect(c.research.annotated).toBe(1);
    expect(c.research.expertVerified).toBe(1);
    expect(c.research.approved).toBe(1);
    expect(c.research.rejected).toBe(1);
    expect(c.research.uncertain).toBe(1);
  });

  it("dev fixtures are NEVER counted as research data", () => {
    const c = computeComposition([
      row("APPROVED", "healthy", true),
      row("APPROVED", "healthy", true),
      row("APPROVED", "healthy"),
    ]);
    expect(c.devFixtures).toBe(2);
    expect(c.research.approved).toBe(1);
    expect(c.perClass.healthy.approved).toBe(1);
  });

  it("tracks per-class lifecycle counts", () => {
    const c = computeComposition([
      row("ANNOTATED", "healthy"),
      row("APPROVED", "healthy"),
      row("UNCERTAIN", "leaf_rust"),
      row("REJECTED", "leaf_spot"),
    ]);
    // 'annotated' includes everything at or beyond preliminary annotation
    expect(c.perClass.healthy).toMatchObject({ annotated: 2, verified: 1, approved: 1 });
    expect(c.perClass.healthy.acquired).toBe(2);
    expect(c.perClass.leaf_rust.uncertain).toBe(1);
    expect(c.perClass.leaf_spot.rejected).toBe(1);
    expect(c.perClass.leaf_blight.acquired).toBe(0);
  });

  it("flags imbalance without suggesting duplication", () => {
    const rows = [
      ...Array.from({ length: 60 }, () => row("APPROVED", "healthy")),
      ...Array.from({ length: 10 }, () => row("APPROVED", "leaf_rust")),
    ];
    const c = computeComposition(rows);
    // includes zero-approved classes in the spread
    expect(c.classImbalanceApproved).toBe(60);
    expect(c.balanceWarning).toMatch(/never duplicate/i);
  });
});
