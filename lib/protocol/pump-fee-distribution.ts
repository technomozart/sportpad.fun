import { PublicKey, SystemProgram } from "@solana/web3.js";
import bs58 from "bs58";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  PUMP_DISTRIBUTE_CREATOR_FEES_V2_DISCRIMINATOR,
  PUMP_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  bondingCurvePda,
  bytesEqual,
  creatorVaultPda,
  feeSharingConfigPda,
  pumpEventAuthorityPda,
} from "./pump-devnet-verification.ts";
import { PUMP_AMM_PROGRAM_ID } from "./pump-devnet-instructions.ts";

export const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";
export const PUMP_TRANSFER_CREATOR_FEES_TO_PUMP_V2_DISCRIMINATOR = Uint8Array.from([1, 33, 78, 185, 33, 67, 44, 92]);

export type SolanaCompiledInstruction = {
  programIdIndex: number;
  accounts: number[];
  data: string;
};

export type FinalizedSolanaTransaction = {
  slot: number;
  meta: {
    err: unknown;
    preBalances: number[];
    postBalances: number[];
    loadedAddresses?: { writable: string[]; readonly: string[] } | null;
  } | null;
  transaction: {
    signatures: string[];
    message: {
      accountKeys: Array<string | { pubkey: string }>;
      instructions: SolanaCompiledInstruction[];
    };
  };
};

export type VerifiedPumpFeeDistribution = {
  signature: string;
  instructionIndex: number;
  slot: number;
  grossAmountAtomic: string;
  rewardAmountAtomic: string;
  buybackAmountAtomic: string;
};

function accountKey(value: string | { pubkey: string }) {
  return typeof value === "string" ? value : value.pubkey;
}

function transactionAccountKeys(transaction: FinalizedSolanaTransaction) {
  const staticKeys = transaction.transaction.message.accountKeys.map(accountKey);
  const loaded = transaction.meta?.loadedAddresses;
  return loaded ? [...staticKeys, ...loaded.writable, ...loaded.readonly] : staticKeys;
}

function decodeInstructionData(value: string) {
  try {
    return bs58.decode(value);
  } catch {
    throw new Error("Pump instruction data is not valid base58.");
  }
}

function instructionUsesDiscriminator(instruction: SolanaCompiledInstruction, discriminator: Uint8Array) {
  const data = decodeInstructionData(instruction.data);
  return data.length >= discriminator.length && bytesEqual(data.subarray(0, discriminator.length), discriminator);
}

function assertKey(keys: string[], actualIndex: number | undefined, expected: PublicKey, label: string) {
  if (actualIndex === undefined || keys[actualIndex] !== expected.toBase58()) {
    throw new Error(`Pump distribution ${label} does not match.`);
  }
}

function assertSafeBalances(values: number[], label: string) {
  if (!values.every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error(`Pump distribution ${label} contains an unsafe lamport balance.`);
  }
}

function matchesPumpRounding(reward: bigint, buyback: bigint) {
  const received = reward + buyback;
  for (const distributed of [received, received + 1n]) {
    if ((distributed * 8_000n) / 10_000n === reward && (distributed * 2_000n) / 10_000n === buyback) {
      return true;
    }
  }
  return false;
}

