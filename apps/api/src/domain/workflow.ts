/**
 * Annotation workflow state machine (Phase 2 spec, Phase 3 enforcement).
 *
 * UNLABELED → NEEDS_REVIEW → ANNOTATED → EXPERT_REVIEWED → APPROVED
 * side states: REJECTED, SECOND_OPINION, UNCERTAIN
 *
 * Rules enforced here:
 * - Only experts may perform review actions.
 * - An image cannot become APPROVED without a preliminary label.
 * - UNCERTAIN images are never forced into a class.
 * - AI predictions can never drive any transition (they never call this).
 */

export type AnnotationStatus =
  | "UNLABELED"
  | "NEEDS_REVIEW"
  | "ANNOTATED"
  | "EXPERT_REVIEWED"
  | "APPROVED"
  | "REJECTED"
  | "SECOND_OPINION"
  | "UNCERTAIN";

export type ActorRole = "annotator" | "expert" | "admin" | "system";

export type ReviewAction =
  | "confirm"
  | "relabel"
  | "mark_uncertain"
  | "reject"
  | "second_opinion";

/** Which status each action may be applied from. */
const ACTION_ALLOWED_FROM: Record<ReviewAction, AnnotationStatus[]> = {
  confirm: ["ANNOTATED", "EXPERT_REVIEWED", "SECOND_OPINION"],
  relabel: ["ANNOTATED", "EXPERT_REVIEWED", "SECOND_OPINION", "UNCERTAIN"],
  mark_uncertain: ["UNLABELED", "NEEDS_REVIEW", "ANNOTATED", "EXPERT_REVIEWED", "SECOND_OPINION"],
  reject: ["UNLABELED", "NEEDS_REVIEW", "ANNOTATED", "EXPERT_REVIEWED", "SECOND_OPINION", "UNCERTAIN"],
  second_opinion: ["ANNOTATED", "EXPERT_REVIEWED", "UNCERTAIN"],
};

/** Resulting status per action. */
const ACTION_RESULT: Record<ReviewAction, AnnotationStatus> = {
  confirm: "APPROVED",
  relabel: "EXPERT_REVIEWED",
  mark_uncertain: "UNCERTAIN",
  reject: "REJECTED",
  second_opinion: "SECOND_OPINION",
};

export function isTerminal(status: AnnotationStatus): boolean {
  return status === "APPROVED" || status === "REJECTED";
}

/**
 * Validate a proposed annotation transition.
 * Throws Error with a `code` property on violation; returns the new status otherwise.
 */
export function validateTransition(params: {
  action: ReviewAction;
  currentStatus: AnnotationStatus;
  actorRole: ActorRole;
  hasPreliminaryLabel: boolean;
  newLabel?: string;
}): { newStatus: AnnotationStatus } {
  const { action, currentStatus, actorRole, hasPreliminaryLabel, newLabel } = params;

  if (actorRole !== "expert" && actorRole !== "admin") {
    throw Object.assign(
      new Error(`Only expert/admin roles may perform review actions (got "${actorRole}")`),
      { code: "FORBIDDEN_ROLE" }
    );
  }

  if (isTerminal(currentStatus) && action !== "reject") {
    // APPROVED/REJECTED are final; reopening must go through admin tooling (not implemented)
    throw Object.assign(
      new Error(`Image is ${currentStatus} (terminal); no further transitions permitted`),
      { code: "TERMINAL_STATE" }
    );
  }

  if (!ACTION_ALLOWED_FROM[action].includes(currentStatus)) {
    throw Object.assign(
      new Error(
        `Action "${action}" not allowed from status ${currentStatus} (allowed from: ${ACTION_ALLOWED_FROM[action].join(", ")})`
      ),
      { code: "INVALID_TRANSITION" }
    );
  }

  if (action === "relabel" && !newLabel) {
    throw Object.assign(new Error("relabel requires a newLabel"), {
      code: "MISSING_LABEL",
    });
  }

  if (action === "confirm" && (!hasPreliminaryLabel || !newLabel)) {
    throw Object.assign(
      new Error("confirm requires an existing preliminary label"),
      { code: "NO_PRELIMINARY_LABEL" }
    );
  }

  return { newStatus: ACTION_RESULT[action] };
}

/**
 * Preliminary annotation: annotators may label only from pre-annotation states.
 */
export function validatePreliminaryAnnotation(currentStatus: AnnotationStatus): void {
  if (!["UNLABELED", "NEEDS_REVIEW"].includes(currentStatus)) {
    throw Object.assign(
      new Error(`Preliminary annotation not allowed from status ${currentStatus}`),
      { code: "INVALID_TRANSITION" }
    );
  }
}
