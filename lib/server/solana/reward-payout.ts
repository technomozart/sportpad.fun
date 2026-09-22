import "server-only";

import { ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { Buffer } from "buffer";

import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@/lib/protocol/pump-devnet-verification";
import { associatedTokenAddress } from "@/lib/protocol/spl-burn";
import {
  buildCreateAssociatedTokenIdempotentInstruction,
  buildSplTransferCheckedInstruction,
} from "@/lib/protocol/spl-transfer";
import { getMainnetConnection } from "@/lib/server/solana/devnet";

async function sha256Hex(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function prepareRewardPayout({
  mintAddress,
  treasuryAddress,
  recipientAddress,
  amountAtomic,
}: {
  mintAddress: string;
  treasuryAddress: string;
  recipientAddress: string;
  amountAtomic: string;
}) {
  if (!/^[1-9]\d*$/.test(amountAtomic)) throw new Error("A positive reward payout amount is required.");
  const rpc = getMainnetConnection();
  const mint = new PublicKey(mintAddress);
  const treasury = new PublicKey(treasuryAddress);
  const recipient = new PublicKey(recipientAddress);
  if (!PublicKey.isOnCurve(recipient.toBytes())) throw new Error("Reward payouts require an on-curve recipient wallet.");
  const [mintAccount, supply] = await Promise.all([
    rpc.getAccountInfo(mint, "confirmed"),
    rpc.getTokenSupply(mint, "confirmed"),
  ]);
  if (!mintAccount) throw new Error("The official Fan Token mint does not exist on Solana mainnet.");
  const tokenProgram = mintAccount.owner;
  if (!tokenProgram.equals(TOKEN_PROGRAM_ID) && !tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error("The reward mint is not owned by a supported SPL token program.");
  }
  const sourceTokenAccount = associatedTokenAddress(mint, treasury, tokenProgram);
  const balance = await rpc.getTokenAccountBalance(sourceTokenAccount, "confirmed").catch(() => null);
  if (!balance || BigInt(balance.value.amount) < BigInt(amountAtomic)) {
    throw new Error("The reward treasury does not hold enough Fan Tokens for this payout.");
  }
  const latest = await rpc.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: treasury, recentBlockhash: latest.blockhash }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 90_000 }),
    buildCreateAssociatedTokenIdempotentInstruction({ payer: treasury, owner: recipient, mint, tokenProgram }),
    buildSplTransferCheckedInstruction({
      mint,
      sourceOwner: treasury,
      destinationOwner: recipient,
      amountAtomic: BigInt(amountAtomic),
      decimals: supply.value.decimals,
      tokenProgram,
    }),
  );
  return {
    transactionBase64: Buffer.from(transaction.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64"),
    transactionMessageHash: await sha256Hex(transaction.serializeMessage()),
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    tokenProgram: tokenProgram.toBase58(),
    sourceTokenAccount: sourceTokenAccount.toBase58(),
    destinationTokenAccount: associatedTokenAddress(mint, recipient, tokenProgram).toBase58(),
    decimals: supply.value.decimals,
  };
}

export async function rewardPayoutMessageHash(transaction: Transaction) {
  return sha256Hex(transaction.serializeMessage());
}

export async function submitAndConfirmRewardPayout({
  transaction,
  blockhash,
  lastValidBlockHeight,
}: {
  transaction: Transaction;
  blockhash: string;
  lastValidBlockHeight: number;
}) {
  const signatureBytes = transaction.signatures[0]?.signature;
  if (!signatureBytes) throw new Error("The reward treasury did not sign the payout transaction.");
  const expectedSignature = bs58.encode(signatureBytes);
  const rpc = getMainnetConnection();
  const simulation = await rpc.simulateTransaction(transaction);
  if (simulation.value.err) throw new Error("The Fan Token payout did not pass mainnet simulation. No transaction was sent.");
  const signature = await rpc.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 5,
  });
  if (signature !== expectedSignature) throw new Error("The RPC returned an unexpected payout transaction signature.");
  const confirmation = await rpc.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (confirmation.value.err) throw new Error("The Fan Token payout failed onchain.");
  const status = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true });
  if (!status.value[0] || status.value[0].err) throw new Error("The confirmed Fan Token payout receipt is unavailable.");
  return { signature, slot: status.value[0].slot };
}
