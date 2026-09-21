import { and, eq, inArray } from "drizzle-orm";
import { env } from "cloudflare:workers";

import { getDb } from "@/db";
import { launchDrafts } from "@/db/schema";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!env.BUCKET) return new Response("Image storage unavailable", { status: 503 });

  const [launch] = await getDb()
    .select({ imageKey: launchDrafts.imageKey })
    .from(launchDrafts)
    .where(and(eq(launchDrafts.id, id), inArray(launchDrafts.status, ["mainnet_published", "devnet_published"])))
    .limit(1);

  if (!launch?.imageKey) return new Response("Image not found", { status: 404 });
  const object = await env.BUCKET.get(launch.imageKey);
  if (!object) return new Response("Image not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}
