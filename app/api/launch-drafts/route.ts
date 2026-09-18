import { desc, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";

import { getDb } from "@/db";
import { launchDrafts } from "@/db/schema";
import { launchDraftPayloadSchema } from "@/lib/protocol/launch-draft-input";
import {
  LAUNCH_IMAGE_MIME_TYPES,
  MAX_LAUNCH_IMAGE_BYTES,
  validateLaunchImage,
} from "@/lib/protocol/launch-image";
import { getRewardAsset } from "@/lib/protocol/reward-assets";
import { getLaunchDraftOwner } from "@/lib/server/launch-draft-owner";

const maxPayloadBytes = 16_384;
const maxRequestBytes = MAX_LAUNCH_IMAGE_BYTES + 32_768;

function privateJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (message.includes("D1 binding") || message.includes("no such table")) {
    return "Draft storage is being prepared. Please retry shortly.";
  }
  return "The draft could not be saved. Please retry.";
}

function serializeDraft(draft: typeof launchDrafts.$inferSelect) {
  const { imageKey, ownerUserId: _ownerUserId, ...safeDraft } = draft;
  void _ownerUserId;
  return {
    ...safeDraft,
    imageUrl: imageKey ? `/api/launch-drafts/${encodeURIComponent(draft.id)}/image` : null,
  };
}

export async function GET(request: Request) {
  const ownerUserId = getLaunchDraftOwner(request);
  if (!ownerUserId) return privateJson({ error: "Sign in is required." }, 401);

  try {
    const rows = await getDb()
      .select()
      .from(launchDrafts)
      .where(eq(launchDrafts.ownerUserId, ownerUserId))
      .orderBy(desc(launchDrafts.createdAt))
      .limit(20);
    return privateJson({ drafts: rows.map(serializeDraft) });
  } catch (error) {
    console.error("launch_drafts_get_failed", error);
    return privateJson({ error: errorMessage(error) }, 503);
  }
}

export async function POST(request: Request) {
  const ownerUserId = getLaunchDraftOwner(request);
  if (!ownerUserId) return privateJson({ error: "Sign in is required." }, 401);

  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) {
    return privateJson({ error: "Cross-origin draft requests are not allowed." }, 403);
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    return privateJson({ error: "Drafts must include a multipart image upload." }, 415);
  }

  const contentLengthHeader = request.headers.get("content-length");
  if (!contentLengthHeader) {
    return privateJson({ error: "The upload size could not be verified." }, 411);
  }
  if (!/^[1-9][0-9]*$/.test(contentLengthHeader)) {
    return privateJson({ error: "The upload size is invalid." }, 400);
  }
  const contentLength = Number(contentLengthHeader);
  if (!Number.isSafeInteger(contentLength)) {
    return privateJson({ error: "The upload size is invalid." }, 400);
  }
  if (contentLength > maxRequestBytes) {
    return privateJson({ error: "Request body is too large." }, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return privateJson({ error: "Invalid multipart request body." }, 400);
  }

  const formKeys = [...form.keys()];
  const payloadParts = form.getAll("payload");
  const imageParts = form.getAll("image");
  if (
    formKeys.some((key) => key !== "payload" && key !== "image") ||
    payloadParts.length !== 1 ||
    imageParts.length !== 1
  ) {
    return privateJson({ error: "Include exactly one draft payload and one image." }, 400);
  }

  const rawPayload = payloadParts[0];
  const image = imageParts[0];
  if (typeof rawPayload !== "string" || new TextEncoder().encode(rawPayload).byteLength > maxPayloadBytes) {
    return privateJson({ error: "Invalid draft data." }, 400);
  }
  if (!(image instanceof File) || image.size === 0) {
    return privateJson({ error: "Choose a non-empty image." }, 400);
  }
  if (image.size > MAX_LAUNCH_IMAGE_BYTES) {
    return privateJson({ error: "Image must be 5 MB or smaller." }, 413);
  }
  if (!(LAUNCH_IMAGE_MIME_TYPES as readonly string[]).includes(image.type)) {
    return privateJson({ error: "Image must be a PNG, JPEG, or WebP file." }, 400);
  }

  let untrustedPayload: unknown;
  try {
    untrustedPayload = JSON.parse(rawPayload);
  } catch {
    return privateJson({ error: "Invalid draft data." }, 400);
  }
  const parsedPayload = launchDraftPayloadSchema.safeParse(untrustedPayload);
  if (!parsedPayload.success) {
    return privateJson(
      { error: parsedPayload.error.issues[0]?.message ?? "Invalid draft data." },
      400,
    );
  }

  const payload = parsedPayload.data;
  const rewardAsset = getRewardAsset(payload.rewardSymbol);
  if (!rewardAsset) {
    return privateJson({ error: "Choose a verified reward asset." }, 400);
  }
  if (!env.BUCKET) {
    return privateJson({ error: "Image storage is unavailable. Please retry shortly." }, 503);
  }

  const imageBytes = await image.arrayBuffer();
  const imageValidation = validateLaunchImage(new Uint8Array(imageBytes), image.type);
  if (!imageValidation.ok) {
    return privateJson({ error: imageValidation.message }, imageValidation.code === "too_large" ? 413 : 400);
  }

  const draftId = crypto.randomUUID();
  const imageKey = `launch-drafts/${draftId}.${imageValidation.extension}`;
  try {
    await env.BUCKET.put(imageKey, imageBytes, {
      httpMetadata: { contentType: imageValidation.mime, cacheControl: "private, no-store" },
      customMetadata: { ownerUserId, draftId },
    });
    const [draft] = await getDb()
      .insert(launchDrafts)
      .values({
        id: draftId,
        ownerUserId,
        name: payload.name,
        symbol: payload.symbol,
        description: payload.description,
        sport: payload.sport,
        website: payload.website || null,
        social: payload.social || null,
        imageKey,
        imageMime: imageValidation.mime,
        imageSize: image.size,
        rightsAttested: true,
        unofficialAttested: true,
        economicsAttested: true,
        rewardSymbol: rewardAsset.symbol,
        rewardMint: rewardAsset.solanaMint,
      })
      .returning();

    return privateJson(
      {
        draft: serializeDraft(draft),
        executionStatus: rewardAsset.executionStatus,
        imageStored: true,
      },
      201,
    );
  } catch (error) {
    try {
      await env.BUCKET.delete(imageKey);
    } catch (cleanupError) {
      console.error("launch_draft_image_cleanup_failed", cleanupError);
    }
    console.error("launch_drafts_post_failed", error);
    return privateJson({ error: errorMessage(error) }, 503);
  }
}
