import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";

import { getDb } from "@/db";
import { launchDrafts } from "@/db/schema";
import { isUuidV4 } from "@/lib/protocol/identifiers";
import { isOperatorRequest } from "@/lib/server/publication-policy";

type ImageRouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: ImageRouteContext) {
  if (!isOperatorRequest(request)) return Response.json({ error: "Operator access is required." }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  const { id } = await context.params;
  if (!isUuidV4(id) || !env.BUCKET) return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  const [draft] = await getDb().select({ imageKey: launchDrafts.imageKey, imageMime: launchDrafts.imageMime })
    .from(launchDrafts).where(eq(launchDrafts.id, id)).limit(1);
  if (!draft?.imageKey || !draft.imageMime) return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  const object = await env.BUCKET.get(draft.imageKey);
  if (!object) return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  return new Response(object.body, {
    headers: {
      "Content-Type": draft.imageMime,
      "Content-Length": String(object.size),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
