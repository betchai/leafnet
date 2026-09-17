/**
 * Phase 2 domain rules: dataset version cutting.
 *
 * A "cut" snapshots research images into a version. Membership is every
 * APPROVED non-dev image by default; optional provenance filters restrict the
 * cut to specific uploaded populations (raw in-situ batch, lab scans, ...) so
 * distinct imagery can be cut independently without mutating older versions.
 * Pure functions — enforced server-side by the route that calls them.
 */

import type { Prisma } from "@prisma/client";

export const APPROVED_STATUS = "APPROVED" as const;

/** Trim and drop empty strings; returns only non-empty string entries. */
function cleanStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Build the Prisma ImageWhereInput for a dataset cut from an optional
 * provenance filter. Returns only approved, non-dev images; when `sources`
 * (and/or `sourceType`) are given, membership is restricted to those
 * populations. Invalid/empty filter entries are dropped, never fatal.
 */
export function buildCutWhere(
  sources: unknown,
  sourceType: unknown,
): Prisma.ImageWhereInput {
  const where: Prisma.ImageWhereInput = {
    isDevFixture: false,
    annotationStatus: APPROVED_STATUS,
  };

  const cleanSources = cleanStrings(sources);
  if (cleanSources.length > 0) where.source = { in: cleanSources };

  const cleanType = typeof sourceType === "string" ? sourceType.trim() : "";
  if (cleanType.length > 0) where.sourceType = cleanType;

  return where;
}

/**
 * Where-input selecting all APPROVED non-dev images carrying a confirmed
 * classification in `classKeys` (e.g. reuse curated healthy photos whose raw
 * originals were discarded). Used to extend a cut's membership beyond the
 * source/sourceType-filtered raw population. Invalid class keys are dropped.
 */
export function buildApprovedClassWhere(
  classKeys: unknown,
): Prisma.ImageWhereInput | null {
  const clean = cleanStrings(classKeys);
  if (clean.length === 0) return null;
  return {
    isDevFixture: false,
    annotationStatus: APPROVED_STATUS,
    classifications: { some: { classKey: { in: clean } } },
  };
}

/** Snapshot of the filter used at cut time (auditability). */
export type CutSourcesSnapshot = {
  filter: {
    sources: string[] | null;
    sourceType: string | null;
    additionalApprovedClasses: string[] | null;
  };
  note: string;
};

export function cutSourcesSnapshot(
  sources: unknown,
  sourceType: unknown,
  additionalApprovedClasses: unknown = null,
): CutSourcesSnapshot {
  const cleanSources = cleanStrings(sources);
  const cleanType = typeof sourceType === "string" ? sourceType.trim() : "";
  const cleanClasses = cleanStrings(additionalApprovedClasses);
  return {
    filter: {
      sources: cleanSources.length > 0 ? cleanSources : null,
      sourceType: cleanType.length > 0 ? cleanType : null,
      additionalApprovedClasses: cleanClasses.length > 0 ? cleanClasses : null,
    },
    note: "Composition filter used at cut time; null = all APPROVED non-dev images.",
  };
}