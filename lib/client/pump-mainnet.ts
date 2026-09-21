"use client";

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";

import { REWARD_FEE_BPS, SPORTPAD_FEE_BPS } from "@/lib/protocol/devnet-launch";
import {
  buildPumpCreateFeeConfigInstruction,
  buildPumpCreateV2Instruction,
  buildPumpUpdateFeeSharesV2Instruction,
} from "@/lib/protocol/pump-devnet-instructions";

const MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";

type TransactionSigner = <T extends Transaction>(transaction: T) => Promise<T>;
export type MainnetSubmission = {
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
};

function connection() {
  return new Connection(MAINNET_RPC_URL, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60_000,
  });
}

export async function getMainnetBalanceLamports(walletAddress: string) {
  return connection().getBalance(new PublicKey(walletAddress), "confirmed");
}

export async function getMainnetSubmissionState(signature: string, lastValidBlockHeight: number) {
  const rpc = connection();
  const [statuses, blockHeight] = await Promise.all([
    rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }),
    rpc.getBlockHeight("confirmed"),
  ]);
  const status = statuses.value[0];
  if (status?.err) return "failed" as const;
  if (status?.confirmationStatus === "finalized") return "finalized" as const;
  if (blockHeight > lastValidBlockHeight) return "expired" as const;
  return "pending" as const;
}

async function simulateOrThrow(rpc: Connection, transaction: Transaction) {
  const simulation = await rpc.simulateTransaction(transaction);
  if (simulation.value.err) {
    console.error("mainnet_transaction_simulation_failed", simulation.value.err);
    throw new Error("The mainnet transaction did not pass simulation. No transaction was sent.");
  }
}

async function signSendAndFinalize({
  rpc,
  transaction,
  signTransaction,
  blockhash,
  lastValidBlockHeight,
  onSubmitted,
}: {
  rpc: Connection;
  transaction: Transaction;
  signTransaction: TransactionSigner;
  blockhash: string;
  lastValidBlockHeight: number;
  onSubmitted: (submission: MainnetSubmission) => void | Promise<void>;
}) {
  const signed = await signTransaction(transaction);
  if (!signed.signature) throw new Error("The wallet did not sign the mainnet transaction.");
  const expectedSignature = bs58.encode(signed.signature);
  await onSubmitted({ signature: expectedSignature, blockhash, lastValidBlockHeight });
  const signature = await rpc.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 5,
  });
  if (signature !== expectedSignature) throw new Error("The RPC returned an unexpected transaction signature.");
  const confirmation = await rpc.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "finalized",
  );
  if (confirmation.value.err) throw new Error("The mainnet transaction failed before finalization.");
  return signature;
}

export async function createPumpMainnetCoin({
  walletAddress,
  name,
  symbol,
  metadataUri,
  signTransaction,
  onSubmitted,
}: {
  walletAddress: string;
  name: string;
  symbol: string;
  metadataUri: string;
  signTransaction: TransactionSigner;
  onSubmitted: (evidence: MainnetSubmission & { mint: string }) => void | Promise<void>;
}) {
  const rpc = connection();
  const wallet = new PublicKey(walletAddress);
  const mint = Keypair.generate();
  const latest = await rpc.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: wallet, recentBlockhash: latest.blockhash }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 320_000 }),
    buildPumpCreateV2Instruction({ mint: mint.publicKey, name, symbol, uri: metadataUri, creator: wallet }),
  );
  transaction.partialSign(mint);
  await simulateOrThrow(rpc, transaction);
  const signature = await signSendAndFinalize({
    rpc,
    transaction,
    signTransaction,
    onSubmitted: (submission) => onSubmitted({ mint: mint.publicKey.toBase58(), ...submission }),
    ...latest,
  });
  return { mint: mint.publicKey.toBase58(), signature };
}

export async function configurePumpMainnetFeeSplit({
  walletAddress,
  mintAddress,
  rewardTreasury,
  buybackTreasury,
  signTransaction,
  onSubmitted,
}: {
  walletAddress: string;
  mintAddress: string;
  rewardTreasury: string;
  buybackTreasury: string;
  signTransaction: TransactionSigner;
  onSubmitted: (submission: MainnetSubmission) => void | Promise<void>;
}) {
  const rpc = connection();
  const wallet = new PublicKey(walletAddress);
  const mint = new PublicKey(mintAddress);
  const reward = new PublicKey(rewardTreasury);
  const buyback = new PublicKey(buybackTreasury);
  const latest = await rpc.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: wallet, recentBlockhash: latest.blockhash }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 450_000 }),
    buildPumpCreateFeeConfigInstruction({ creator: wallet, mint }),
    buildPumpUpdateFeeSharesV2Instruction({
      authority: wallet,
      mint,
      rewardWallet: reward,
      burnWallet: buyback,
      rewardShareBps: REWARD_FEE_BPS,
      burnShareBps: SPORTPAD_FEE_BPS,
    }),
  );
  await simulateOrThrow(rpc, transaction);
  const signature = await signSendAndFinalize({ rpc, transaction, signTransaction, onSubmitted, ...latest });
  return { signature };
}
