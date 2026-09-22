import { env } from "cloudflare:workers";

import { getVerifiedWalletSession } from "@/lib/server/wallet-session";

type LinkRow = { evm_address: string; chain_id: number; verified_at: number };

export async function GET(request: Request) {
  if (!env.DB) return Response.json({ error: "Wallet storage is unavailable." }, { status: 503 });
  const session = await getVerifiedWalletSession(request);
  if (!session) return Response.json({ error: "Verify your Solana wallet first." }, { status: 401 });
  const link = await env.DB.prepare(`
    SELECT evm_address, chain_id, verified_at FROM evm_wallet_links
    WHERE owner_user_id = ?1 AND solana_wallet = ?2
  `).bind(session.ownerUserId, session.walletAddress).first<LinkRow>();
  return Response.json({
    solanaWallet: session.walletAddress,
    linked: Boolean(link),
    address: link?.evm_address ?? null,
    chainId: link?.chain_id ?? 88888,
    verifiedAt: link?.verified_at ?? null,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
