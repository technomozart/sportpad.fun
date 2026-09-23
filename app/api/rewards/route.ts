import { env } from "cloudflare:workers";
import { z } from "zod";

import { getChilizRewardAsset } from "@/lib/protocol/chiliz-reward-assets";
import { CHILIZ_ASSET_MIGRATION_VERIFIED } from "@/lib/protocol/chiliz-receipts";
import { ASSERT_ONE_ROW_CHANGED_SQL, FINANCIAL_LEDGER_VERIFIED, QUEUE_CLAIM_JOB_SQL,
  QUEUE_CLAIM_TRANSITION_SQL } from "@/lib/protocol/automation-safety";
import { getVerifiedWalletSession } from "@/lib/server/wallet-session";

type ClaimRow = {
  id: string; epoch_id: string; amount_atomic: string; claim_fee_atomic: string;
  claim_signature: string | null; state: string; destination_chain: string; destination_address: string | null;
  launch_id: string; launch_name: string; launch_symbol: string; community_mint: string;
  reward_symbol: string; reward_mint: string; reward_chain: string; reward_decimals: number; cutoff_slot: number | null;
};
type PositionRow = {
  epoch_id: string; launch_id: string; launch_name: string; launch_symbol: string; community_mint: string;
  reward_symbol: string; reward_chain: string; token_seconds_atomic: string; ending_balance_atomic: string;
  last_observed_slot: number | null; epoch_state: string;
};
type LinkRow = { evm_address: string; chain_id: number; verified_at: number };
type ClaimRequestRow = {
  id: string; amount_atomic: string; state: string; solana_wallet: string;
  reward_symbol: string; reward_chain: string; reward_mint: string; reward_wrapped_contract: string | null;
};

const claimSchema = z.object({ claimId: z.string().uuid() }).strict();

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request) {
  if (!env.DB) return json({ error: "Reward database is unavailable." }, 503);
  const walletSession = await getVerifiedWalletSession(request);
  if (!walletSession) return json({ error: "Verify a Solana wallet to view reward positions." }, 401);
  const [claims, positions, evmLink] = await Promise.all([
    env.DB.prepare(`
      SELECT c.id, c.epoch_id, c.amount_atomic, c.claim_fee_atomic, c.claim_signature, c.state,
        c.destination_chain, c.destination_address,
        e.launch_id, e.reward_decimals, e.cutoff_slot,
        l.name AS launch_name, l.symbol AS launch_symbol, l.mainnet_mint AS community_mint,
        l.reward_symbol, l.reward_mint, l.reward_chain
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
        l.reward_symbol, l.reward_chain
      FROM holder_epoch_positions p
      JOIN reward_epochs e ON e.id = p.epoch_id
      JOIN launch_drafts l ON l.id = p.launch_id
      WHERE p.wallet = ?1 AND p.excluded = 0 AND e.state IN ('accruing', 'allocating', 'claimable')
        AND l.mainnet_mint IS NOT NULL
      ORDER BY e.created_at DESC
    `).bind(walletSession.walletAddress).all<PositionRow>(),
    env.DB.prepare(`
      SELECT evm_address, chain_id, verified_at FROM evm_wallet_links
      WHERE owner_user_id = ?1 AND solana_wallet = ?2
    `).bind(walletSession.ownerUserId, walletSession.walletAddress).first<LinkRow>(),
  ]);
  return json({
    wallet: walletSession.walletAddress,
    evmWallet: evmLink ? { address: evmLink.evm_address, chainId: evmLink.chain_id, verifiedAt: evmLink.verified_at } : null,
    gasPolicy: "protocol_sponsored",
    claims: claims.results.map((claim) => ({
      id: claim.id, epochId: claim.epoch_id, amountAtomic: claim.amount_atomic,
      feeAtomic: claim.claim_fee_atomic, signature: claim.claim_signature, state: claim.state,
      destinationChain: claim.destination_chain, destinationAddress: claim.destination_address,
      launchId: claim.launch_id, launchName: claim.launch_name, launchSymbol: claim.launch_symbol,
      communityMint: claim.community_mint, rewardSymbol: claim.reward_symbol,
      rewardMint: claim.reward_mint, rewardChain: claim.reward_chain,
      rewardDecimals: claim.reward_decimals, cutoffSlot: claim.cutoff_slot,
    })),
    positions: positions.results.map((position) => ({
      epochId: position.epoch_id, launchId: position.launch_id, launchName: position.launch_name,
      launchSymbol: position.launch_symbol, communityMint: position.community_mint,
      rewardSymbol: position.reward_symbol, rewardChain: position.reward_chain,
      tokenSecondsAtomic: position.token_seconds_atomic, endingBalanceAtomic: position.ending_balance_atomic,
      lastObservedSlot: position.last_observed_slot, epochState: position.epoch_state,
    })),
  });
}

