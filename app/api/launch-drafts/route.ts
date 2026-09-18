import { desc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { launchDrafts } from "@/db/schema";
import { getRewardAsset } from "@/lib/protocol/reward-assets";

function getOwner(request: Request) {
  return request.headers.get("oai-authenticated-user-id");
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (message.includes("D1 binding") || message.includes("no such table")) {
    return "Draft storage is being prepared. Please retry shortly.";
  }
  return "The draft could not be saved. Please retry.";
}

export async function GET(request: Request) {
  const ownerUserId = getOwner(request);
  if (!ownerUserId) return Response.json({ error: "Sign in is required." }, { status: 401 });

  try {
    const rows = await getDb()
      .select()
      .from(launchDrafts)
      .where(eq(launchDrafts.ownerUserId, ownerUserId))
      .orderBy(desc(launchDrafts.createdAt))
      .limit(20);
    return Response.json({ drafts: rows });
  } catch (error) {
    console.error("launch_drafts_get_failed", error);
    return Response.json({ error: errorMessage(error) }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const ownerUserId = getOwner(request);
  if (!ownerUserId) return Response.json({ error: "Sign in is required." }, { status: 401 });

  let payload: { name?: string; symbol?: string; rewardSymbol?: string };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const name = payload.name?.trim() ?? "";
  const symbol = payload.symbol?.trim().toUpperCase() ?? "";
  const rewardAsset = getRewardAsset(payload.rewardSymbol ?? "");

  if (name.length < 2 || name.length > 48) {
    return Response.json({ error: "Coin name must be 2–48 characters." }, { status: 400 });
  }
  if (!/^[A-Z0-9]{2,10}$/.test(symbol)) {
    return Response.json({ error: "Ticker must be 2–10 letters or numbers." }, { status: 400 });
  }
  if (!rewardAsset) {
    return Response.json({ error: "Choose a verified reward asset." }, { status: 400 });
  }

  try {
    const [draft] = await getDb()
      .insert(launchDrafts)
      .values({
        id: crypto.randomUUID(),
        ownerUserId,
        name,
        symbol,
        rewardSymbol: rewardAsset.symbol,
        rewardMint: rewardAsset.solanaMint,
      })
      .returning();

    return Response.json(
      { draft, executionStatus: rewardAsset.executionStatus },
      { status: 201 },
    );
  } catch (error) {
    console.error("launch_drafts_post_failed", error);
    return Response.json({ error: errorMessage(error) }, { status: 503 });
  }
}
