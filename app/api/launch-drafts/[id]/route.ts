import { and, eq, isNull } from "drizzle-orm";
import { env } from "cloudflare:workers";

import { getDb } from "@/db";
import { launchDrafts } from "@/db/schema";
import { isUuidV4 } from "@/lib/protocol/identifiers";
import { getAuthenticatedDraftOwner } from "@/lib/server/wallet-session";

type DraftRouteContext = { params: Promise<{ id: string }> };

function privateJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(request: Request, context: DraftRouteContext) {
  const ownerUserId = await getAuthenticatedDraftOwner(request);
  if (!ownerUserId) return privateJson({ error: "Connect and verify a Solana wallet to access drafts." }, 401);
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin) return privateJson({ error: "Cross-origin deletion requests are not allowed." }, 403);
  const { id } = await context.params;
  if (!isUuidV4(id)) return privateJson({ error: "Draft not found." }, 404);
  try {
    const [deleted] = await getDb().delete(launchDrafts).where(and(
      eq(launchDrafts.id, id),
      eq(launchDrafts.ownerUserId, ownerUserId),
      eq(launchDrafts.status, "draft"),
      eq(launchDrafts.moderationVersion, 0),
      isNull(launchDrafts.devnetMetadataUri),
      isNull(launchDrafts.devnetMint),
      isNull(launchDrafts.devnetCreateSignature),
    )).returning({ id: launchDrafts.id, imageKey: launchDrafts.imageKey });
    if (!deleted) return privateJson({ error: "Only untouched private drafts can be deleted." }, 409);
    if (deleted.imageKey && env.BUCKET) {
      try {
        await env.BUCKET.delete(deleted.imageKey);
      } catch (error) {
        console.error("launch_draft_deleted_image_cleanup_failed", error);
      }
    }
    return privateJson({ deleted: true, id: deleted.id });
  } catch (error) {
    console.error("launch_draft_delete_failed", error instanceof Error ? error.message : "unknown");
    return privateJson({ error: "The draft could not be deleted. Retry shortly." }, 503);
  }
}