export async function POST(request: Request) {
  if (!env.DB) return json({ error: "Reward database is unavailable." }, 503);
  if (!FINANCIAL_LEDGER_VERIFIED) return json({ error: "Claims are paused pending financial-ledger verification." }, 503);
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Cross-origin claim requests are not allowed." }, 403);
  const session = await getVerifiedWalletSession(request);
  if (!session) return json({ error: "Verify your Solana wallet before claiming." }, 401);
  let input: z.infer<typeof claimSchema>;
  try { input = claimSchema.parse(await request.json()); }
  catch { return json({ error: "Invalid reward claim." }, 400); }
  const claim = await env.DB.prepare(`
    SELECT c.id, c.amount_atomic, c.state, c.solana_wallet,
      l.reward_symbol, l.reward_chain, l.reward_mint, l.reward_wrapped_contract
    FROM reward_claims c
    JOIN reward_epochs e ON e.id = c.epoch_id
    JOIN launch_drafts l ON l.id = e.launch_id
    WHERE c.id = ?1
  `).bind(input.claimId).first<ClaimRequestRow>();
  if (!claim || claim.solana_wallet !== session.walletAddress) return json({ error: "Reward claim not found." }, 404);
  if (claim.state !== "claimable") return json({ error: "This reward is already queued or paid." }, 409);
  let destinationAddress = session.walletAddress;
  let jobType = "solana_claim_payout";
  let payload: Record<string, string> = {
    claimId: claim.id,
    destinationAddress,
    tokenAddress: claim.reward_mint,
    amountAtomic: claim.amount_atomic,
  };
  if (claim.reward_chain === "chiliz") {
    if (!CHILIZ_ASSET_MIGRATION_VERIFIED) {
      return json({ error: "Chiliz V2 reward claims are paused until direct payout is verified." }, 503);
    }
    const link = await env.DB.prepare(`
      SELECT evm_address FROM evm_wallet_links WHERE owner_user_id = ?1 AND solana_wallet = ?2
    `).bind(session.ownerUserId, session.walletAddress).first<{ evm_address: string }>();
    if (!link) return json({ error: "Connect and verify a Chiliz wallet before claiming this reward." }, 409);
    const asset = getChilizRewardAsset(claim.reward_symbol);
    if (!asset || asset.routeStatus !== "current_verified" ||
      asset.currentV2Contract.toLowerCase() !== claim.reward_mint.toLowerCase() ||
      claim.reward_wrapped_contract !== null) {
      return json({ error: "The current Chiliz V2 reward contract and route could not be verified." }, 409);
    }
    destinationAddress = link.evm_address;
    jobType = "chiliz_claim_unwrap";
    payload = {
      claimId: claim.id,
      rewardSymbol: claim.reward_symbol,
      destinationAddress,
      fanTokenContract: asset.currentV2Contract,
      amountAtomic: claim.amount_atomic,
    };
  }
  const jobId = crypto.randomUUID();
  const now = Date.now();
  try {
    await env.DB.batch([
      env.DB.prepare(QUEUE_CLAIM_JOB_SQL).bind(jobId, jobType, claim.id, claim.reward_chain, JSON.stringify(payload), now),
      env.DB.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
      env.DB.prepare(QUEUE_CLAIM_TRANSITION_SQL).bind(claim.id, claim.reward_chain,
        destinationAddress, jobId, session.walletAddress),
      env.DB.prepare(ASSERT_ONE_ROW_CHANGED_SQL),
    ]);
  } catch {
    return json({ error: "This reward changed before it could be queued. Reload and retry." }, 409);
  }
  return json({ queued: true, claimId: claim.id, jobId, destinationChain: claim.reward_chain, destinationAddress }, 202);
}
