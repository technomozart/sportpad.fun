import { desc, inArray } from "drizzle-orm";

import { getDb } from "@/db";
import { launchDrafts } from "@/db/schema";
import { isOperatorRequest } from "@/lib/server/publication-policy";

const queueStates = ["content_review", "receipt_review", "devnet_published", "suspended", "content_rejected", "receipt_rejected"];

function privateJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request) {
  if (!isOperatorRequest(request)) return privateJson({ error: "Operator access is required." }, 403);
  const requested = new URL(request.url).searchParams.get("state");
  const states = requested && queueStates.includes(requested) ? [requested] : queueStates;
  try {
    const drafts = await getDb().select().from(launchDrafts)
      .where(inArray(launchDrafts.status, states))
      .orderBy(desc(launchDrafts.moderationSubmittedAt), desc(launchDrafts.updatedAt))
      .limit(100);
    return privateJson({
      items: drafts.map((draft) => ({
        id: draft.id,
        name: draft.name,
        symbol: draft.symbol,
        description: draft.description,
        sport: draft.sport,
        website: draft.website,
        social: draft.social,
        rewardSymbol: draft.rewardSymbol,
        rewardMint: draft.rewardMint,
        state: draft.status,
        version: draft.moderationVersion,
        submittedAt: draft.moderationSubmittedAt,
        reviewedAt: draft.moderationReviewedAt,
        reasonCode: draft.moderationReason,
        ownerMessage: draft.moderationOwnerMessage,
        creatorWallet: draft.creatorWallet,
        devnetMint: draft.devnetMint,
        createSignature: draft.devnetCreateSignature,
        feeSignature: draft.devnetFeeSignature,
        rewardWallet: draft.devnetRewardWallet,
        burnWallet: draft.devnetBurnWallet,
        imageUrl: draft.imageKey ? `/api/operator/moderation/${encodeURIComponent(draft.id)}/image` : null,
      })),
    });
  } catch (error) {
    console.error("operator_moderation_queue_failed", error instanceof Error ? error.message : "unknown");
    return privateJson({ error: "The moderation queue is temporarily unavailable." }, 503);
  }
}
