import { describe, it, expect } from "vitest";
import {
  buildCutWhere,
  buildApprovedClassWhere,
  cutSourcesSnapshot,
} from "./datasetCut.js";

describe("dataset cut provenance filter", () => {
  it("defaults to all approved non-dev images when no filter is given", () => {
    expect(buildCutWhere(undefined, undefined)).toEqual({
      isDevFixture: false,
      annotationStatus: "APPROVED",
    });
  });

  it("restricts membership to the given sources", () => {
    expect(buildCutWhere(["raw-2026-09", "lab-scan-2"], undefined)).toEqual({
      isDevFixture: false,
      annotationStatus: "APPROVED",
      source: { in: ["raw-2026-09", "lab-scan-2"] },
    });
  });

  it("restricts membership to a single sourceType", () => {
    expect(buildCutWhere(undefined, "field_photo")).toEqual({
      isDevFixture: false,
      annotationStatus: "APPROVED",
      sourceType: "field_photo",
    });
  });

  it("combines sources and sourceType", () => {
    expect(buildCutWhere(["raw-2026-09"], "field_photo")).toEqual({
      isDevFixture: false,
      annotationStatus: "APPROVED",
      source: { in: ["raw-2026-09"] },
      sourceType: "field_photo",
    });
  });

  it("drops empty/invalid entries instead of failing", () => {
    expect(buildCutWhere(["", "raw-2026-09", 42, null], "  ")).toEqual({
      isDevFixture: false,
      annotationStatus: "APPROVED",
      source: { in: ["raw-2026-09"] },
    });
  });

  it("records the filter used for auditability", () => {
    const s = cutSourcesSnapshot(["raw-2026-09"], "field_photo");
    expect(s.filter).toEqual({
      sources: ["raw-2026-09"],
      sourceType: "field_photo",
      additionalApprovedClasses: null,
    });
    expect(s.note).toMatch(/null = all APPROVED/i);
  });
});

describe("dataset cut approved-class merge", () => {
  it("selects approved non-dev images of the requested classes", () => {
    expect(buildApprovedClassWhere(["healthy"])).toEqual({
      isDevFixture: false,
      annotationStatus: "APPROVED",
      classifications: { some: { classKey: { in: ["healthy"] } } },
    });
  });

  it("returns null when no valid class keys are given", () => {
    expect(buildApprovedClassWhere(undefined)).toBeNull();
    expect(buildApprovedClassWhere([""])).toBeNull();
    expect(buildApprovedClassWhere([42])).toBeNull();
  });

  it("drops invalid keys and keeps valid ones", () => {
    expect(buildApprovedClassWhere(["healthy", 42, " "])).toEqual({
      isDevFixture: false,
      annotationStatus: "APPROVED",
      classifications: { some: { classKey: { in: ["healthy"] } } },
    });
  });

  it("records the merged classes in the audit snapshot", () => {
    const s = cutSourcesSnapshot(["raw-2026-09"], "lab_scan", ["healthy"]);
    expect(s.filter).toEqual({
      sources: ["raw-2026-09"],
      sourceType: "lab_scan",
      additionalApprovedClasses: ["healthy"],
    });
  });
});