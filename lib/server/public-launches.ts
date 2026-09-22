import { and, desc, eq, inArray } from "drizzle-orm";

import { getDb } from "@/db";
import { devnetSubmissions, launchDrafts } from "@/db/schema";
import { buildPublicDevnetReceipt } from "@/lib/protocol/public-devnet-launch";
import { buildPublicMainnetReceipt } from "@/lib/protocol/public-mainnet-launch";
import { getRewardOption, type RewardChain } from "@/lib/protocol/reward-options";
import type { Launch } from "@/lib/site-data";

function sportName(value: string): Launch["sport"] {
  if (value === "Combat" || value === "Motorsport" || value === "Basketball") return value;
  return "Football";
}

function toPublicLaunch(
  row: typeof launchDrafts.$inferSelect,
  submissions: (typeof devnetSubmissions.$inferSelect)[],
): Launch | null {
  const mainnet = buildPublicMainnetReceipt(row);
  const devnet = buildPublicDevnetReceipt(row, submissions);
  if (!mainnet && !devnet) return null;
  const rewardChain = row.rewardChain as RewardChain;
  const reward = getRewardOption(rewardChain, row.rewardSymbol);
  const sport = sportName(row.sport);
  return {
    slug: row.id,
    name: row.name,
    ticker: row.symbol,
    sport,
    narrative: row.description || `${sport} community launch`,
    rewardSymbol: row.rewardSymbol,
    rewardChain,
    rewardName: reward?.name ?? row.rewardSymbol,
    tone: "#9cff57",
    description: row.description || "No description provided.",
    website: row.website ?? undefined,
    social: row.social ?? undefined,
    imagePath: row.imageKey ? `/api/public-launches/${row.id}/image` : undefined,
    isExample: false,
    devnet: devnet ?? undefined,
    mainnet: mainnet ?? undefined,
  };
}

export async function getPublicLaunches(limit = 24) {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 100)) : 24;
  const db = getDb();
  const rows = await db
    .select()
    .from(launchDrafts)
    .where(inArray(launchDrafts.status, ["mainnet_published", "devnet_published"]))
    .orderBy(desc(launchDrafts.updatedAt))
    .limit(safeLimit);
  if (!rows.length) return [];
  const submissions = await db.select().from(devnetSubmissions).where(and(
    inArray(devnetSubmissions.draftId, rows.map((row) => row.id)),
    eq(devnetSubmissions.status, "verified"),
  ));
  return rows
    .map((row) => toPublicLaunch(row, submissions.filter((submission) => submission.draftId === row.id)))
    .filter((launch): launch is Launch => launch !== null);
}

export async function getPublicLaunch(id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(launchDrafts)
    .where(and(eq(launchDrafts.id, id), inArray(launchDrafts.status, ["mainnet_published", "devnet_published"])))
    .limit(1);
  if (!row) return undefined;
  const submissions = await db.select().from(devnetSubmissions).where(and(
    eq(devnetSubmissions.draftId, id),
    eq(devnetSubmissions.status, "verified"),
  ));
  return toPublicLaunch(row, submissions) ?? undefined;
}
