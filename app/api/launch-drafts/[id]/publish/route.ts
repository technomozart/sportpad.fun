import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db";
import { devnetSubmissions, launchDrafts } from "@/db/schema";
import { isUuidV4 } from "@/lib/protocol/identifiers";
import { buildPublicDevnetReceipt } from "@/lib/protocol/public-devnet-launch";
import { getLaunchDraftOwner } from "@/lib/server/launch-draft-owner";
import { getVerifiedWalletSession } from "@/lib/server/wallet-session";

type PublishRouteContext = { params: Promise<{ id: string }> };

const publishSchema = z.object({
  action: z.literal("publish_verified_devnet_receipt"),
  devnetOnlyAccepted: z.literal(true),
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

function responseFor(
  draft: typeof launchDrafts.$inferSelect,
  submissions: (typeof devnetSubmissions.$inferSelect)[],
) {
  const receipt = buildPublicDevnetReceipt(draft, submissions);
  if (!receipt) return null;
  return {
    published: true,
    publishedAt: receipt.publishedAt,
    publicPath: `/launches/${encodeURIComponent(draft.id)}`,
    devnet: receipt,
  };
}

export async function POST(request: Request, context: PublishRouteContext) {
  const ownerUserId = getLaunchDraftOwner(request);
  if (!ownerUserId) return privateJson({ error: "Sign in is required." }, 401);
  const session = await getVerifiedWalletSession(request).catch(() => null);
  if (!session || session.ownerUserId !== ownerUserId) {
    return privateJson({ error: "Verify the Solana wallet that created this devnet launch before publishing." }, 401);
  }

  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin) {
    return privateJson({ error: "Cross-origin publication requests are not allowed." }, 403);
  }
  const { id } = await context.params;
  if (!isUuidV4(id)) return privateJson({ error: "Draft not found." }, 404);

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return privateJson({ error: "Publication confirmation must be JSON." }, 415);
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 2_048) {
    return privateJson({ error: "Publication confirmation is too large." }, 413);
  }
  const parsed = publishSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return privateJson({ error: "Confirm that this receipt is devnet-only before publishing." }, 400);
  }

  try {
    const loaded = await loadOwnedDraft(id, ownerUserId);
    if (!loaded) return privateJson({ error: "Draft not found." }, 404);
    const { draft, submissions } = loaded;
    if (draft.creatorWallet !== session.walletAddress) {
      return privateJson({ error: "Reconnect the wallet that created and verified this devnet launch." }, 403);
    }

    if (draft.status === "devnet_published") {
      const response = responseFor(draft, submissions);
      return response
        ? privateJson(response)
        : privateJson({ error: "The published receipt no longer matches its verified evidence." }, 409);
    }
    if (draft.status !== "devnet_verified" || draft.devnetPublishedAt !== null) {
      return privateJson({ error: "Complete independent devnet verification before publishing." }, 409);
    }

    const publishedAt = new Date().toISOString();
    const publishableReceipt = buildPublicDevnetReceipt(
      { ...draft, status: "devnet_published", devnetPublishedAt: publishedAt },
      submissions,
    );
    if (!publishableReceipt) {
      return privateJson({ error: "Both verified devnet transactions are required before publishing." }, 409);
    }

    const [published] = await getDb().update(launchDrafts).set({
      status: "devnet_published",
      devnetPublishedAt: publishedAt,
      updatedAt: publishedAt,
    }).where(and(
      eq(launchDrafts.id, id),
      eq(launchDrafts.ownerUserId, ownerUserId),
      eq(launchDrafts.status, "devnet_verified"),
      eq(launchDrafts.creatorWallet, session.walletAddress),
      eq(launchDrafts.devnetMint, publishableReceipt.mint),
      eq(launchDrafts.devnetCreateSignature, publishableReceipt.createSignature),
      eq(launchDrafts.devnetFeeSignature, publishableReceipt.feeSignature),
      isNull(launchDrafts.devnetPublishedAt),
    )).returning();

    if (!published) {
      const raced = await loadOwnedDraft(id, ownerUserId);
      const response = raced && raced.draft.creatorWallet === session.walletAddress
        ? responseFor(raced.draft, raced.submissions)
        : null;
      return response
        ? privateJson(response)
        : privateJson({ error: "The launch changed before publication. Reload and verify the receipt." }, 409);
    }

    const response = responseFor(published, submissions);
    return response
      ? privateJson(response, 201)
      : privateJson({ error: "The verified receipt could not be published." }, 409);
  } catch (error) {
    console.error("devnet_receipt_publish_failed", error instanceof Error ? error.message : "unknown");
    return privateJson({ error: "The verified devnet receipt could not be published. Retry shortly." }, 503);
  }
}
