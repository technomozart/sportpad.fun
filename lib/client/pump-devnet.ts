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

const DEVNET_RPC_URL = "https://api.devnet.solana.com";

type TransactionSigner = <T extends Transaction>(transaction: T) => Promise<T>;
type SubmittedTransaction = {
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
};

function connection() {
  return new Connection(DEVNET_RPC_URL, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60_000,
  });
}

async function simulateOrThrow(rpc: Connection, transaction: Transaction) {
  const simulation = await rpc.simulateTransaction(transaction);
  if (simulation.value.err) {
    console.error("devnet_transaction_simulation_failed", simulation.value.err);
    throw new Error("The devnet transaction did not pass simulation.");
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
  onSubmitted: (submission: SubmittedTransaction) => void | Promise<void>;
}) {
  const signed = await signTransaction(transaction);
  if (!signed.signature) throw new Error("The wallet did not sign the devnet transaction.");
  const expectedSignature = bs58.encode(signed.signature);
  // Persist the signed evidence before broadcasting so a closed tab cannot
  // orphan a landed one-time transaction.
  await onSubmitted({ signature: expectedSignature, blockhash, lastValidBlockHeight });
  const signature = await rpc.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 3,
  });
  if (signature !== expectedSignature) {
    throw new Error("The devnet RPC returned an unexpected transaction signature.");
  }
  const confirmation = await rpc.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "finalized",
  );
  if (confirmation.value.err) throw new Error("The devnet transaction failed before finalization.");
  return signature;
}

export async function createPumpDevnetCoin({
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
  onSubmitted: (evidence: SubmittedTransaction & { mint: string }) => void | Promise<void>;
}) {
  const rpc = connection();
  const wallet = new PublicKey(walletAddress);
  const mint = Keypair.generate();
  const instruction = buildPumpCreateV2Instruction({
    mint: mint.publicKey,
    name,
    symbol,
    uri: metadataUri,
    creator: wallet,
  });
  const latest = await rpc.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    feePayer: wallet,
    recentBlockhash: latest.blockhash,
  }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 320_000 }),
    instruction,
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

export async function configurePumpDevnetFeeSplit({
  walletAddress,
  mintAddress,
  rewardWallet,
  burnWallet,
  signTransaction,
  onSubmitted,
}: {
  walletAddress: string;
  mintAddress: string;
  rewardWallet: string;
  burnWallet: string;
  signTransaction: TransactionSigner;
  onSubmitted: (submission: SubmittedTransaction) => void | Promise<void>;
}) {
  const rpc = connection();
  const wallet = new PublicKey(walletAddress);
  const mint = new PublicKey(mintAddress);
  const reward = new PublicKey(rewardWallet);
  const burn = new PublicKey(burnWallet);
  const createConfig = buildPumpCreateFeeConfigInstruction({ creator: wallet, mint });
  const lockShares = buildPumpUpdateFeeSharesV2Instruction({
    authority: wallet,
    mint,
    rewardWallet: reward,
    burnWallet: burn,
    rewardShareBps: REWARD_FEE_BPS,
    burnShareBps: SPORTPAD_FEE_BPS,
  });
  const latest = await rpc.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    feePayer: wallet,
    recentBlockhash: latest.blockhash,
  }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 450_000 }),
    createConfig,
    lockShares,
  );
  await simulateOrThrow(rpc, transaction);
  const signature = await signSendAndFinalize({
    rpc,
    transaction,
    signTransaction,
    onSubmitted,
    ...latest,
  });
  return { signature };
}
