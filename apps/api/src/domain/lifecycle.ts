/**
 * Phase 9.1 domain rules: model lifecycle + feedback review workflow.
 * Pure functions — enforced server-side by the routes that call them.
 *
 * Ground-truth boundary: a verified feedback label becomes CANDIDATE training
 * data only; it enters a dataset version solely through the explicit
 * "cut version" action by an authorized researcher.
 */

export type LifecycleStatus =
  | "experimental" | "evaluated" | "candidate"
  | "approved" | "active" | "retired";

const LIFECYCLE_TRANSITIONS: Record<LifecycleStatus, LifecycleStatus[]> = {
  experimental: ["evaluated"],
  evaluated: ["candidate", "retired"],
  candidate: ["approved", "retired"],
  approved: ["active", "retired"],
  active: ["retired"], // rollback = activate a retired/approved previous model explicitly
  retired: [],          // re-activation must go through admin tooling + audit
};

export function validateLifecycleTransition(
  from: LifecycleStatus, to: LifecycleStatus
): void {
  if (!LIFECYCLE_TRANSITIONS[from]?.includes(to)) {
    throw Object.assign(
      new Error(`Invalid model lifecycle transition ${from} -> ${to}`),
      { code: "INVALID_LIFECYCLE_TRANSITION" }
    );
  }
}

/** Only approved models may become active. */
export function canActivate(status: LifecycleStatus): boolean {
  return status === "approved";
}

// ---------- feedback review workflow ----------

export type FeedbackReviewStatus =
  | "SUBMITTED" | "NEEDS_REVIEW" | "UNDER_REVIEW"
  | "VERIFIED" | "REJECTED";

export type ReviewAction =
  | "start_review"        // SUBMITTED/NEEDS_REVIEW -> UNDER_REVIEW
  | "verify"              // confirm suggested label -> VERIFIED (+ candidate)
  | "verify_corrected"    // expert assigns different label -> VERIFIED
  | "mark_uncertain"      // cannot decide -> stays NEEDS_REVIEW with notes
  | "reject";             // feedback invalid/spam -> REJECTED

const REVIEW_ALLOWED: Record<ReviewAction, FeedbackReviewStatus[]> = {
  start_review: ["SUBMITTED", "NEEDS_REVIEW"],
  verify: ["UNDER_REVIEW", "NEEDS_REVIEW"],
  verify_corrected: ["UNDER_REVIEW", "NEEDS_REVIEW"],
  mark_uncertain: ["UNDER_REVIEW", "NEEDS_REVIEW", "SUBMITTED"],
  reject: ["SUBMITTED", "NEEDS_REVIEW", "UNDER_REVIEW"],
};

const REVIEW_RESULT: Record<ReviewAction, FeedbackReviewStatus> = {
  start_review: "UNDER_REVIEW",
  verify: "VERIFIED",
  verify_corrected: "VERIFIED",
  mark_uncertain: "NEEDS_REVIEW",
  reject: "REJECTED",
};

export function validateFeedbackReview(params: {
  action: ReviewAction;
  currentStatus: FeedbackReviewStatus;
  reviewerRole: string;
  verifiedClass?: string;
}): { newStatus: FeedbackReviewStatus; verifiedClass?: string } {
  const { action, currentStatus, reviewerRole, verifiedClass } = params;

  if (reviewerRole !== "expert" && reviewerRole !== "admin") {
    throw Object.assign(
      new Error("Only expert/admin roles may review feedback"),
      { code: "FORBIDDEN_ROLE" }
    );
  }
  if (!REVIEW_ALLOWED[action].includes(currentStatus)) {
    throw Object.assign(
      new Error(`Action "${action}" not allowed from status ${currentStatus}`),
      { code: "INVALID_TRANSITION" }
    );
  }
  if ((action === "verify" || action === "verify_corrected") && !verifiedClass) {
    throw Object.assign(new Error("verification requires a class label"), {
      code: "MISSING_LABEL",
    });
  }
  return { newStatus: REVIEW_RESULT[action], verifiedClass };
}
