import { ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@/lib/protocol/pump-devnet-verification";
import { associatedTokenAddress, buildSplBurnInstruction } from "@/lib/protocol/spl-burn";
import { getMainnetConnection } from "@/lib/server/solana/devnet";

async function sha256Hex(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function prepareSportpadBurn({
  mintAddress,
  ownerAddress,
  amountAtomic,
}: {
  mintAddress: string;
  ownerAddress: string;
  amountAtomic: string;
}) {
  if (!/^[1-9]\d*$/.test(amountAtomic)) throw new Error("A positive SPORTPAD burn amount is required.");
  const rpc = getMainnetConnection();
  const mint = new PublicKey(mintAddress);
  const owner = new PublicKey(ownerAddress);
  const mintAccount = await rpc.getAccountInfo(mint, "confirmed");
  if (!mintAccount) throw new Error("The configured SPORTPAD mint does not exist on mainnet.");
  const tokenProgram = mintAccount.owner;
  if (!tokenProgram.equals(TOKEN_PROGRAM_ID) && !tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error("The configured SPORTPAD mint is not an SPL token mint.");
  }
  const tokenAccount = associatedTokenAddress(mint, owner, tokenProgram);
  const balance = await rpc.getTokenAccountBalance(tokenAccount, "confirmed").catch(() => null);
  if (!balance || BigInt(balance.value.amount) < BigInt(amountAtomic)) {
    throw new Error("The buyback treasury does not hold enough SPORTPAD for this burn receipt.");
  }
  const latest = await rpc.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: owner, recentBlockhash: latest.blockhash }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
    buildSplBurnInstruction({ mint, owner, amountAtomic: BigInt(amountAtomic), tokenProgram }),
  );
  const transactionBase64 = Buffer.from(transaction.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");
  return {
    transactionBase64,
    transactionMessageHash: await sha256Hex(transaction.serializeMessage()),
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    tokenProgram: tokenProgram.toBase58(),
    tokenAccount: tokenAccount.toBase58(),
  };
}

export async function legacyTransactionMessageHash(transaction: Transaction) {
  return sha256Hex(transaction.serializeMessage());
}

export async function submitSignedMainnetTransaction(transaction: Transaction) {
  const signatureBytes = transaction.signatures[0]?.signature;
  if (!signatureBytes) throw new Error("The treasury wallet did not sign the burn transaction.");
  const expectedSignature = bs58.encode(signatureBytes);
  const rpc = getMainnetConnection();
  const simulation = await rpc.simulateTransaction(transaction);
  if (simulation.value.err) throw new Error("The SPORTPAD burn did not pass mainnet simulation. No transaction was sent.");
  const signature = await rpc.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 5,
  });
  if (signature !== expectedSignature) throw new Error("The RPC returned an unexpected burn transaction signature.");
  return signature;
}
