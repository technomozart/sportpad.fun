import { env } from "cloudflare:workers";
import { getAddress, verifyMessage } from "viem";
import { z } from "zod";

import { UPSERT_EVM_WALLET_LINK_SQL } from "@/lib/protocol/evm-wallet-auth";
import { getVerifiedWalletSession } from "@/lib/server/wallet-session";

const inputSchema = z.object({
  challengeId: z.string().uuid(),
  address: z.string().max(42),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
}).strict();

type ChallengeRow = {
  id: string;
  owner_user_id: string;
  solana_wallet: string;
  evm_address: string;
  message: string;
  expires_at: number;
  used_at: number | null;
};

export async function POST(request: Request) {
  if (!env.DB) return Response.json({ error: "Wallet storage is unavailable." }, { status: 503 });
  const origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin) return Response.json({ error: "Cross-origin wallet requests are not allowed." }, { status: 403 });
  const session = await getVerifiedWalletSession(request);
  if (!session) return Response.json({ error: "Verify your Solana wallet first." }, { status: 401 });
  let input: z.infer<typeof inputSchema>;
  try { input = inputSchema.parse(await request.json()); }
  catch { return Response.json({ error: "Invalid wallet signature request." }, { status: 400 }); }
  let address: `0x${string}`;
  try { address = getAddress(input.address); }
  catch { return Response.json({ error: "Invalid wallet address." }, { status: 400 }); }
  const challenge = await env.DB.prepare(`
    SELECT id, owner_user_id, solana_wallet, evm_address, message, expires_at, used_at
    FROM evm_wallet_challenges WHERE id = ?1
  `).bind(input.challengeId).first<ChallengeRow>();
  const now = Date.now();
  if (
    !challenge || challenge.used_at || challenge.expires_at <= now ||
    challenge.owner_user_id !== session.ownerUserId ||
    challenge.solana_wallet !== session.walletAddress ||
    challenge.evm_address.toLowerCase() !== address.toLowerCase()
  ) return Response.json({ error: "This wallet challenge is invalid or expired." }, { status: 409 });
  const valid = await verifyMessage({ address, message: challenge.message, signature: input.signature as `0x${string}` });
  if (!valid) return Response.json({ error: "The wallet signature was not valid." }, { status: 422 });
  const consumed = await env.DB.prepare(`UPDATE evm_wallet_challenges SET used_at = ?2 WHERE id = ?1 AND used_at IS NULL AND expires_at > ?2`)
    .bind(challenge.id, now).run();
  if (consumed.meta.changes !== 1) return Response.json({ error: "This wallet challenge was already used." }, { status: 409 });
  try {
    await env.DB.prepare(UPSERT_EVM_WALLET_LINK_SQL)
      .bind(session.ownerUserId, session.walletAddress, address, now).run();
  } catch {
    return Response.json({ error: "The Chiliz wallet link could not be saved. Please retry verification." }, { status: 503 });
  }
  return Response.json({ linked: true, address, chainId: 88888 }, { headers: { "Cache-Control": "private, no-store" } });
}
