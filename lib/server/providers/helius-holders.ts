import "server-only";

import { PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";

import { canonicalHolderSnapshot } from "@/lib/protocol/holder-rewards";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@/lib/protocol/pump-devnet-verification";
import { readProviderCredentials } from "@/lib/server/providers/runtime-config";
import { getMainnetConnection } from "@/lib/server/solana/devnet";

type ProgramAccountResponse = {
  result?: {
    context?: { slot?: number };
    value?: Array<{ account?: { data?: [string, string] } }>;
  };
  error?: { message?: string };
};

async function sha256Hex(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function fetchFinalizedTokenHolders({
  mintAddress,
  excludedWallets,
  maximumAccounts = 50_000,
}: {
  mintAddress: string;
  excludedWallets: ReadonlySet<string>;
  maximumAccounts?: number;
}) {
  const credentials = readProviderCredentials();
  if (!credentials.heliusApiKey) throw new Error("Helius is not configured.");
  const mint = new PublicKey(mintAddress);
  const rpc = getMainnetConnection();
  const [mintAccount, minimumSlot] = await Promise.all([
    rpc.getAccountInfo(mint, "finalized"),
    rpc.getSlot("finalized"),
  ]);
  if (!mintAccount || (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) && !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID))) {
    throw new Error("The community mint is not owned by a supported SPL token program.");
  }

  const endpoint = `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(credentials.heliusApiKey)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "sportpad-finalized-holders",
      method: "getProgramAccounts",
      params: [
        mintAccount.owner.toBase58(),
        {
          commitment: "finalized",
          minContextSlot: minimumSlot,
          withContext: true,
          encoding: "base64",
          dataSlice: { offset: 32, length: 40 },
          filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }],
        },
      ],
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`Helius holder indexing failed with HTTP ${response.status}.`);
  const body = await response.json() as ProgramAccountResponse;
  const snapshotSlot = body.result?.context?.slot;
  if (body.error || !Array.isArray(body.result?.value) || typeof snapshotSlot !== "number" ||
    !Number.isSafeInteger(snapshotSlot) || snapshotSlot < minimumSlot) {
    throw new Error("Helius holder indexing returned an invalid finalized response.");
  }
  if (body.result.value.length > maximumAccounts) {
    throw new Error(`Holder indexing exceeded the ${maximumAccounts} account safety cap.`);
  }
  const finalizedAt = await rpc.getBlockTime(snapshotSlot);
  if (!Number.isSafeInteger(finalizedAt) || finalizedAt! <= 0 || finalizedAt! > Math.floor(Date.now() / 1000) + 10) {
    throw new Error("The finalized holder snapshot has no trustworthy block time.");
  }

  const balances = new Map<string, bigint>();
  for (const entry of body.result.value) {
    const encoded = entry.account?.data?.[0];
    if (typeof encoded !== "string") throw new Error("Helius returned invalid token account data.");
    const data = Buffer.from(encoded, "base64");
    if (data.length !== 40) throw new Error("Helius returned a truncated token account.");
    const owner = new PublicKey(data.subarray(0, 32));
    const wallet = owner.toBase58();
    if (!PublicKey.isOnCurve(owner.toBytes()) || excludedWallets.has(wallet)) continue;
    const amount = data.readBigUInt64LE(32);
    if (amount === 0n) continue;
    balances.set(wallet, (balances.get(wallet) ?? 0n) + amount);
  }

  const canonical = canonicalHolderSnapshot([...balances].map(([wallet, amountAtomic]) => ({ wallet, amountAtomic })));
  return {
    balances,
    slot: snapshotSlot,
    finalizedAt: finalizedAt!,
    accountsSeen: body.result.value.length,
    evidenceHash: await sha256Hex(canonical),
  };
}
