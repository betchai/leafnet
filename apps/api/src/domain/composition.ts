/**
 * Dataset composition tracking (Phase 3 §11–12).
 *
 * Pure aggregation over image rows — no DB access, fully unit-testable.
 * Dev fixtures are ALWAYS reported separately and never counted as research data.
 */

export interface ImageRow {
  annotationStatus: string;
  isDevFixture: boolean;
  classification?: { classKey: string } | null;
}

const RESEARCH_TARGET = { total: 2000, perClass: 500 };

export function computeComposition(images: ImageRow[]) {
  const research = images.filter((i) => !i.isDevFixture);
  const byStatus = countBy(research, (i) => i.annotationStatus);

  const classes = ["healthy", "leaf_rust", "leaf_spot", "leaf_blight"];
  const perClass: Record<
    string,
    { acquired: number; annotated: number; verified: number; approved: number; rejected: number; uncertain: number }
  > = {};

  for (const cls of classes) {
    const rows = research.filter((i) => i.classification?.classKey === cls);
    perClass[cls] = {
      acquired: rows.length,
      annotated: rows.filter((i) =>
        ["ANNOTATED", "EXPERT_REVIEWED", "APPROVED"].includes(i.annotationStatus)
      ).length,
      verified: rows.filter((i) =>
        ["EXPERT_REVIEWED", "APPROVED"].includes(i.annotationStatus)
      ).length,
      approved: rows.filter((i) => i.annotationStatus === "APPROVED").length,
      rejected: rows.filter((i) => i.annotationStatus === "REJECTED").length,
      uncertain: rows.filter((i) => i.annotationStatus === "UNCERTAIN").length,
    };
  }

  // Imbalance across APPROVED images only (the trustworthy subset)
  const approvedPerClass = classes.map(
    (c) => perClass[c].approved
  );
  const imbalance =
    Math.max(...approvedPerClass, 0) - Math.min(...approvedPerClass, 0);

  return {
    research: {
      totalAcquired: research.length,
      // All persisted images passed technical validation at ingest time
      // (corrupt/unsupported files are refused before insert).
      validated: research.length,
      needsReview: byStatus["NEEDS_REVIEW"] ?? 0,
      annotated: byStatus["ANNOTATED"] ?? 0,
      expertVerified: byStatus["EXPERT_REVIEWED"] ?? 0,
      approved: byStatus["APPROVED"] ?? 0,
      rejected: byStatus["REJECTED"] ?? 0,
      uncertain: byStatus["UNCERTAIN"] ?? 0,
      secondOpinion: byStatus["SECOND_OPINION"] ?? 0,
    },
    devFixtures: images.filter((i) => i.isDevFixture).length,
    target: RESEARCH_TARGET,
    perClass,
    classImbalanceApproved: imbalance,
    balanceWarning:
      imbalance > 25
        ? `Approved-class imbalance of ${imbalance} exceeds ±25 tolerance — report, never duplicate to fix.`
        : null,
    note:
      research.length === 0
        ? "No research images acquired yet. Counts reflect reality; nothing is fabricated."
        : null,
  };
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    const k = key(item);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
}
