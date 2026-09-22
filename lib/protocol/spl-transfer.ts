import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { Buffer } from "buffer";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./pump-devnet-verification.ts";
import { associatedTokenAddress } from "./spl-burn.ts";

const MAX_U64 = 18_446_744_073_709_551_615n;

export function buildCreateAssociatedTokenIdempotentInstruction({
  payer,
  owner,
  mint,
  tokenProgram,
}: {
  payer: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
}) {
  if (!tokenProgram.equals(TOKEN_PROGRAM_ID) && !tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error("The mint is not owned by a supported SPL token program.");
  }
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedTokenAddress(mint, owner, tokenProgram), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]), // Associated Token Program: CreateIdempotent
  });
}

export function buildSplTransferCheckedInstruction({
  mint,
  sourceOwner,
  destinationOwner,
  amountAtomic,
  decimals,
  tokenProgram,
}: {
  mint: PublicKey;
  sourceOwner: PublicKey;
  destinationOwner: PublicKey;
  amountAtomic: bigint;
  decimals: number;
  tokenProgram: PublicKey;
}) {
  if (amountAtomic <= 0n || amountAtomic > MAX_U64) {
    throw new Error("The transfer amount must fit in an unsigned 64-bit integer.");
  }
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("The mint decimals are invalid.");
  }
  if (!PublicKey.isOnCurve(destinationOwner.toBytes())) {
    throw new Error("Reward payouts require an on-curve recipient wallet.");
  }
  const data = new Uint8Array(10);
  data[0] = 12; // SPL Token TransferChecked
  new DataView(data.buffer).setBigUint64(1, amountAtomic, true);
  data[9] = decimals;
  return new TransactionInstruction({
    programId: tokenProgram,
    keys: [
      { pubkey: associatedTokenAddress(mint, sourceOwner, tokenProgram), isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: associatedTokenAddress(mint, destinationOwner, tokenProgram), isSigner: false, isWritable: true },
      { pubkey: sourceOwner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}
