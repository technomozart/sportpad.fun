import assert from "node:assert/strict";
import test from "node:test";

import {
  canPrepareDevnet,
  creatorModerationTransition,
  isModerationDecisionReasonValid,
  isPublicModerationState,
  operatorModerationTransition,
} from "./moderation.ts";

test("creator moderation follows the two-stage review flow", () => {
  assert.equal(creatorModerationTransition("draft", "submit_content_review"), "content_review");
  assert.equal(creatorModerationTransition("content_review", "withdraw_review"), "draft");
  assert.equal(creatorModerationTransition("devnet_verified", "submit_receipt_review"), "receipt_review");
  assert.equal(creatorModerationTransition("receipt_review", "withdraw_review"), "devnet_verified");
  assert.equal(creatorModerationTransition("draft", "submit_receipt_review"), null);
  assert.equal(creatorModerationTransition("content_rejected", "submit_content_review"), null);
  assert.equal(creatorModerationTransition("receipt_rejected", "submit_receipt_review"), null);
});

test("operator decisions cannot skip moderation stages", () => {
  assert.equal(operatorModerationTransition("content_review", "approve_content"), "content_approved");
  assert.equal(operatorModerationTransition("receipt_review", "approve_receipt"), "devnet_published");
  assert.equal(operatorModerationTransition("devnet_published", "suspend"), "suspended");
  assert.equal(operatorModerationTransition("suspended", "restore"), "devnet_published");
  assert.equal(operatorModerationTransition("draft", "approve_receipt"), null);
});

test("operator decision reasons match the decision authority", () => {
  assert.equal(isModerationDecisionReasonValid("approve_content", "approved"), true);
  assert.equal(isModerationDecisionReasonValid("approve_receipt", "rights_risk"), false);
  assert.equal(isModerationDecisionReasonValid("restore", "other"), false);
  assert.equal(isModerationDecisionReasonValid("reject_content", "approved"), false);
  assert.equal(isModerationDecisionReasonValid("suspend", "receipt_mismatch"), true);
});

test("publication and preparation fail closed", () => {
  assert.equal(isPublicModerationState("devnet_published"), true);
  assert.equal(isPublicModerationState("suspended"), false);
  assert.equal(canPrepareDevnet("content_approved", "moderated", false), true);
  assert.equal(canPrepareDevnet("draft", "moderated", false), false);
  assert.equal(canPrepareDevnet("draft", "closed", true), false);
  assert.equal(canPrepareDevnet("content_approved", "operator_only", true), true);
  assert.equal(canPrepareDevnet("draft", "operator_only", true), false);
  assert.equal(canPrepareDevnet("draft", "operator_only", false), false);
});
