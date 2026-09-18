import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { launchDrafts } from "@/db/schema";
import { getRewardAsset } from "@/lib/protocol/reward-assets";
import type { Launch } from "@/lib/site-data";

function sportName(value: string): Launch["sport"] {
  if (value === "Combat" || value === "Motorsport" || value === "Basketball") return value;
  return "Football";
}

function toPublicLaunch(row: typeof launchDrafts.$inferSelect): Launch {
  const reward = getRewardAsset(row.rewardSymbol);
  const sport = sportName(row.sport);
  return {
    slug: row.id,
    name: row.name,
    ticker: row.symbol,
    sport,
    narrative: row.description || `${sport} community launch`,
    rewardSymbol: row.rewardSymbol,
    rewardName: reward?.name ?? row.rewardSymbol,
    tone: "#9cff57",
    description: row.description || "No description provided.",
    imagePath: row.imageKey ? `/api/public-launches/${row.id}/image` : undefined,
    isExample: false,
  };
}

export async function getPublicLaunches(limit = 24) {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 100)) : 24;
  const rows = await getDb()
    .select()
    .from(launchDrafts)
    .where(eq(launchDrafts.status, "live"))
    .orderBy(desc(launchDrafts.updatedAt))
    .limit(safeLimit);
  return rows.map(toPublicLaunch);
}

export async function getPublicLaunch(id: string) {
  const [row] = await getDb()
    .select()
    .from(launchDrafts)
    .where(and(eq(launchDrafts.id, id), eq(launchDrafts.status, "live")))
    .limit(1);
  if (!row) return undefined;
  return toPublicLaunch(row);
}
