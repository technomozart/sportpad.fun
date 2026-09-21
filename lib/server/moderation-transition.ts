import { and, eq, isNull, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { launchDrafts } from "@/db/schema";

export async function commitModerationTransition({
  draftId,
  fromState,
  toState,
  expectedVersion,
  actorUserId,
  actorRole,
  action,
  reasonCode = null,
  ownerMessage = null,
  verifiedDevnet,
}: {
  draftId: string;
  fromState: string;
  toState: string;
  expectedVersion: number;
  actorUserId: string;
  actorRole: "creator" | "operator";
  action: string;
  reasonCode?: string | null;
  ownerMessage?: string | null;
  verifiedDevnet?: {
    creatorWallet: string;
    metadataUri: string;
    feeSignature: string;
    rewardWallet: string;
    burnWallet: string;
    verifiedAt: string;
  };
}) {
  const now = verifiedDevnet?.verifiedAt ?? new Date().toISOString();
  const isSubmission = action === "submit_content_review" || action === "submit_receipt_review";
  const isReview = actorRole === "operator";
  const [updated] = await getDb().update(launchDrafts).set({
    ...(verifiedDevnet ? {
      creatorWallet: verifiedDevnet.creatorWallet,
      devnetMetadataUri: verifiedDevnet.metadataUri,
      devnetFeeSignature: verifiedDevnet.feeSignature,
      devnetRewardWallet: verifiedDevnet.rewardWallet,
      devnetBurnWallet: verifiedDevnet.burnWallet,
      devnetVerifiedAt: verifiedDevnet.verifiedAt,
    } : {}),
    status: toState,
    moderationVersion: sql`${launchDrafts.moderationVersion} + 1`,
    moderationSubmittedAt: isSubmission ? now : action === "withdraw_review" ? null : undefined,
    moderationReviewedAt: isReview ? now : isSubmission || action === "withdraw_review" ? null : undefined,
    moderationActorUserId: actorUserId,
    moderationActorRole: actorRole,
    moderationAction: action,
    moderationReason: reasonCode,
    moderationOwnerMessage: ownerMessage,
    devnetPublishedAt: toState === "devnet_published" ? now : toState === "suspended" || toState === "mainnet_suspended" || action === "restore" ? undefined : null,
    updatedAt: now,
  }).where(and(
    eq(launchDrafts.id, draftId),
    eq(launchDrafts.status, fromState),
    eq(launchDrafts.moderationVersion, expectedVersion),
    ...(verifiedDevnet ? [
      eq(launchDrafts.ownerUserId, actorUserId),
      isNull(launchDrafts.devnetFeeSignature),
      isNull(launchDrafts.devnetVerifiedAt),
    ] : []),
  )).returning();
  return updated ?? null;
}
