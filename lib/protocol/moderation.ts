export const PUBLICATION_MODES = ["closed", "operator_only", "moderated"] as const;
export type PublicationMode = (typeof PUBLICATION_MODES)[number];

export const MODERATION_STATES = [
  "draft",
  "content_review",
  "content_approved",
  "content_rejected",
  "devnet_verified",
  "receipt_review",
  "receipt_rejected",
  "devnet_published",
  "mainnet_published",
  "suspended",
  "mainnet_suspended",
] as const;
export type ModerationState = (typeof MODERATION_STATES)[number];

export type CreatorModerationAction = "submit_content_review" | "withdraw_review" | "submit_receipt_review";
export type OperatorModerationAction = "approve_content" | "reject_content" | "approve_receipt" | "reject_receipt" | "suspend" | "restore";

export function isModerationDecisionReasonValid(action: OperatorModerationAction, reasonCode: string) {
  const approval = action === "approve_content" || action === "approve_receipt" || action === "restore";
  return approval ? reasonCode === "approved" : reasonCode !== "approved";
}

const creatorTransitions: Record<CreatorModerationAction, Partial<Record<ModerationState, ModerationState>>> = {
  submit_content_review: { draft: "content_review" },
  withdraw_review: { content_review: "draft", receipt_review: "devnet_verified" },
  submit_receipt_review: { devnet_verified: "receipt_review" },
};

const operatorTransitions: Record<OperatorModerationAction, Partial<Record<ModerationState, ModerationState>>> = {
  approve_content: { content_review: "content_approved" },
  reject_content: { content_review: "content_rejected" },
  approve_receipt: { receipt_review: "devnet_published" },
  reject_receipt: { receipt_review: "receipt_rejected" },
  suspend: { devnet_published: "suspended", mainnet_published: "mainnet_suspended" },
  restore: { suspended: "devnet_published", mainnet_suspended: "mainnet_published" },
};

export function isModerationState(value: string): value is ModerationState {
  return (MODERATION_STATES as readonly string[]).includes(value);
}

export function creatorModerationTransition(state: string, action: CreatorModerationAction) {
  if (!isModerationState(state)) return null;
  return creatorTransitions[action][state] ?? null;
}

export function operatorModerationTransition(state: string, action: OperatorModerationAction) {
  if (!isModerationState(state)) return null;
  return operatorTransitions[action][state] ?? null;
}

export function isPublicModerationState(state: string) {
  return state === "devnet_published" || state === "mainnet_published";
}

export function canPrepareDevnet(state: string, mode: PublicationMode, operator: boolean) {
  if (mode === "closed") return false;
  if (mode === "operator_only") return operator && state === "content_approved";
  return state === "content_approved";
}
