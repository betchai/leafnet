// Central Role-Based Access Control map.
//
// AUTHORITATIVE SOURCE OF TRUTH: this file is the single place that decides
// which roles may exercise a given capability. Route handlers only reference
// capability names via authorize() — they never hard-code role lists.
//
// Roles:
//   FARMER      — public analyzer only (upload → classify → explain → feedback).
//   RESEARCHER  — analyzer + acquire/ingest + preliminary labeling + bulk ingest.
//   EXPERT      — everything: expert review, feedback review, model & dataset
//                 governance, insights/monitoring, and user administration.

export type Role = "FARMER" | "RESEARCHER" | "EXPERT";

export const ROLES: readonly Role[] = ["FARMER", "RESEARCHER", "EXPERT"];

export type Capability =
  | "analyze" // upload + predict + explain + feedback + prediction history
  | "view_dataset" // list images, view an image file / detail
  | "annotate" // preliminary labeling (acquire & label tool)
  | "bulk_ingest" // researcher bulk acquisition with/without batch labels
  | "expert_review" // confirm / relabel / uncertain / reject / 2nd-opinion / batch-confirm
  | "feedback_review" // Phase 9.1 feedback review queue + candidates
  | "model_admin" // lifecycle transitions, activation, pipeline runner control
  | "dataset_admin" // cut dataset versions, manifest download
  | "insights" // research + application insights
  | "monitoring" // monitoring summary
  | "view_models" // model registry read
  | "user_admin"; // user account administration

export const CAPABILITY_ROLES: Record<Capability, Role[]> = {
  analyze: ["FARMER", "RESEARCHER", "EXPERT"],
  view_dataset: ["RESEARCHER", "EXPERT"],
  annotate: ["RESEARCHER", "EXPERT"],
  bulk_ingest: ["RESEARCHER", "EXPERT"],
  expert_review: ["EXPERT"],
  feedback_review: ["EXPERT"],
  model_admin: ["EXPERT"],
  dataset_admin: ["EXPERT"],
  insights: ["EXPERT"],
  monitoring: ["EXPERT"],
  view_models: ["EXPERT"],
  user_admin: ["EXPERT"],
};

export function can(role: Role, cap: Capability): boolean {
  return CAPABILITY_ROLES[cap]?.includes(role) ?? false;
}

/** Map an application role to the annotation workflow actor role string. */
export function roleToActorRole(role: Role): "annotator" | "expert" | "admin" | "system" {
  if (role === "EXPERT") return "expert";
  return "annotator";
}