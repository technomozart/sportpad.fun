import { env } from "cloudflare:workers";

import { getVerifiedWalletSession } from "@/lib/server/wallet-session";

type ClaimRow = {
  id: string;
  epoch_id: string;
  amount_atomic: string;
  claim_signature: string | null;
  state: string;
  launch_id: string;
  launch_name: string;
  launch_symbol: string;
  community_mint: string;
  reward_symbol: string;
  reward_mint: string;
  reward_decimals: number;
  cutoff_slot: number | null;
};
type PositionRow = {
  epoch_id: string;
  launch_id: string;
  launch_name: string;
  launch_symbol: string;
  community_mint: string;
  reward_symbol: string;
  token_seconds_atomic: string;
  ending_balance_atomic: string;
  last_observed_slot: number | null;
  epoch_state: string;
};

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!env.DB) return Response.json({ error: "Reward database is unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const walletSession = await getVerifiedWalletSession(request);
  if (!walletSession) return Response.json({ error: "Verify a Solana wallet to view reward positions." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  const [claims, positions] = await Promise.all([
    env.DB.prepare(`
      SELECT c.id, c.epoch_id, c.amount_atomic, c.claim_signature, c.state,
        e.launch_id, e.reward_decimals, e.cutoff_slot,
        l.name AS launch_name, l.symbol AS launch_symbol, l.mainnet_mint AS community_mint,
        l.reward_symbol, l.reward_mint
      FROM reward_claims c
      JOIN reward_epochs e ON e.id = c.epoch_id
      JOIN launch_drafts l ON l.id = e.launch_id
      WHERE c.solana_wallet = ?1 AND e.state IN ('claimable', 'complete')
        AND e.reward_decimals IS NOT NULL AND l.mainnet_mint IS NOT NULL AND l.reward_mint IS NOT NULL
      ORDER BY c.created_at DESC
    `).bind(walletSession.walletAddress).all<ClaimRow>(),
    env.DB.prepare(`
      SELECT p.epoch_id, p.launch_id, p.token_seconds_atomic, p.ending_balance_atomic,
        p.last_observed_slot, e.state AS epoch_state,
        l.name AS launch_name, l.symbol AS launch_symbol, l.mainnet_mint AS community_mint,
        l.reward_symbol
      FROM holder_epoch_positions p
      JOIN reward_epochs e ON e.id = p.epoch_id
      JOIN launch_drafts l ON l.id = p.launch_id
      WHERE p.wallet = ?1 AND p.excluded = 0 AND e.state IN ('accruing', 'allocating', 'claimable')
        AND l.mainnet_mint IS NOT NULL
      ORDER BY e.created_at DESC
    `).bind(walletSession.walletAddress).all<PositionRow>(),
  ]);
  return Response.json({
    wallet: walletSession.walletAddress,
    claims: claims.results.map((claim) => ({
      id: claim.id, epochId: claim.epoch_id, amountAtomic: claim.amount_atomic,
      signature: claim.claim_signature, state: claim.state, launchId: claim.launch_id,
      launchName: claim.launch_name, launchSymbol: claim.launch_symbol,
      communityMint: claim.community_mint, rewardSymbol: claim.reward_symbol,
      rewardMint: claim.reward_mint, rewardDecimals: claim.reward_decimals,
      cutoffSlot: claim.cutoff_slot,
    })),
    positions: positions.results.map((position) => ({
      epochId: position.epoch_id, launchId: position.launch_id, launchName: position.launch_name,
      launchSymbol: position.launch_symbol, communityMint: position.community_mint,
      rewardSymbol: position.reward_symbol, tokenSecondsAtomic: position.token_seconds_atomic,
      endingBalanceAtomic: position.ending_balance_atomic, lastObservedSlot: position.last_observed_slot,
      epochState: position.epoch_state,
    })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
