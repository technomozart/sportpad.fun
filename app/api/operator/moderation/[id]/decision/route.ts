import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db";
import { devnetSubmissions, launchDrafts } from "@/db/schema";
import { isUuidV4 } from "@/lib/protocol/identifiers";
import { isModerationDecisionReasonValid, operatorModerationTransition } from "@/lib/protocol/moderation";
import { buildVerifiedDevnetEvidence } from "@/lib/protocol/public-devnet-launch";
import { getLaunchDraftOwner } from "@/lib/server/launch-draft-owner";
import { commitModerationTransition } from "@/lib/server/moderation-transition";
import { getPublicationMode, isOperatorSelfReviewEnabled, isOperatorUserId } from "@/lib/server/publication-policy";
import { consumeFixedWindow, rateLimitedJson } from "@/lib/server/rate-limit";

type DecisionRouteContext = { params: Promise<{ id: string }> };

const decisionSchema = z.object({
  action: z.enum(["approve_content", "reject_content", "approve_receipt", "reject_receipt", "suspend", "restore"]),
  expectedVersion: z.number().int().nonnegative(),
  reasonCode: z.enum(["approved", "rights_risk", "impersonation", "unsafe_link", "prohibited_content", "receipt_mismatch", "other"]),
  ownerMessage: z.string().trim().max(500).optional().default(""),
}).strict();

function privateJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request, context: DecisionRouteContext) {
  const operatorUserId = getLaunchDraftOwner(request);
  if (!isOperatorUserId(operatorUserId)) return privateJson({ error: "Operator access is required." }, 403);
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin) return privateJson({ error: "Cross-origin operator actions are not allowed." }, 403);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return privateJson({ error: "Operator decisions must be JSON." }, 415);
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > 4_096) return privateJson({ error: "Operator decision is too large." }, 413);
  const input = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return privateJson({ error: "Invalid operator decision." }, 400);
  const { id } = await context.params;
  if (!isUuidV4(id)) return privateJson({ error: "Draft not found." }, 404);
  const approval = input.data.action === "approve_content" || input.data.action === "approve_receipt" || input.data.action === "restore";
  if (approval && getPublicationMode() === "closed") return privateJson({ error: "Publication is closed. Rejections and suspensions remain available." }, 409);
  if (!isModerationDecisionReasonValid(input.data.action, input.data.reasonCode)) {
    return privateJson({ error: approval ? "Approval actions require the approved reason." : "Choose a rejection or suspension reason." }, 400);
  }

  try {
    const limit = await consumeFixedWindow({ scope: "operator_decision_minute", subject: operatorUserId!, limit: 30, windowSeconds: 60 });
    if (!limit.allowed) return rateLimitedJson("Operator decision limit reached. Check for an automation loop.", limit);
    const [draft] = await getDb().select().from(launchDrafts).where(eq(launchDrafts.id, id)).limit(1);
    if (!draft) return privateJson({ error: "Draft not found." }, 404);
    if (approval && draft.ownerUserId === operatorUserId && !isOperatorSelfReviewEnabled()) {
      return privateJson({ error: "Operator self-approval is disabled for this deployment." }, 403);
    }
    const nextState = operatorModerationTransition(draft.status, input.data.action);
    if (!nextState) return privateJson({ error: "That decision is not available for the current state." }, 409);

    if (input.data.action === "approve_content" && (!draft.imageKey || !draft.rewardMint)) {
      return privateJson({ error: "The draft is missing its stored image or reward token identity." }, 409);
    }
    if (input.data.action === "approve_receipt" || input.data.action === "restore") {
      const submissions = await getDb().select().from(devnetSubmissions).where(and(
        eq(devnetSubmissions.draftId, id),
        eq(devnetSubmissions.status, "verified"),
      ));
      if (!buildVerifiedDevnetEvidence(draft, submissions)) {
        return privateJson({ error: "The verified onchain evidence no longer matches this draft." }, 409);
      }
    }

    const updated = await commitModerationTransition({
      draftId: id,
      fromState: draft.status,
      toState: nextState,
      expectedVersion: input.data.expectedVersion,
      actorUserId: operatorUserId!,
      actorRole: "operator",
      action: input.data.action,
      reasonCode: input.data.reasonCode,
      ownerMessage: input.data.ownerMessage || null,
    });
    return updated
      ? privateJson({ ok: true, state: updated.status, version: updated.moderationVersion, reviewedAt: updated.moderationReviewedAt })
      : privateJson({ error: "The queue item changed before this decision. Reload the queue." }, 409);
  } catch (error) {
    console.error("operator_moderation_decision_failed", error instanceof Error ? error.message : "unknown");
    return privateJson({ error: "The operator decision could not be recorded." }, 503);
  }
}