export function verifyPumpFeeDistributions({
  transaction,
  mint,
  rewardTreasury,
  buybackTreasury,
}: {
  transaction: FinalizedSolanaTransaction;
  mint: string;
  rewardTreasury: string;
  buybackTreasury: string;
}): VerifiedPumpFeeDistribution[] {
  if (!transaction.meta || transaction.meta.err !== null) throw new Error("Pump distribution transaction did not finalize successfully.");
  if (!Number.isSafeInteger(transaction.slot) || transaction.slot <= 0) throw new Error("Pump distribution slot is invalid.");
  const signature = transaction.transaction.signatures[0]?.trim();
  if (!signature) throw new Error("Pump distribution signature is missing.");

  const mintKey = new PublicKey(mint);
  const rewardKey = new PublicKey(rewardTreasury);
  const buybackKey = new PublicKey(buybackTreasury);
  if (rewardKey.equals(buybackKey)) throw new Error("Pump distribution treasuries must be distinct.");
  const keys = transactionAccountKeys(transaction);
  if (transaction.meta.preBalances.length !== keys.length || transaction.meta.postBalances.length !== keys.length) {
    throw new Error("Pump distribution balance arrays do not align with transaction accounts.");
  }
  assertSafeBalances(transaction.meta.preBalances, "preBalances");
  assertSafeBalances(transaction.meta.postBalances, "postBalances");

  const instructions = transaction.transaction.message.instructions;
  const matching = instructions
    .map((instruction, instructionIndex) => ({ instruction, instructionIndex, programId: keys[instruction.programIdIndex] }))
    .filter(({ instruction, programId }) => programId === PUMP_PROGRAM_ID.toBase58() && instructionUsesDiscriminator(instruction, PUMP_DISTRIBUTE_CREATOR_FEES_V2_DISCRIMINATOR));
  if (matching.length === 0) return [];
  if (matching.length !== 1) throw new Error("A fee transaction must contain exactly one Pump distribution.");

  for (const instruction of instructions) {
    const programId = keys[instruction.programIdIndex];
    if (programId === COMPUTE_BUDGET_PROGRAM_ID) continue;
    if (programId === PUMP_PROGRAM_ID.toBase58() && instructionUsesDiscriminator(instruction, PUMP_DISTRIBUTE_CREATOR_FEES_V2_DISCRIMINATOR)) continue;
    if (programId === PUMP_AMM_PROGRAM_ID.toBase58() && instructionUsesDiscriminator(instruction, PUMP_TRANSFER_CREATOR_FEES_TO_PUMP_V2_DISCRIMINATOR)) continue;
    throw new Error("Pump distribution transaction contains an unapproved top-level instruction.");
  }

  const { instruction, instructionIndex } = matching[0];
  if (instruction.accounts.length !== 14) throw new Error("Pump distribution must contain exactly two shareholders.");
  const accounts = instruction.accounts;
  assertKey(keys, accounts[1], mintKey, "mint");
  assertKey(keys, accounts[2], bondingCurvePda(mintKey), "bonding curve");
  const sharingConfig = feeSharingConfigPda(mintKey);
  assertKey(keys, accounts[3], sharingConfig, "sharing config");
  assertKey(keys, accounts[4], creatorVaultPda(sharingConfig), "creator vault");
  assertKey(keys, accounts[5], SystemProgram.programId, "system program");
  assertKey(keys, accounts[6], pumpEventAuthorityPda(), "event authority");
  assertKey(keys, accounts[7], PUMP_PROGRAM_ID, "program account");
  assertKey(keys, accounts[9], NATIVE_MINT, "quote mint");
  assertKey(keys, accounts[10], TOKEN_PROGRAM_ID, "quote token program");
  assertKey(keys, accounts[11], ASSOCIATED_TOKEN_PROGRAM_ID, "associated token program");
  assertKey(keys, accounts[12], rewardKey, "80% treasury");
  assertKey(keys, accounts[13], buybackKey, "20% treasury");
  const payer = keys[accounts[0]];
  if (payer === rewardTreasury || payer === buybackTreasury) throw new Error("A treasury cannot be the distribution payer.");

  const rewardIndex = accounts[12];
  const buybackIndex = accounts[13];
  const rewardDelta = BigInt(transaction.meta.postBalances[rewardIndex]) - BigInt(transaction.meta.preBalances[rewardIndex]);
  const buybackDelta = BigInt(transaction.meta.postBalances[buybackIndex]) - BigInt(transaction.meta.preBalances[buybackIndex]);
  if (rewardDelta <= 0n || buybackDelta <= 0n) throw new Error("Pump distribution did not fund both treasuries.");
  if (!matchesPumpRounding(rewardDelta, buybackDelta)) throw new Error("Pump distribution does not match the immutable 80/20 shares.");

  return [{
    signature,
    instructionIndex,
    slot: transaction.slot,
    grossAmountAtomic: (rewardDelta + buybackDelta).toString(),
    rewardAmountAtomic: rewardDelta.toString(),
    buybackAmountAtomic: buybackDelta.toString(),
  }];
}
