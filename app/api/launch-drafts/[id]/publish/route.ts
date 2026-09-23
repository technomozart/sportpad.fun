import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db";
import { devnetSubmissions, launchDrafts } from "@/db/schema";
import { isUuidV4 } from "@/lib/protocol/identifiers";
import { creatorModerationTransition } from "@/lib/protocol/moderation";
import { buildPublicDevnetReceipt, buildVerifiedDevnetEvidence } from "@/lib/protocol/public-devnet-launch";
import { getAuthenticatedDraftOwner, getVerifiedWalletSession } from "@/lib/server/wallet-session";
import { commitModerationTransition } from "@/lib/server/moderation-transition";
import { getPublicationMode, isOperatorUserId } from "@/lib/server/publication-policy";
import { consumeFixedWindow, rateLimitedJson } from "@/lib/server/rate-limit";

type PublishRouteContext = { params: Promise<{ id: string }> };

const publishSchema = z.object({
  action: z.literal("submit_verified_devnet_receipt_for_review"),
  devnetOnlyAccepted: z.literal(true),
  expectedVersion: z.number().int().nonnegative(),
}).strict();

function privateJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function loadOwnedDraft(id: string, ownerUserId: string) {
  const db = getDb();
  const [draft] = await db.select().from(launchDrafts).where(and(
    eq(launchDrafts.id, id),
    eq(launchDrafts.ownerUserId, ownerUserId),
  )).limit(1);
  if (!draft) return null;
  const submissions = await db.select().from(devnetSubmissions).where(and(
    eq(devnetSubmissions.draftId, id),
    eq(devnetSubmissions.ownerUserId, ownerUserId),
    eq(devnetSubmissions.status, "verified"),
  ));
  return { draft, submissions };
}

function publishedResponse(
  draft: typeof launchDrafts.$inferSelect,
  submissions: (typeof devnetSubmissions.$inferSelect)[],
) {
  const receipt = buildPublicDevnetReceipt(draft, submissions);
  return receipt ? {
    published: true,
    publishedAt: receipt.publishedAt,
    publicPath: `/launches/${encodeURIComponent(draft.id)}`,
    devnet: receipt,
  } : null;
}

export async function POST(request: Request, context: PublishRouteContext) {
  const ownerUserId = await getAuthenticatedDraftOwner(request);
  if (!ownerUserId) return privateJson({ error: "Connect and verify a Solana wallet to access this draft." }, 401);
  const session = await getVerifiedWalletSession(request).catch(() => null);
  if (!session || session.ownerUserId !== ownerUserId) {
    return privateJson({ error: "Verify the Solana wallet that created this devnet launch before submitting it." }, 401);
  }

  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin) return privateJson({ error: "Cross-origin review requests are not allowed." }, 403);
  const { id } = await context.params;
  if (!isUuidV4(id)) return privateJson({ error: "Draft not found." }, 404);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return privateJson({ error: "Review confirmation must be JSON." }, 415);
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > 2_048) return privateJson({ error: "Review confirmation is too large." }, 413);
  const parsed = publishSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return privateJson({ error: "Confirm that this receipt is devnet-only before review." }, 400);

  const mode = getPublicationMode();
  if (mode === "closed") return privateJson({ error: "Receipt review is currently paused." }, 409);
  if (mode === "operator_only" && !isOperatorUserId(ownerUserId)) {
    return privateJson({ error: "The current beta accepts operator-owned drafts only." }, 403);
  }

  try {
    const loaded = await loadOwnedDraft(id, ownerUserId);
    if (!loaded) return privateJson({ error: "Draft not found." }, 404);
    const { draft, submissions } = loaded;
    if (draft.creatorWallet !== session.walletAddress) {
      return privateJson({ error: "Reconnect the wallet that created and verified this devnet launch." }, 403);
    }
    if (draft.status === "devnet_published") {
      const response = publishedResponse(draft, submissions);
      return response ? privateJson(response) : privateJson({ error: "The published receipt no longer matches its verified evidence." }, 409);
    }
    if (draft.status === "receipt_review") {
      return privateJson({ queued: true, reviewState: draft.status, submittedAt: draft.moderationSubmittedAt, version: draft.moderationVersion });
    }
    const nextState = creatorModerationTransition(draft.status, "submit_receipt_review");
    if (!nextState || !buildVerifiedDevnetEvidence(draft, submissions)) {
      return privateJson({ error: "Both independently verified devnet transactions are required before review." }, 409);
    }
    const daily = await consumeFixedWindow({ scope: "receipt_review_day", subject: ownerUserId, limit: 3, windowSeconds: 86_400 });
    if (!daily.allowed) return rateLimitedJson("Daily receipt review limit reached. Try again tomorrow.", daily);
    const updated = await commitModerationTransition({
      draftId: id,
      fromState: draft.status,
      toState: nextState,
      expectedVersion: parsed.data.expectedVersion,
      actorUserId: ownerUserId,
      actorRole: "creator",
      action: "submit_receipt_review",
    });
    return updated
      ? privateJson({ queued: true, reviewState: updated.status, submittedAt: updated.moderationSubmittedAt, version: updated.moderationVersion }, 202)
      : privateJson({ error: "The launch changed before submission. Reload and verify the receipt." }, 409);
  } catch (error) {
    console.error("devnet_receipt_review_failed", error instanceof Error ? error.message : "unknown");
    return privateJson({ error: "The verified devnet receipt could not be submitted. Retry shortly." }, 503);
  }
}
