import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db";
import { launchDrafts } from "@/db/schema";
import { creatorModerationTransition } from "@/lib/protocol/moderation";
import { isUuidV4 } from "@/lib/protocol/identifiers";
import { getAuthenticatedDraftOwner } from "@/lib/server/wallet-session";
import { commitModerationTransition } from "@/lib/server/moderation-transition";
import { getPublicationMode, isOperatorUserId } from "@/lib/server/publication-policy";
import { consumeFixedWindow, rateLimitedJson } from "@/lib/server/rate-limit";

type ModerationRouteContext = { params: Promise<{ id: string }> };

const actionSchema = z.object({
  action: z.enum(["submit_content_review", "withdraw_review"]),
  expectedVersion: z.number().int().nonnegative(),
}).strict();

function privateJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function serialize(draft: typeof launchDrafts.$inferSelect) {
  return {
    state: draft.status,
    version: draft.moderationVersion,
    submittedAt: draft.moderationSubmittedAt,
    reviewedAt: draft.moderationReviewedAt,
    reasonCode: draft.moderationReason,
    ownerMessage: draft.moderationOwnerMessage,
    publicationMode: getPublicationMode(),
  };
}

async function ownedDraft(id: string, ownerUserId: string) {
  const [draft] = await getDb().select().from(launchDrafts).where(and(
    eq(launchDrafts.id, id),
    eq(launchDrafts.ownerUserId, ownerUserId),
  )).limit(1);
  return draft ?? null;
}

export async function GET(request: Request, context: ModerationRouteContext) {
  const ownerUserId = await getAuthenticatedDraftOwner(request);
  if (!ownerUserId) return privateJson({ error: "Connect and verify a Solana wallet to access this draft." }, 401);
  const { id } = await context.params;
  if (!isUuidV4(id)) return privateJson({ error: "Draft not found." }, 404);
  const draft = await ownedDraft(id, ownerUserId).catch(() => null);
  return draft ? privateJson({ moderation: serialize(draft) }) : privateJson({ error: "Draft not found." }, 404);
}

export async function POST(request: Request, context: ModerationRouteContext) {
  const ownerUserId = await getAuthenticatedDraftOwner(request);
  if (!ownerUserId) return privateJson({ error: "Connect and verify a Solana wallet to access this draft." }, 401);
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin) return privateJson({ error: "Cross-origin review requests are not allowed." }, 403);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return privateJson({ error: "Review requests must be JSON." }, 415);
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > 2_048) return privateJson({ error: "Review request is too large." }, 413);
  const input = actionSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return privateJson({ error: "Invalid review request." }, 400);
  const { id } = await context.params;
  if (!isUuidV4(id)) return privateJson({ error: "Draft not found." }, 404);

  const mode = getPublicationMode();
  const submitting = input.data.action === "submit_content_review";
  if (submitting && mode === "closed") return privateJson({ error: "Publication review is currently paused." }, 409);
  if (submitting && mode === "operator_only" && !isOperatorUserId(ownerUserId)) {
    return privateJson({ error: "The current beta accepts operator-owned drafts only." }, 403);
  }

  try {
    const draft = await ownedDraft(id, ownerUserId);
    if (!draft) return privateJson({ error: "Draft not found." }, 404);
    const nextState = creatorModerationTransition(draft.status, input.data.action);
    if (!nextState) return privateJson({ error: "That review action is not available for the draft's current state." }, 409);

    if (input.data.action === "submit_content_review") {
      const daily = await consumeFixedWindow({ scope: "content_review_day", subject: ownerUserId, limit: 3, windowSeconds: 86_400 });
      if (!daily.allowed) return rateLimitedJson("Content review limit reached. Try again after the current window.", daily);
    }

    const updated = await commitModerationTransition({
      draftId: id,
      fromState: draft.status,
      toState: nextState,
      expectedVersion: input.data.expectedVersion,
      actorUserId: ownerUserId,
      actorRole: "creator",
      action: input.data.action,
    });
    return updated
      ? privateJson({ moderation: serialize(updated) })
      : privateJson({ error: "The draft changed before this action. Reload its review status." }, 409);
  } catch (error) {
    console.error("launch_moderation_update_failed", error instanceof Error ? error.message : "unknown");
    return privateJson({ error: "Review status is temporarily unavailable." }, 503);
  }
}
