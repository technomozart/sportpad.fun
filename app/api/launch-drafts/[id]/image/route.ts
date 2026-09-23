import { and, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";

import { getDb } from "@/db";
import { launchDrafts } from "@/db/schema";
import { isUuidV4 } from "@/lib/protocol/identifiers";
import { LAUNCH_IMAGE_MIME_TYPES } from "@/lib/protocol/launch-image";
import { getAuthenticatedDraftOwner } from "@/lib/server/wallet-session";

type ImageRouteContext = {
  params: Promise<{ id: string }>;
};

function privateError(error: string, status: number) {
  return Response.json(
    { error },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function GET(request: Request, context: ImageRouteContext) {
  const ownerUserId = await getAuthenticatedDraftOwner(request);
  if (!ownerUserId) return privateError("Connect and verify a Solana wallet to access this image.", 401);
  if (!env.BUCKET) return privateError("Image storage is unavailable.", 503);

  const { id } = await context.params;
  if (!isUuidV4(id)) {
    return privateError("Image not found.", 404);
  }

  try {
    const [draft] = await getDb()
      .select({
        imageKey: launchDrafts.imageKey,
        imageMime: launchDrafts.imageMime,
      })
      .from(launchDrafts)
      .where(and(eq(launchDrafts.id, id), eq(launchDrafts.ownerUserId, ownerUserId)))
      .limit(1);

    if (
      !draft?.imageKey ||
      !draft.imageMime ||
      !(LAUNCH_IMAGE_MIME_TYPES as readonly string[]).includes(draft.imageMime)
    ) {
      return privateError("Image not found.", 404);
    }

    const image = await env.BUCKET.get(draft.imageKey);
    if (!image) return privateError("Image not found.", 404);

    const extension = draft.imageMime === "image/png" ? "png" : draft.imageMime === "image/webp" ? "webp" : "jpg";
    return new Response(image.body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="token-image.${extension}"`,
        "Content-Length": String(image.size),
        "Content-Type": draft.imageMime,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("launch_draft_image_get_failed", error);
    return privateError("Image could not be loaded.", 503);
  }
}
