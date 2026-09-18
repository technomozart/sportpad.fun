import { desc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { launchDrafts } from "@/db/schema";
import { getRewardAsset } from "@/lib/protocol/reward-assets";

function getOwner(request: Request) {
  const authenticatedOwner = request.headers.get("oai-authenticated-user-id");
  if (authenticatedOwner && /^[A-Za-z0-9:_-]{1,128}$/.test(authenticatedOwner)) {
    return authenticatedOwner;
  }

  const hostname = new URL(request.url).hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "local-preview-user";
  return null;
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

  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) {
    return Response.json({ error: "Cross-origin draft requests are not allowed." }, { status: 403 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 16_384) {
    return Response.json({ error: "Request body is too large." }, { status: 413 });
  }

  let payload: {
    name?: string;
    symbol?: string;
    description?: string;
    sport?: string;
    website?: string;
    social?: string;
    rewardSymbol?: string;
    attestations?: { rights?: boolean; unofficial?: boolean; economics?: boolean };
  };
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 16_384) {
      return Response.json({ error: "Request body is too large." }, { status: 413 });
    }
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const name = payload.name?.trim() ?? "";
  const symbol = payload.symbol?.trim().toUpperCase() ?? "";
  const description = payload.description?.trim() ?? "";
  const sport = payload.sport?.trim() ?? "";
  const website = payload.website?.trim() || null;
  const social = payload.social?.trim() || null;
  const rewardAsset = getRewardAsset(payload.rewardSymbol ?? "");

  if (name.length < 2 || name.length > 48) {
    return Response.json({ error: "Coin name must be 2–48 characters." }, { status: 400 });
  }
  if (!/^[A-Z0-9]{2,10}$/.test(symbol)) {
    return Response.json({ error: "Ticker must be 2–10 letters or numbers." }, { status: 400 });
  }
  if (description.length < 20 || description.length > 280) {
    return Response.json({ error: "Description must be 20–280 characters." }, { status: 400 });
  }
  if (!["Football", "Combat", "Motorsport", "Basketball"].includes(sport)) {
    return Response.json({ error: "Choose a supported sport." }, { status: 400 });
  }
  for (const [label, value] of [["Website", website], ["Social URL", social]] as const) {
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:") throw new Error("https required");
    } catch {
      return Response.json({ error: `${label} must be a valid HTTPS URL.` }, { status: 400 });
    }
  }
  if (!payload.attestations?.rights || !payload.attestations.unofficial || !payload.attestations.economics) {
    return Response.json({ error: "All creator attestations are required." }, { status: 400 });
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
        description,
        sport,
        website,
        social,
        rightsAttested: true,
        unofficialAttested: true,
        economicsAttested: true,
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
